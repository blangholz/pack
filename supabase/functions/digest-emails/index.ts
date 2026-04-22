// Supabase Edge Function: digest-emails
// Re-engagement digest. Called daily by a Vercel cron at /api/cron-digest,
// which proxies the request with x-cron-secret. The function:
//
//   1. Verifies the shared cron secret (DIGEST_CRON_SECRET).
//   2. Calls internal_digest_candidates() to get one row per (user, activity)
//      where someone else has added gear that the user hasn't seen in 24h+.
//   3. For each row, generates a magic-link URL that lands them directly on
//      the activity, and sends a styled email via Resend.
//   4. Marks digest_sent_at = now() on success so the next run doesn't
//      re-notify about the same items.
//
// Auth: not user-facing. verify_jwt = false in config.toml. Access is gated
// by DIGEST_CRON_SECRET (set in BOTH Supabase function secrets AND Vercel
// env vars — the Vercel cron sends it; this function checks it).

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://packupgear.com";
const MAIL_FROM = Deno.env.get("DIGEST_MAIL_FROM")
  || Deno.env.get("INVITE_MAIL_FROM")
  || "PackUpGear <invites@packupgear.com>";
const DIGEST_CRON_SECRET = Deno.env.get("DIGEST_CRON_SECRET");
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

// ---- Service-role REST helper ---------------------------------------------

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

// Generate a magic-link action URL for an existing user. Same pattern as
// share-activity's generateAdminLink but specialised to "magiclink".
async function generateMagicLink(email: string, redirectTo: string): Promise<string | null> {
  const res = await restAdmin(`/auth/v1/admin/generate_link`, {
    method: "POST",
    body: JSON.stringify({
      type: "magiclink",
      email,
      options: { redirect_to: redirectTo },
    }),
  });
  if (!res.ok) {
    console.error(`generate_link(magiclink) ${res.status}: ${await res.text()}`);
    return null;
  }
  const body = await res.json();
  const link = body?.properties?.action_link ?? body?.action_link ?? null;
  return typeof link === "string" ? link : null;
}

