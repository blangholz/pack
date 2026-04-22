// Supabase Edge Function: accept-invite
// Consumes an invite token after a user signs in, enrolling them as a member.
//
// Request body (JSON):
//   { "token": "<invite token from ?invite= URL>" }
//
// Response (JSON):
//   { activity_id: "<uuid>" }   on success
//   { error: "..." }            otherwise
//
// Flow:
//   1. Caller authenticates (normal JWT) — the invite URL sends them through
//      the Supabase magic-link/invite verification first, so by the time the
//      client calls this function the user has a session.
//   2. Look up the invite by token (service role). Validate it exists and is
//      unaccepted.
//   3. Confirm the caller's email matches the invite's email (case-insensitive).
//   4. Insert activity_members row (service role, bypass RLS) and mark the
//      invite accepted_at.
//   5. Return activity_id so the client can switch to it.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const auth = await requireAuth(req);
  if (!auth) return json({ error: "Please sign in to accept this invite." }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return json({ error: "Missing invite token." }, 400);

  // Look up the invite.
  const lookupRes = await restAdmin(
    `/rest/v1/activity_invites?token=eq.${encodeURIComponent(token)}&select=id,activity_id,email,accepted_at,invited_by`,
  );
  if (!lookupRes.ok) return json({ error: "Couldn't verify this invite." }, 500);
  const rows = await lookupRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: "This invite link is invalid or has expired." }, 404);
  }
  const invite = rows[0];

  // Enrich with activity + inviter context so the client can render the
  // onboarding modal ("Ben invited you to 'Sierra Traverse' …").
  const enrichment = await fetchInviteContext(invite.activity_id, invite.invited_by);

  if (invite.accepted_at) {
    // Already accepted — idempotent success: just return the activity id so
    // the client can navigate there.
    return json({
      activity_id: invite.activity_id,
      already_accepted: true,
      ...enrichment,
    });
  }

  if (invite.email.toLowerCase() !== auth.email.toLowerCase()) {
    return json({
      error: "This invite was sent to a different email. Sign in with that address to accept.",
    }, 403);
  }

  // Enrol as member (service role bypasses RLS). merge-duplicates makes it
  // idempotent — if they're already a member somehow, this is a no-op.
  const addRes = await restAdmin(`/rest/v1/activity_members`, {
    method: "POST",
    headers: { "prefer": "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify({
      activity_id: invite.activity_id,
      user_id: auth.userId,
      role: "member",
    }),
  });
  if (!addRes.ok) {
    console.error(`accept-invite addMember ${addRes.status}: ${await addRes.text()}`);
    return json({ error: "Couldn't add you to the list." }, 500);
  }

  // Mark the invite accepted.
  await restAdmin(`/rest/v1/activity_invites?id=eq.${invite.id}`, {
    method: "PATCH",
    body: JSON.stringify({ accepted_at: new Date().toISOString() }),
  });

  return json({ activity_id: invite.activity_id, ...enrichment });
});

async function fetchInviteContext(
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
