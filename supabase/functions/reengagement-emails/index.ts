// Supabase Edge Function: reengagement-emails
// Daily re-engagement cron. Called by a Vercel cron at
// /api/cron-reengagement, which proxies the request with x-cron-secret.
//
// The function catches three stalled onboarding states and sends a single
// ~24h follow-up per (recipient, activity, strand). Dedupe rows live in
// reengagement_sent (strands A/B) and activity_invites.reengagement_sent_at
// (strand C) so a candidate never receives two reminders about the same
// stall.
//
// Strands:
//   A — email submitted on share-landing, magic link never clicked
//       (auth.users exists, email_confirmed_at is null).
//   B — signed in but never ended up on the target list
//       (activity_members missing for the intent's activity_id).
//   C — added via "Invite by email", never registered
//       (activity_invites with no matching auth.users).
//   D — inviter nudge: host invited someone 3+ days ago, invitee never
//       accepted. Recipient is the HOST; CTA re-sends the original invite.
//
// The candidate RPC returns a uniform shape across strands so the per-row
// branching here is minimal (subject/headline/CTA URL type).
//
// Auth: not user-facing. verify_jwt = false in config.toml. Access is gated
// by REENGAGEMENT_CRON_SECRET (set in BOTH Supabase function secrets AND
// Vercel env vars — Vercel cron sends it; this function checks it).

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://packupgear.com";
const MAIL_FROM = Deno.env.get("INVITE_MAIL_FROM")
  || Deno.env.get("DIGEST_MAIL_FROM")
  || "PackUpGear <invites@packupgear.com>";
const REENGAGEMENT_CRON_SECRET = Deno.env.get("REENGAGEMENT_CRON_SECRET");
const PRODUCT_NAME = "PackUpGear";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function restAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY!,
      "authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      "accept": "application/json",
      ...(init.headers || {}),
    },
  });
}

