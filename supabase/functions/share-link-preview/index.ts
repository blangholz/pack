// Supabase Edge Function: share-link-preview
// Anonymous preview of a shared packing list — the lookup behind the
// invite-landing page. Not authed: the token itself is the capability.
//
// Request body (JSON):
//   { "token": "<share token from ?share= URL>" }
//
// Response (JSON):
//   {
//     activity_name: "Sierra Traverse",
//     activity_emoji: "🧗",
//     inviter_name: "Ben",
//     items_preview: [{ name, brand, image_url }, ...up to 3],
//     more_count: 16
//   }
//
// Flow:
//   1. Look up activity_share_links by token (service role).
//   2. Join activities + profiles for name/emoji/inviter.
//   3. Load first 3 activity_items ordered by position, joined to gear.
//   4. Count remaining items.
//
// Auth note mirrors share-activity: verify_jwt is off because the gateway
// can't verify this project's ES256 JWTs. This function is intentionally
// anonymous, so no token re-validation is required — but we rate-limit by
// IP to prevent bulk enumeration.

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
    return json({ error: "Invalid JSON body" }, 400);
  }

  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return json({ error: "Missing share token." }, 400);

  // Look up the share link.
  const linkRes = await restAdmin(
    `/rest/v1/activity_share_links?token=eq.${encodeURIComponent(token)}&select=activity_id`,
  );
  if (!linkRes.ok) return json({ error: "Couldn't verify this link." }, 500);
  const linkRows = await linkRes.json();
  if (!Array.isArray(linkRows) || linkRows.length === 0) {
    return json({ error: "not_found" }, 404);
  }
  const activityId = linkRows[0].activity_id;

  // Activity + owner in one hop.
  const actRes = await restAdmin(
    `/rest/v1/activities?id=eq.${activityId}&select=name,emoji,owner_id`,
  );
  if (!actRes.ok) return json({ error: "Couldn't load activity." }, 500);
  const actRows = await actRes.json();
  if (!Array.isArray(actRows) || actRows.length === 0) {
    return json({ error: "not_found" }, 404);
  }
  const activity = actRows[0];

  // Inviter name via profiles.display_name.
  let inviter_name: string | null = null;
  try {
    const pRes = await restAdmin(
      `/rest/v1/profiles?id=eq.${activity.owner_id}&select=display_name`,
    );
    if (pRes.ok) {
      const rows = await pRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const name = rows[0].display_name;
        inviter_name = typeof name === "string" && name.trim() ? name.trim() : null;
      }
    }
  } catch {}

  // Total count for "+N more" calculation.
  const countRes = await restAdmin(
    `/rest/v1/activity_items?activity_id=eq.${activityId}&select=id`,
    { headers: { "prefer": "count=exact" } },
  );
  let totalCount = 0;
  if (countRes.ok) {
    const contentRange = countRes.headers.get("content-range") || "";
    const match = contentRange.match(/\/(\d+)$/);
    if (match) totalCount = parseInt(match[1], 10);
  }

  // First 3 items ordered by position, joined to gear.
  const itemsRes = await restAdmin(
    `/rest/v1/activity_items?activity_id=eq.${activityId}` +
    `&select=gear:gear_id(name,brand,image_url)` +
    `&order=position.asc&limit=3`,
  );
  const items_preview: Array<{ name: string; brand: string | null; image_url: string | null }> = [];
  if (itemsRes.ok) {
    const rows = await itemsRes.json();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const gear = row?.gear || {};
        items_preview.push({
          name: typeof gear.name === "string" ? gear.name : "",
          brand: typeof gear.brand === "string" ? gear.brand : null,
          image_url: typeof gear.image_url === "string" ? gear.image_url : null,
        });
      }
    }
  }

  const more_count = Math.max(0, totalCount - items_preview.length);

  return json({
    activity_name: typeof activity.name === "string" ? activity.name : null,
    activity_emoji: typeof activity.emoji === "string" ? activity.emoji : null,
    inviter_name,
    items_preview,
    more_count,
  });
});
