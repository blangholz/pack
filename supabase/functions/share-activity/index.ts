// Supabase Edge Function: share-activity
// Invites an email address to collaborate on a packing list.
//
// Request body (JSON):
//   { "activity_id": "<uuid>", "email": "friend@example.com" }
//
// Response (JSON):
//   { status: "added" | "invited", member?: {...}, invite?: {...} }
//
// Flow:
//   1. Caller is authenticated (JWT). Rate-limited at 20/hour per user.
//   2. Caller must be the owner of activity_id.
//   3. Look up the email in auth.users via a service-role RPC.
//      - Exists: insert into activity_members (service role, bypass RLS);
//        email is a deep-link notification.
//      - New: insert into activity_invites, call admin generate_link
//        type='invite' to provision the user + get a one-click action URL,
//        email wraps that URL in our styled template.
//   4. Email is sent via Resend HTTP API so we control HTML/subject. Supabase's
//      SMTP path is reserved for auth-system emails.
//
// Auth note mirrors extract-gear: verify_jwt is off in config.toml because the
// gateway can't verify this project's ES256 JWTs. We re-validate the token
// server-side via the Supabase auth API.

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://packupgear.com";
const MAIL_FROM = Deno.env.get("INVITE_MAIL_FROM") || "PackUpGear <invites@packupgear.com>";
const PRODUCT_NAME = "PackUpGear";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

// ---- Auth / rate limit (shared pattern with extract-gear) ------------------

async function requireAuth(req: Request): Promise<{ userId: string; token: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return typeof user?.id === "string" ? { userId: user.id, token } : null;
  } catch {
    return null;
  }
}

async function checkRateLimit(
  token: string,
  bucket: string,
  maxCount: number,
  windowSeconds: number,
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hit_rate_limit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ bucket, max_count: maxCount, window_seconds: windowSeconds }),
    });
    if (!res.ok) return true;
    const allowed = await res.json();
    return allowed === true;
  } catch {
    return true;
  }
}

// ---- Admin REST helpers ----------------------------------------------------

async function restGet(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      "apikey": SUPABASE_ANON_KEY!,
      "authorization": `Bearer ${token}`,
      "accept": "application/json",
    },
  });
  return res;
}

async function restAdmin(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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

// Look up a user id by email via the internal_lookup_user_by_email SQL
// function (service role only). Returns null if no user exists.
async function lookupUserByEmail(email: string): Promise<string | null> {
  const res = await restAdmin(`/rest/v1/rpc/internal_lookup_user_by_email`, {
    method: "POST",
    body: JSON.stringify({ p_email: email }),
  });
  if (!res.ok) {
    console.error(`lookupUserByEmail ${res.status}: ${await res.text()}`);
    return null;
  }
  const id = await res.json();
  return typeof id === "string" ? id : null;
}

// Call Supabase admin generate_link to produce a one-click action URL. type
// "invite" provisions a new user + returns the verify URL; type "magiclink"
// signs in an existing user and redirects. In both cases we honour the
// redirect_to so the client can pick up our invite token.
async function generateAdminLink(
  type: "invite" | "magiclink",
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

// ---- Resend email ----------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml(vars: {
  inviterName: string;
  activityName: string;
  activityEmoji: string;
  actionUrl: string;
  appUrl: string;
  variant: "invite" | "added";
}): string {
  const { inviterName, activityName, activityEmoji, actionUrl, appUrl, variant } = vars;
  const headline = variant === "invite"
    ? `${escapeHtml(inviterName)} invited you to pack for`
    : `${escapeHtml(inviterName)} added you to`;
  const activityDisplay = `${activityEmoji ? escapeHtml(activityEmoji) + " " : ""}${escapeHtml(activityName)}`;
  const ctaLabel = variant === "invite" ? "Join the packing list →" : "Open the packing list →";
  const preheader = "Track gear, build lists, and pack smarter together — tap to open your invite.";
  const appHost = appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>${PRODUCT_NAME} invite</title>
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
                      <div style="font-size:46px;line-height:1.02;font-weight:800;letter-spacing:-0.035em;color:#1a1d23;">Gear up.</div>
                      <div style="font-size:46px;line-height:1.02;font-weight:800;letter-spacing:-0.035em;color:#1a1d23;opacity:0.65;">Get out.</div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:20px 8px 6px 8px;">
                      <div style="font-size:17px;line-height:1.45;color:#1a1d23;">
                        ${headline}
                      </div>
                      <div style="font-size:22px;line-height:1.3;font-weight:700;color:#1a1d23;margin-top:6px;">
                        “${activityDisplay}”
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 8px 8px 8px;">
                      <p style="margin:0;font-size:15px;line-height:1.55;color:#5b6270;text-align:center;">
                        ${PRODUCT_NAME} helps outdoor folks track their gear and build shared packing lists — so you show up to the trailhead with everything you need, and nothing you don't.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:24px 0 8px 0;">
                      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#4c5fd5;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:12px;min-width:240px;text-align:center;">
                        ${escapeHtml(ctaLabel)}
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:16px 8px 0 8px;">
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
                  ${variant === "invite"
                    ? `If you weren't expecting this, you can ignore this email — no account will be created until you accept.`
                    : `Already have a ${PRODUCT_NAME} account? Sign in at <a href="${escapeHtml(appUrl)}" style="color:#4c5fd5;text-decoration:none;">${escapeHtml(appHost)}</a> to see the list.`}
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

function buildEmailText(vars: {
  inviterName: string;
  activityName: string;
  activityEmoji: string;
  actionUrl: string;
  variant: "invite" | "added";
}): string {
  const { inviterName, activityName, activityEmoji, actionUrl, variant } = vars;
  const activityDisplay = `${activityEmoji ? activityEmoji + " " : ""}${activityName}`;
  const headline = variant === "invite"
    ? `${inviterName} invited you to pack for "${activityDisplay}" on ${PRODUCT_NAME}.`
    : `${inviterName} added you to "${activityDisplay}" on ${PRODUCT_NAME}.`;
  return [
    headline,
    "",
    `${PRODUCT_NAME} helps outdoor folks track their gear and build shared packing lists — so you show up to the trailhead with everything you need, and nothing you don't.`,
    "",
    variant === "invite" ? "Join the packing list:" : "Open the packing list:",
    actionUrl,
    "",
    variant === "invite"
      ? "If you weren't expecting this, you can ignore this email — no account will be created until you accept."
      : "",
  ].filter(Boolean).join("\n");
}

function buildSubject(vars: {
  inviterName: string;
  activityName: string;
  activityEmoji: string;
  variant: "invite" | "added";
  hasDisplayName: boolean;
}): string {
  const { inviterName, activityName, activityEmoji, variant, hasDisplayName } = vars;
  const emoji = activityEmoji ? ` ${activityEmoji}` : "";
  if (variant === "added") {
    return `${inviterName} added you to pack "${activityName}"${emoji}`;
  }
  if (hasDisplayName) {
    return `${inviterName} wants to pack "${activityName}" with you${emoji}`;
  }
  return `A friend invited you to pack "${activityName}" on ${PRODUCT_NAME}${emoji}`;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
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
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        subject,
        html,
        text,
      }),
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

