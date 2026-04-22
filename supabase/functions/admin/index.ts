// Supabase Edge Function: admin
//
// Read-only administrative dashboard backend. Access is gated at three layers:
//   1. Caller must have a valid Supabase session JWT (requireAuth).
//   2. The SQL function public.is_admin() must return true for the caller's
//      JWT — checked server-side here, never trusted from the client.
//   3. Only after both pass do we fall back to the service-role key for
//      cross-user reads. The client never sees the service-role key.
//
// Request: GET /functions/v1/admin?view=<summary|users|user|daily>[&id=<uuid>]
// Response: JSON, shape varies per view. See README / plan doc.
//
// Gateway verify_jwt is OFF for this function (project uses ES256 JWTs that
// the gateway can't verify). Auth happens inside via /auth/v1/user.

// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

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

async function isAdmin(token: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
        "apikey": SUPABASE_ANON_KEY,
      },
      body: "{}",
    });
    if (!res.ok) return false;
    const allowed = await res.json();
    return allowed === true;
  } catch {
    return false;
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

// REST helper bound to the service role. Used only AFTER admin identity
// has been verified. Queries bypass RLS.
async function restAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_SERVICE_ROLE_KEY || "");
  headers.set("authorization", `Bearer ${SUPABASE_SERVICE_ROLE_KEY || ""}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function restAdminJson<T = any>(path: string): Promise<T> {
  const res = await restAdmin(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`rest ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// Count via PostgREST's count=exact header. We ask for zero rows and read
// the total off Content-Range (format: "items 0-0/123" or "*/123").
async function countRows(table: string): Promise<number> {
  const res = await restAdmin(`${table}?select=id`, {
    method: "GET",
    headers: { prefer: "count=exact", range: "0-0" },
  });
  const cr = res.headers.get("content-range") || "";
  const m = cr.match(/\/(\d+)$/);
  return m ? parseInt(m[1], 10) || 0 : 0;
}

// Supabase Auth Admin API: list users with email, created_at, last_sign_in_at.
// Paginated; we pull up to 1000/page which is plenty for a class app.
interface AuthUser {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
}
async function listAuthUsers(): Promise<AuthUser[]> {
  const perPage = 1000;
  const all: AuthUser[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?per_page=${perPage}&page=${page}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY || "",
          authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY || ""}`,
        },
      },
    );
    if (!res.ok) break;
    const body = await res.json();
    const users = Array.isArray(body?.users) ? body.users : [];
    if (users.length === 0) break;
    all.push(...users);
    if (users.length < perPage) break;
  }
  return all;
}

// -------- views --------

async function viewSummary() {
  const [users, gear, activities, activity_items, custom_filters, activity_members] = await Promise.all([
    listAuthUsers(),
    countRows("gear"),
    countRows("activities"),
    countRows("activity_items"),
    countRows("custom_filters"),
    countRows("activity_members"),
  ]);
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  let activeSevenDay = 0;
  let activeToday = 0;
  let newSevenDay = 0;
  for (const u of users) {
    const lastSeen = u.last_sign_in_at ? Date.parse(u.last_sign_in_at) : 0;
    const created = u.created_at ? Date.parse(u.created_at) : 0;
    if (lastSeen >= sevenDaysAgo) activeSevenDay++;
    if (lastSeen >= oneDayAgo) activeToday++;
    if (created >= sevenDaysAgo) newSevenDay++;
  }
  return {
    totals: {
      users: users.length,
      gear,
      activities,
      activity_items,
      custom_filters,
      activity_members,
    },
    active: {
      last_24h: activeToday,
      last_7d: activeSevenDay,
      new_7d: newSevenDay,
    },
  };
}

async function viewUsers() {
  // Fetch auth.users (for email + signup + last sign-in), plus all gear/
  // activities/activity_items rows so we can aggregate per-owner counts in JS.
  // Scale note: with <100 users and <10k rows this is instant; revisit if
  // the app outgrows that.
  const [users, gearRows, activityRows, itemRows, profiles] = await Promise.all([
    listAuthUsers(),
    restAdminJson<{ owner_id: string }[]>("gear?select=owner_id"),
    restAdminJson<{ owner_id: string }[]>("activities?select=owner_id"),
    restAdminJson<{ added_by: string | null }[]>("activity_items?select=added_by"),
    restAdminJson<{ id: string; display_name: string | null; email: string | null }[]>(
      "profiles?select=id,display_name,email",
    ),
  ]);
  const gearByOwner = new Map<string, number>();
  for (const r of gearRows) gearByOwner.set(r.owner_id, (gearByOwner.get(r.owner_id) || 0) + 1);
  const actsByOwner = new Map<string, number>();
  for (const r of activityRows) actsByOwner.set(r.owner_id, (actsByOwner.get(r.owner_id) || 0) + 1);
  const itemsByAdder = new Map<string, number>();
  for (const r of itemRows) {
    if (!r.added_by) continue;
    itemsByAdder.set(r.added_by, (itemsByAdder.get(r.added_by) || 0) + 1);
  }
  const profileById = new Map<string, { display_name: string | null }>();
  for (const p of profiles) profileById.set(p.id, { display_name: p.display_name });
  return {
    users: users.map((u) => ({
      id: u.id,
      email: u.email || null,
      display_name: profileById.get(u.id)?.display_name || null,
      created_at: u.created_at || null,
      last_sign_in_at: u.last_sign_in_at || null,
      gear_count: gearByOwner.get(u.id) || 0,
      activities_count: actsByOwner.get(u.id) || 0,
      items_added_count: itemsByAdder.get(u.id) || 0,
    })),
  };
}

async function viewUser(userId: string) {
  const encoded = encodeURIComponent(userId);
  const [users, profile, gear, activities, items] = await Promise.all([
    listAuthUsers(),
    restAdminJson<any[]>(
      `profiles?id=eq.${encoded}&select=id,display_name,display_unit,email,created_at,updated_at`,
    ),
    restAdminJson<any[]>(
      `gear?owner_id=eq.${encoded}&select=id,name,brand,weight_grams,quantity,created_at,updated_at&order=created_at.desc`,
    ),
    restAdminJson<any[]>(
      `activities?owner_id=eq.${encoded}&select=id,name,emoji,position,created_at,updated_at&order=position.asc.nullslast,created_at.asc`,
    ),
    restAdminJson<any[]>(
      `activity_items?added_by=eq.${encoded}&select=id,activity_id,gear_id,quantity,packed,note,created_at&order=created_at.desc&limit=10`,
    ),
  ]);
  const authUser = users.find((u) => u.id === userId) || null;
  // Per-activity item counts + member counts for this user's activities.
  const activityIds = activities.map((a) => a.id);
  let itemCounts = new Map<string, number>();
  let memberCounts = new Map<string, number>();
  if (activityIds.length) {
    const ids = activityIds.map((id) => `"${id}"`).join(",");
    const [actItems, actMembers] = await Promise.all([
      restAdminJson<{ activity_id: string }[]>(
        `activity_items?activity_id=in.(${ids})&select=activity_id`,
      ),
      restAdminJson<{ activity_id: string }[]>(
        `activity_members?activity_id=in.(${ids})&select=activity_id`,
      ),
    ]);
    for (const r of actItems) itemCounts.set(r.activity_id, (itemCounts.get(r.activity_id) || 0) + 1);
    for (const r of actMembers) memberCounts.set(r.activity_id, (memberCounts.get(r.activity_id) || 0) + 1);
  }
  // Hydrate recent items with the gear name (we only have gear_id).
  const recentGearIds = Array.from(new Set(items.map((i) => i.gear_id).filter(Boolean)));
  let gearNames = new Map<string, string>();
  if (recentGearIds.length) {
    const ids = recentGearIds.map((id) => `"${id}"`).join(",");
    const rows = await restAdminJson<{ id: string; name: string }[]>(
      `gear?id=in.(${ids})&select=id,name`,
    );
    for (const g of rows) gearNames.set(g.id, g.name);
  }
  return {
    user: authUser && {
      id: authUser.id,
      email: authUser.email || null,
      created_at: authUser.created_at || null,
      last_sign_in_at: authUser.last_sign_in_at || null,
    },
    profile: profile[0] || null,
    gear,
    activities: activities.map((a) => ({
      ...a,
      item_count: itemCounts.get(a.id) || 0,
      member_count: memberCounts.get(a.id) || 0,
    })),
    recent_items: items.map((i) => ({
      ...i,
      gear_name: i.gear_id ? gearNames.get(i.gear_id) || null : null,
    })),
  };
}

// Pull last-30-days rows and bucket them by UTC day.
function bucketByDay(rows: { created_at: string }[], days = 30): Record<string, number> {
  const out: Record<string, number> = {};
  // Seed 30 days of zero buckets so client can render without gaps.
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out[d.toISOString().slice(0, 10)] = 0;
  }
  for (const r of rows) {
    if (!r.created_at) continue;
    const k = r.created_at.slice(0, 10);
    if (k in out) out[k] = (out[k] || 0) + 1;
  }
  return out;
}

async function viewDaily() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [profiles, gear, items] = await Promise.all([
    restAdminJson<{ created_at: string }[]>(
      `profiles?created_at=gte.${since}&select=created_at`,
    ),
    restAdminJson<{ created_at: string }[]>(
      `gear?created_at=gte.${since}&select=created_at`,
    ),
    restAdminJson<{ created_at: string }[]>(
      `activity_items?created_at=gte.${since}&select=created_at`,
    ),
  ]);
  return {
    days: 30,
    signups: bucketByDay(profiles),
    gear: bucketByDay(gear),
    items: bucketByDay(items),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase env not configured" }, 500);
  }

  const auth = await requireAuth(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const admin = await isAdmin(auth.token);
  if (!admin) return json({ error: "Forbidden" }, 403);

  const allowed = await checkRateLimit(auth.token, "admin", 120, 60);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded." }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60", ...CORS_HEADERS },
      },
    );
  }

  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "summary";

  try {
    if (view === "summary") return json(await viewSummary());
    if (view === "users") return json(await viewUsers());
    if (view === "user") {
      const id = url.searchParams.get("id") || "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid user id" }, 400);
      return json(await viewUser(id));
    }
    if (view === "daily") return json(await viewDaily());
    return json({ error: "Unknown view" }, 400);
  } catch (err) {
    console.error("[admin] error:", err);
    return json({ error: (err as Error).message || "Admin query failed" }, 500);
  }
});