// ---- Email rendering ------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDigestHtml(vars: {
  recipientName: string;
  activityName: string;
  activityEmoji: string;
  newCount: number;
  actionUrl: string;
  appUrl: string;
}): string {
  const { recipientName, activityName, activityEmoji, newCount, actionUrl, appUrl } = vars;
  const activityDisplay = `${activityEmoji ? escapeHtml(activityEmoji) + " " : ""}${escapeHtml(activityName)}`;
  const itemWord = newCount === 1 ? "new piece of gear" : "new pieces of gear";
  const headline = `${newCount} ${itemWord} added`;
  const greeting = recipientName ? `Hey ${escapeHtml(recipientName)},` : "Hey,";
  const preheader = `${newCount} ${itemWord} added to "${activityName}" — tap to take a look.`;
  const appHost = appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>${PRODUCT_NAME} — new gear in "${escapeHtml(activityName)}"</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7fa;color:#1a1d23;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;">
    <span style="display:none !important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;visibility:hidden;">${escapeHtml(preheader)}</span>
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
                      <div style="font-size:46px;line-height:1.02;font-weight:800;letter-spacing:-0.035em;color:#1a1d23;">${headline}</div>
                      <div style="font-size:24px;line-height:1.1;font-weight:700;color:#1a1d23;opacity:0.7;margin-top:10px;">in "${activityDisplay}"</div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:24px 8px 6px 8px;">
                      <div style="font-size:16px;line-height:1.55;color:#1a1d23;">
                        ${greeting} the rest of your crew has been packing.
                      </div>
                      <div style="font-size:15px;line-height:1.55;color:#5b6270;margin-top:6px;">
                        Take a peek and make sure your gear is on the list.
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:24px 0 8px 0;">
                      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#4c5fd5;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:12px;min-width:240px;text-align:center;">
                        Open the packing list →
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
                  Getting too many of these? Open the list at
                  <a href="${escapeHtml(appUrl)}" style="color:#4c5fd5;text-decoration:none;">${escapeHtml(appHost)}</a>
                  to dismiss the badge — we won't email again about the same items.
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

function buildDigestText(vars: {
  recipientName: string;
  activityName: string;
  activityEmoji: string;
  newCount: number;
  actionUrl: string;
}): string {
  const { recipientName, activityName, activityEmoji, newCount, actionUrl } = vars;
  const activityDisplay = `${activityEmoji ? activityEmoji + " " : ""}${activityName}`;
  const itemWord = newCount === 1 ? "new piece of gear" : "new pieces of gear";
  const greeting = recipientName ? `Hey ${recipientName},` : "Hey,";
  return [
    `${greeting} ${newCount} ${itemWord} added to "${activityDisplay}" on ${PRODUCT_NAME}.`,
    "",
    "Take a peek and make sure your gear is on the list:",
    actionUrl,
    "",
    "This link signs you in automatically — single-use, expires in an hour.",
  ].join("\n");
}

function buildSubject(vars: {
  activityName: string;
  activityEmoji: string;
  newCount: number;
}): string {
  const { activityName, activityEmoji, newCount } = vars;
  const itemWord = newCount === 1 ? "new piece of gear" : "new pieces of gear";
  const emoji = activityEmoji ? `${activityEmoji} ` : "";
  return `${newCount} ${itemWord} in "${emoji}${activityName}"`;
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

// ---- Main handler ---------------------------------------------------------

interface DigestCandidate {
  user_id: string;
  email: string;
  display_name: string;
  activity_id: string;
  activity_name: string;
  activity_emoji: string;
  new_count: number;
  latest_item_at: string;
  baseline: string;
}

async function fetchCandidates(): Promise<DigestCandidate[]> {
  const res = await restAdmin(`/rest/v1/rpc/internal_digest_candidates`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    console.error(`internal_digest_candidates ${res.status}: ${await res.text()}`);
    return [];
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function markDigestSent(userId: string, activityId: string): Promise<void> {
  const res = await restAdmin(`/rest/v1/rpc/internal_mark_digest_sent`, {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_activity_id: activityId }),
  });
  if (!res.ok) {
    console.error(`internal_mark_digest_sent ${res.status}: ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured (supabase env)" }, 500);
  }
  if (!DIGEST_CRON_SECRET) {
    return json({ error: "Server misconfigured (cron secret)" }, 500);
  }

  // Constant-time-ish secret check.
  const provided = req.headers.get("x-cron-secret") || "";
  if (provided.length !== DIGEST_CRON_SECRET.length || provided !== DIGEST_CRON_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  // Optional dry-run for inspection without sending mail or marking sent.
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
  console.log(`digest: ${candidates.length} candidate (user, activity) pairs`);

  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!c.email) {
      failed++;
      continue;
    }
    const redirectTo = `${APP_URL.replace(/\/+$/, "")}/?activity=${encodeURIComponent(c.activity_id)}`;
    const recipientName = (c.display_name || "").trim().split(/\s+/)[0] || "";

    if (dryRun) {
      console.log(`[dry-run] would email ${c.email} about "${c.activity_name}" (${c.new_count} items)`);
      sent++;
      continue;
    }

    const actionUrl = await generateMagicLink(c.email, redirectTo);
    if (!actionUrl) {
      failed++;
      continue;
    }

    const subject = buildSubject({
      activityName: c.activity_name,
      activityEmoji: c.activity_emoji || "",
      newCount: c.new_count,
    });
    const html = buildDigestHtml({
      recipientName,
      activityName: c.activity_name,
      activityEmoji: c.activity_emoji || "",
      newCount: c.new_count,
      actionUrl,
      appUrl: APP_URL,
    });
    const text = buildDigestText({
      recipientName,
      activityName: c.activity_name,
      activityEmoji: c.activity_emoji || "",
      newCount: c.new_count,
      actionUrl,
    });

    const ok = await sendEmail(c.email, subject, html, text);
    if (ok) {
      await markDigestSent(c.user_id, c.activity_id);
      sent++;
    } else {
      failed++;
    }
  }

  return json({
    candidates: candidates.length,
    sent,
    failed,
    dry_run: dryRun,
  });
});
