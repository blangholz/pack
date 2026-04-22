// Supabase Edge Function: accept-share-link
// Enrolls the authenticated caller into an activity identified by a share-
// link token. The companion to share-link-preview (anonymous lookup).
//
// Request body (JSON):
//   { "token": "<share token from ?share= URL>" }
//
// Response (JSON):
//   { activity_id: "<uuid>", activity_name, activity_emoji, inviter_name }
//
// Flow:
//   1. Caller authenticates (JWT).
//   2. Resolve token → activity_id via service role (bypass RLS).
//   3. Upsert activity_members (idempotent: merge-duplicates).
//   4. Return activity_id + enrichment so the client can render a welcome
//      banner and, if needed, the onboarding modal.
//
// Auth note mirrors share-activity: verify_jwt is off at the gateway because
// we issue ES256-signed JWTs that it can't verify. We re-validate the caller's
// token against /auth/v1/user inside the function.

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

async function requireAuth(
  req: Request,
): Promise<{ userId: string; email: string; token: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const user = await res.json();
    const email = typeof user?.email === "string" ? user.email : "";
    const userId = typeof user?.id === "string" ? user.id : "";
    if (!email || !userId) return null;
    return { userId, email, token };
  } catch {
    return null;
  }
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

async function fetchEnrichment(
  activityId: string,
  inviterUserId: string | null | undefined,
): Promise<{ activity_name: string | null; activity_emoji: string | null; inviter_name: string | null }> {
  let activity_name: string | null = null;
  let activity_emoji: string | null = null;
  let inviter_name: string | null = null;
  try {
    const aRes = await restAdmin(
      `/rest/v1/activities?id=eq.${activityId}&select=name,emoji`,
    );
    if (aRes.ok) {
      const rows = await aRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        activity_name = typeof rows[0].name === "string" ? rows[0].name : null;
        activity_emoji = typeof rows[0].emoji === "string" ? rows[0].emoji : null;
      }
    }
  } catch {}
  if (inviterUserId) {
    try {
      const pRes = await restAdmin(
        `/rest/v1/profiles?id=eq.${inviterUserId}&select=display_name`,
      );
      if (pRes.ok) {
        const rows = await pRes.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const name = rows[0].display_name;
          inviter_name = typeof name === "string" && name.trim() ? name.trim() : null;
        }
      }
    } catch {}
  }
  return { activity_name, activity_emoji, inviter_name };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const auth = await requireAuth(req);
  if (!auth) return json({ error: "Please sign in to join this list." }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return json({ error: "Missing share token." }, 400);

  // Resolve token → activity_id (+ owner for enrichment).
  const linkRes = await restAdmin(
    `/rest/v1/activity_share_links?token=eq.${encodeURIComponent(token)}&select=activity_id`,
  );
  if (!linkRes.ok) return json({ error: "Couldn't verify this link." }, 500);
  const rows = await linkRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: "This share link is invalid." }, 404);
  }
  const activityId = rows[0].activity_id;

  // Owner lookup for enrichment (inviter_name).
  let ownerId: string | null = null;
  try {
    const ownerRes = await restAdmin(
      `/rest/v1/activities?id=eq.${activityId}&select=owner_id`,
    );
    if (ownerRes.ok) {
      const ownerRows = await ownerRes.json();
      if (Array.isArray(ownerRows) && ownerRows.length > 0) {
        ownerId = ownerRows[0].owner_id || null;
      }
    }
  } catch {}

  // Enrol as member. Idempotent — if they're already a member, merge-duplicates
  // leaves the existing row alone.
  const addRes = await restAdmin(`/rest/v1/activity_members`, {
    method: "POST",
    headers: { "prefer": "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify({
      activity_id: activityId,
      user_id: auth.userId,
      role: "member",
    }),
  });
  if (!addRes.ok) {
    console.error(`accept-share-link addMember ${addRes.status}: ${await addRes.text()}`);
    return json({ error: "Couldn't add you to the list." }, 500);
  }

  const enrichment = await fetchEnrichment(activityId, ownerId);

  return json({ activity_id: activityId, ...enrichment });
});