// type = "magiclink"   → signs existing (confirmed OR unconfirmed) user in
//                       via the admin path and honours redirect_to.
// type = "signup"      → confirms + signs in an existing unconfirmed user.
//                       Fallback for strand A when magiclink is rejected.
// type = "invite"      → provisions a brand-new user for strand C.
async function generateActionLink(
  type: "magiclink" | "signup" | "invite",
  email: string,
  redirectTo: string,
): Promise<string | null> {
  const res = await restAdmin(`/auth/v1/admin/generate_link`, {
    method: "POST",
    body: JSON.stringify({
      type,
      email,
      options: { redirect_to: redirectTo },
    }),
  });
  if (!res.ok) {
    console.error(`generate_link(${type}) ${res.status}: ${await res.text()}`);
    return null;
  }
  const body = await res.json();
  const link = body?.properties?.action_link ?? body?.action_link ?? null;
  return typeof link === "string" ? link : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Per-strand copy ------------------------------------------------------

interface Copy {
  subject: string;
  headline: string;
  subhead: string;
  bodyLead: string;
  bodyDetail: string;
  cta: string;
  preheader: string;
}

function copyForStrand(strand: string, vars: {
  inviter: string;
  activityName: string;
  activityEmoji: string;
  recipientName: string;
  inviteeEmail: string;
}): Copy {
  const { inviter, activityName, activityEmoji, recipientName, inviteeEmail } = vars;
  const emoji = activityEmoji ? `${activityEmoji} ` : "";
  const listLabel = `${emoji}${activityName}`;
  const inviterName = inviter || "A friend";
  const greeting = recipientName ? `Hey ${recipientName},` : "Hey,";

  if (strand === "A") {
    return {
      subject: `Your ${PRODUCT_NAME} invite is still waiting`,
      headline: `Join ${inviterName}`,
      subhead: `for "${listLabel}"`,
      bodyLead: `${greeting} looks like the magic link never got tapped.`,
      bodyDetail: `One tap below signs you in and drops you right on the list.`,
      cta: "Open the packing list →",
      preheader: `${inviterName} is waiting on you to pack for "${activityName}".`,
    };
  }
  if (strand === "B") {
    return {
      subject: `Finish joining "${listLabel}"`,
      headline: `One tap to join`,
      subhead: `"${listLabel}"`,
      bodyLead: `${greeting} you signed in but never made it to the list.`,
      bodyDetail: `Here's a fresh link that'll take you straight there.`,
      cta: "Join the packing list →",
      preheader: `Jump into "${activityName}" — it's one tap from here.`,
    };
  }
  if (strand === "D") {
    // Host-facing nudge. recipientName is the host's first name; inviteeEmail
    // is the person they invited who still hasn't joined.
    const who = inviteeEmail || "someone you invited";
    return {
      subject: `${who} hasn't joined "${activityName}" yet`,
      headline: `Remind them?`,
      subhead: `about "${listLabel}"`,
      bodyLead: `${greeting} ${who} hasn't accepted the invite to "${activityName}" yet.`,
      bodyDetail: `One tap re-sends them the original invite email.`,
      cta: "Remind them →",
      preheader: `Re-send the "${activityName}" invite to ${who}.`,
    };
  }
  // Strand C
  return {
    subject: `${inviterName} invited you to ${PRODUCT_NAME}`,
    headline: `Join ${inviterName}`,
    subhead: `for "${listLabel}"`,
    bodyLead: `You were invited to help pack "${listLabel}".`,
    bodyDetail: `Create your account in one tap — no password needed.`,
    cta: "Accept the invite →",
    preheader: `${inviterName} wants your help packing for "${activityName}".`,
  };
}

// ---- Email rendering ------------------------------------------------------

function buildHtml(vars: {
  copy: Copy;
  actionUrl: string;
  appUrl: string;
}): string {
  const { copy, actionUrl, appUrl } = vars;
  const appHost = appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>${PRODUCT_NAME} — ${escapeHtml(copy.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7fa;color:#1a1d23;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;">
    <span style="display:none !important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;visibility:hidden;">${escapeHtml(copy.preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f7fa;background-image:radial-gradient(1200px 600px at 20% -10%, rgba(76,95,213,0.10), transparent 60%),radial-gradient(1000px 500px at 110% 110%, rgba(74,222,128,0.07), transparent 60%);padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
            <!-- Decorative emoji band -->
            <tr>
              <td align="center" style="padding:0 0 8px 0;font-size:22px;letter-spacing:12px;opacity:0.55;">
                🏔 🪂 🎒 🪢 🧗 ⛺
              </td>
            </tr>
            <!-- Card -->
            <tr>
              <td style="background:#ffffff;border:1px solid #e2e5eb;border-radius:18px;padding:36px 32px;box-shadow:0 20px 60px rgba(15,23,42,0.08);">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="padding-bottom:8px;">
                      <div style="font-size:28px;line-height:1;">⛰</div>
                      <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#5b6270;margin-top:8px;">${PRODUCT_NAME}</div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:20px 0 4px 0;">
                      <div style="font-size:40px;line-height:1.05;font-weight:800;letter-spacing:-0.03em;color:#1a1d23;">${escapeHtml(copy.headline)}</div>
                      <div style="font-size:22px;line-height:1.15;font-weight:700;color:#1a1d23;opacity:0.7;margin-top:10px;">${escapeHtml(copy.subhead)}</div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:24px 8px 6px 8px;">
                      <div style="font-size:16px;line-height:1.55;color:#1a1d23;">
                        ${escapeHtml(copy.bodyLead)}
                      </div>
                      <div style="font-size:15px;line-height:1.55;color:#5b6270;margin-top:6px;">
                        ${escapeHtml(copy.bodyDetail)}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:24px 0 8px 0;">
                      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#4c5fd5;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:12px;min-width:240px;text-align:center;">
                        ${escapeHtml(copy.cta)}
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:8px 8px 0 8px;">
                      <p style="margin:0;font-size:13px;line-height:1.5;color:#8a92a1;">
                        This link signs you in automatically. Single-use, expires in an hour.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:14px 8px 0 8px;">
                      <p style="margin:0;font-size:13px;line-height:1.5;color:#8a92a1;">
                        Button not working? Paste this into your browser:<br />
                        <a href="${escapeHtml(actionUrl)}" style="color:#4c5fd5;text-decoration:none;word-break:break-all;">${escapeHtml(actionUrl)}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 8px 0 8px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#8a92a1;text-align:center;">
                  Not interested? No worries — you won't hear from us again about this list.
                  <br />
                  <a href="${escapeHtml(appUrl)}" style="color:#4c5fd5;text-decoration:none;">${escapeHtml(appHost)}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText(vars: { copy: Copy; actionUrl: string }): string {
  const { copy, actionUrl } = vars;
  return [
    `${copy.headline} ${copy.subhead}`,
    "",
    copy.bodyLead,
    copy.bodyDetail,
    "",
    actionUrl,
    "",
    "This link signs you in automatically — single-use, expires in an hour.",
  ].join("\n");
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured — skipping email send");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html, text }),
    });
    if (!res.ok) {
      console.error(`Resend ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend error:", err);
    return false;
  }
}

// ---- Candidate fetch + mark-sent ------------------------------------------

interface Candidate {
  strand: "A" | "B" | "C" | "D";
  recipient_email: string;
  user_id: string | null;
  display_name: string;
  activity_id: string;
  activity_name: string;
  activity_emoji: string;
  inviter_name: string;
  share_token: string;
  invite_token: string;
  invitee_email: string;
}

async function fetchCandidates(): Promise<Candidate[]> {
  const res = await restAdmin(`/rest/v1/rpc/internal_reengagement_candidates`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    console.error(`internal_reengagement_candidates ${res.status}: ${await res.text()}`);
    return [];
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function markSent(c: Candidate): Promise<void> {
  const res = await restAdmin(`/rest/v1/rpc/internal_mark_reengagement_sent`, {
    method: "POST",
    body: JSON.stringify({
      p_strand: c.strand,
      p_user_id: c.user_id,
      p_activity_id: c.activity_id,
      p_invite_token: c.invite_token || "",
    }),
  });
  if (!res.ok) {
    console.error(`internal_mark_reengagement_sent ${res.status}: ${await res.text()}`);
  }
}

// For each strand, pick the right generate_link type and redirect path. A&B
// land on /?share=<token> so applyPendingShareToken auto-joins on arrival.
// C lands on /?invite=<token> matching the share-activity invite flow.
// D lands on /?activity=<id>&remind_invite=<token> — the host is already
// registered, so a magiclink signs them in and applyPendingRemindInvite
// fires share-activity to re-send the original invite.
function buildActionContext(c: Candidate): {
  linkType: "magiclink" | "signup" | "invite";
  redirectTo: string;
} {
  const base = APP_URL.replace(/\/+$/, "");
  if (c.strand === "A" || c.strand === "B") {
    return {
      // magiclink works for both confirmed (B) and unconfirmed (A) users via
      // the admin API — clicking the link confirms the email on the way in.
      linkType: "magiclink",
      redirectTo: `${base}/?share=${encodeURIComponent(c.share_token)}`,
    };
  }
  if (c.strand === "D") {
    return {
      linkType: "magiclink",
      redirectTo: `${base}/?activity=${encodeURIComponent(c.activity_id)}` +
        `&remind_invite=${encodeURIComponent(c.invite_token)}`,
    };
  }
  return {
    linkType: "invite",
    redirectTo: `${base}/?invite=${encodeURIComponent(c.invite_token)}`,
  };
}

// ---- Main handler ---------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured (supabase env)" }, 500);
  }
  if (!REENGAGEMENT_CRON_SECRET) {
    return json({ error: "Server misconfigured (cron secret)" }, 500);
  }

  const provided = req.headers.get("x-cron-secret") || "";
  if (provided.length !== REENGAGEMENT_CRON_SECRET.length || provided !== REENGAGEMENT_CRON_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  let dryRun = false;
  try {
    const body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json()
      : null;
    dryRun = !!body?.dry_run;
  } catch {
    // ignore
  }

  const candidates = await fetchCandidates();
  console.log(`reengagement: ${candidates.length} candidate rows`);

  let sent = 0;
  let failed = 0;
  const counts = { A: 0, B: 0, C: 0, D: 0 } as Record<string, number>;

  for (const c of candidates) {
    if (!c.recipient_email) { failed++; continue; }
    const recipientName = (c.display_name || "").trim().split(/\s+/)[0] || "";
    const copy = copyForStrand(c.strand, {
      inviter: c.inviter_name || "",
      activityName: c.activity_name,
      activityEmoji: c.activity_emoji || "",
      recipientName,
      inviteeEmail: c.invitee_email || "",
    });

    if (dryRun) {
      console.log(`[dry-run] strand=${c.strand} → ${c.recipient_email} (${c.activity_name})`);
      sent++;
      counts[c.strand]++;
      continue;
    }

    const { linkType, redirectTo } = buildActionContext(c);
    let actionUrl = await generateActionLink(linkType, c.recipient_email, redirectTo);
    // Strand A fallback: if magiclink 422s on an unconfirmed user, try signup.
    if (!actionUrl && c.strand === "A") {
      actionUrl = await generateActionLink("signup", c.recipient_email, redirectTo);
    }
    if (!actionUrl) { failed++; continue; }

    const html = buildHtml({ copy, actionUrl, appUrl: APP_URL });
    const text = buildText({ copy, actionUrl });

    const ok = await sendEmail(c.recipient_email, copy.subject, html, text);
    if (ok) {
      await markSent(c);
      sent++;
      counts[c.strand]++;
    } else {
      failed++;
    }
  }

  return json({
    candidates: candidates.length,
    sent,
    failed,
    by_strand: counts,
    dry_run: dryRun,
  });
});
