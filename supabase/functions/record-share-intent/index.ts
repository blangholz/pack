// Supabase Edge Function: record-share-intent
// Called from the share-landing page when a visitor submits their email —
// writes an intent row so we can auto-enrol them after sign-in even when
// the magic-link click happens on a different browser/device than the
// landing submit. Also feeds the re-engagement cron when they never
// complete.
//
// Request body (JSON):
//   { "email": "friend@example.com", "token": "<share token>" }
//
// Response (JSON):
//   { ok: true } on success
//   { ok: false, error: "..." } on client errors
//
// Auth: anonymous. The token itself is the capability — if the caller
// doesn't know a valid share token, they can't write an intent. Same
// posture as share-link-preview.
//
// verify_jwt = false in config.toml.

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
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

// Cheap RFC-5322-ish email sanity check. We're not trying to be RFC-correct,
// just rejecting obvious garbage so we don't pollute the intent table.
function isEmailish(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!email || !token) {
    return json({ ok: false, error: "Missing email or token." }, 400);
  }
  if (!isEmailish(email)) {
    return json({ ok: false, error: "Invalid email." }, 400);
  }

  // Resolve token → activity_id. If the token is bogus, we quietly record
  // nothing and return ok — the landing page doesn't need to know about
  // server-side bookkeeping. (The real magic-link send will fail separately
  // if the token is invalid.)
  const linkRes = await restAdmin(
    `/rest/v1/activity_share_links?token=eq.${encodeURIComponent(token)}&select=activity_id`,
  );
  if (!linkRes.ok) {
    console.error(`[record-share-intent] link lookup ${linkRes.status}`);
    return json({ ok: false, error: "Couldn't verify share link." }, 500);
  }
  const linkRows = await linkRes.json();
  if (!Array.isArray(linkRows) || linkRows.length === 0) {
    // Unknown token — not an error, just nothing to record.
    return json({ ok: true, recorded: false });
  }
  const activityId = linkRows[0].activity_id;

  // Upsert the intent via the SECURITY DEFINER RPC — handles conflict-on-email
  // for us and lives in one place so the schema can change without touching
  // this function.
  const rpcRes = await restAdmin(`/rest/v1/rpc/internal_record_share_intent`, {
    method: "POST",
    body: JSON.stringify({
      p_email: email,
      p_activity_id: activityId,
      p_token: token,
    }),
  });
  if (!rpcRes.ok) {
    console.error(`[record-share-intent] rpc ${rpcRes.status}: ${await rpcRes.text()}`);
    return json({ ok: false, error: "Couldn't record intent." }, 500);
  }

  return json({ ok: true, recorded: true });
});