// ---- Main handler ----------------------------------------------------------

async function verifyCallerIsOwner(
  token: string,
  activityId: string,
): Promise<{ name: string; emoji: string | null } | null> {
  // Use the caller's JWT so RLS enforces "is the owner": a non-owner will
  // get an empty result because the owner-only UPDATE/DELETE policies are
  // gone, but owner_id is still accessible via the member SELECT policy.
  // Belt-and-suspenders: explicit owner_id check too.
  const res = await restGet(
    `${SUPABASE_URL}/rest/v1/activities?id=eq.${activityId}&select=id,name,emoji,owner_id`,
    token,
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  // Compare owner_id to the authenticated user by re-fetching the user.
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY! },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (row.owner_id !== user.id) return null;
  return { name: row.name, emoji: row.emoji };
}

async function getInviterName(token: string, userId: string): Promise<string> {
  try {
    const res = await restGet(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=display_name`,
      token,
    );
    if (!res.ok) return "A friend";
    const rows = await res.json();
    const name = Array.isArray(rows) && rows.length > 0 ? rows[0]?.display_name : null;
    return (typeof name === "string" && name.trim()) ? name.trim() : "A friend";
  } catch {
    return "A friend";
  }
}

async function addMember(activityId: string, userId: string): Promise<any | null> {
  const res = await restAdmin(`/rest/v1/activity_members`, {
    method: "POST",
    headers: { "prefer": "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify({ activity_id: activityId, user_id: userId, role: "member" }),
  });
  if (!res.ok) {
    console.error(`addMember ${res.status}: ${await res.text()}`);
    return null;
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function upsertInvite(
  activityId: string,
  email: string,
  invitedBy: string,
): Promise<{ id: string; token: string } | null> {
  // Try insert first; if a pending invite for (activity_id, email) already
  // exists, fetch it and reuse the token (so the user just gets a fresh email).
  const insertRes = await restAdmin(`/rest/v1/activity_invites`, {
    method: "POST",
    headers: { "prefer": "return=representation" },
    body: JSON.stringify({
      activity_id: activityId,
      email,
      invited_by: invitedBy,
    }),
  });
  if (insertRes.ok) {
    const rows = await insertRes.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { id: row.id, token: row.token };
  }
  // Fall back to looking up the pending row.
  const lookupRes = await restAdmin(
    `/rest/v1/activity_invites?activity_id=eq.${activityId}&email=eq.${encodeURIComponent(email)}&accepted_at=is.null&select=id,token`,
  );
  if (!lookupRes.ok) return null;
  const rows = await lookupRes.json();
  if (Array.isArray(rows) && rows.length > 0) {
    return { id: rows[0].id, token: rows[0].token };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const auth = await requireAuth(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const allowed = await checkRateLimit(auth.token, "share_activity", 20, 3600);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "You've sent a lot of invites recently. Try again in an hour." }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "3600", ...CORS_HEADERS },
      },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const activityId = typeof body?.activity_id === "string" ? body.activity_id.trim() : "";
  let rawEmail = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const resendToken = typeof body?.resend_invite_token === "string" ? body.resend_invite_token.trim() : "";

  if (!activityId) {
    return json({ error: "activity_id is required" }, 400);
  }
  if (!rawEmail && !resendToken) {
    return json({ error: "email or resend_invite_token is required" }, 400);
  }

  // Remind-flow: resolve the target email from the invite row. Must belong to
  // this activity and still be unaccepted.
  if (!rawEmail && resendToken) {
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/activity_invites?token=eq.${encodeURIComponent(resendToken)}` +
        `&activity_id=eq.${encodeURIComponent(activityId)}` +
        `&select=email,accepted_at&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!lookupRes.ok) return json({ error: "Couldn't look up that invite." }, 500);
    const rows = await lookupRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json({ error: "Invite not found for this list." }, 404);
    if (row.accepted_at) return json({ error: "That invite has already been accepted." }, 409);
    rawEmail = String(row.email || "").trim().toLowerCase();
    if (!rawEmail) return json({ error: "Invite row is missing an email." }, 500);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return json({ error: "That doesn't look like a valid email." }, 400);
  }

  // Confirm caller owns the activity and grab name/emoji for the email.
  const activity = await verifyCallerIsOwner(auth.token, activityId);
  if (!activity) return json({ error: "You don't have permission to share this list." }, 403);

  // Don't let the owner invite themselves.
  const callerEmailRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${auth.token}`, apikey: SUPABASE_ANON_KEY },
  });
  const callerUser = callerEmailRes.ok ? await callerEmailRes.json() : null;
  if (callerUser?.email && callerUser.email.toLowerCase() === rawEmail) {
    return json({ error: "You're already on this list." }, 400);
  }

  const inviterRawName = await getInviterName(auth.token, auth.userId);
  const inviterName = inviterRawName && inviterRawName !== "A friend" ? inviterRawName : "A friend";
  const hasDisplayName = inviterName !== "A friend";

  const existingUserId = await lookupUserByEmail(rawEmail);

  if (existingUserId) {
    // Already has an account — add directly and send a notification email.
    const member = await addMember(activityId, existingUserId);
    if (!member) return json({ error: "Couldn't add this user to the list." }, 500);

    const actionUrl = `${APP_URL.replace(/\/+$/, "")}/?activity=${encodeURIComponent(activityId)}`;
    const subject = buildSubject({
      inviterName, activityName: activity.name, activityEmoji: activity.emoji || "",
      variant: "added", hasDisplayName,
    });
    const html = buildEmailHtml({
      inviterName, activityName: activity.name, activityEmoji: activity.emoji || "",
      actionUrl, appUrl: APP_URL, variant: "added",
    });
    const text = buildEmailText({
      inviterName, activityName: activity.name, activityEmoji: activity.emoji || "",
      actionUrl, variant: "added",
    });
    await sendEmail(rawEmail, subject, html, text);
    return json({ status: "added", member });
  }

  // New user: create a pending invite + generate the invite-type action URL.
  const invite = await upsertInvite(activityId, rawEmail, auth.userId);
  if (!invite) return json({ error: "Couldn't create the invite." }, 500);

  const redirectTo = `${APP_URL.replace(/\/+$/, "")}/?invite=${encodeURIComponent(invite.token)}`;
  const actionUrl = await generateAdminLink("invite", rawEmail, redirectTo);
  if (!actionUrl) return json({ error: "Couldn't create the sign-up link." }, 500);

  const subject = buildSubject({
    inviterName, activityName: activity.name, activityEmoji: activity.emoji || "",
    variant: "invite", hasDisplayName,
  });
  const html = buildEmailHtml({
    inviterName, activityName: activity.name, activityEmoji: activity.emoji || "",
    actionUrl, appUrl: APP_URL, variant: "invite",
  });
  const text = buildEmailText({
    inviterName, activityName: activity.name, activityEmoji: activity.emoji || "",
    actionUrl, variant: "invite",
  });
  const sent = await sendEmail(rawEmail, subject, html, text);

  return json({
    status: "invited",
    invite: { id: invite.id, email: rawEmail, email_sent: sent },
  });
});
