// Supabase Edge Function: generate-suggestions
// Seed the generic_suggestions table with ~12 activity-specific items
// (hat, map, trekking poles, …) so the client can render a chip row at
// the bottom of the packing list. Called once per activity on first open
// from the client when the cache is empty.
//
// Request body (JSON): { "activity_id": "<uuid>" }
//
// Response body (JSON): { "suggestions": [{ id, name, emoji, position }, …] }
//
// Auth: same pattern as extract-gear. Gateway can't verify ES256 JWTs, so
// verify_jwt is off in config.toml and we re-validate inside via /auth/v1/user.
// After auth we use the service-role key to load the activity + existing gear
// names (bypassing RLS for read-through) and to batch-insert the suggestions.

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MODEL = "claude-haiku-4-5-20251001";
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

const CLAUDE_429_BACKOFF_MS = [3_000, 10_000, 20_000];

async function callClaude(messages: any[], maxTokens = 1200) {
  const body: Record<string, unknown> = { model: MODEL, max_tokens: maxTokens, messages };
  const maxAttempts = CLAUDE_429_BACKOFF_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < CLAUDE_429_BACKOFF_MS.length) {
      const ra = parseInt(res.headers.get("retry-after") || "0", 10);
      const waitMs = Math.max(
        Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0,
        CLAUDE_429_BACKOFF_MS[attempt],
      );
      console.warn(`Claude 429 — attempt ${attempt + 1}/${maxAttempts}, retrying after ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`Claude ${res.status}: ${text.slice(0, 500)}`);
      if (res.status === 429) {
        throw new Error("We're temporarily over Claude's rate limit — wait ~30 seconds and try again.");
      }
      if (res.status >= 500) {
        throw new Error("Claude is temporarily unavailable. Please try again.");
      }
      throw new Error("Claude couldn't complete that request.");
    }
    const payload = await res.json();
    const parts = Array.isArray(payload?.content) ? payload.content : [];
    return parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  }
  throw new Error("We're temporarily over Claude's rate limit — wait ~30 seconds and try again.");
}

function coerceJson(text: string): Record<string, any> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model returned no JSON");
  return JSON.parse(match[0]);
}

// PostgREST helper: call the given endpoint with the service-role key.
// Used to read the activity + existing gear names without going through
// RLS, and to batch-insert the final suggestions.
async function pgFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service role not configured");
  }
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SUPABASE_SERVICE_ROLE_KEY);
  headers.set("authorization", `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers });
}

// Returns true if the user is a member (or owner) of the activity — mirrors
// public.is_activity_member in SQL. Lets us 403 non-members before we spend
// Claude credits.
async function isActivityMember(userId: string, activityId: string): Promise<boolean> {
  const ownerRes = await pgFetch(
    `/activities?id=eq.${activityId}&owner_id=eq.${userId}&select=id`,
  );
  if (ownerRes.ok) {
    const rows = await ownerRes.json();
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  const memberRes = await pgFetch(
    `/activity_members?activity_id=eq.${activityId}&user_id=eq.${userId}&select=activity_id`,
  );
  if (!memberRes.ok) return false;
  const rows = await memberRes.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function loadActivity(activityId: string): Promise<{ name: string; emoji: string } | null> {
  const res = await pgFetch(`/activities?id=eq.${activityId}&select=name,emoji`);
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return {
    name: typeof rows[0]?.name === "string" ? rows[0].name : "",
    emoji: typeof rows[0]?.emoji === "string" ? rows[0].emoji : "",
  };
}

// Existing gear names on this activity — the prompt uses these to avoid
// suggesting overlaps. Pulled via the activity_items → gear join so we see
// the exact names already on the list.
async function loadExistingGearNames(activityId: string): Promise<string[]> {
  const res = await pgFetch(
    `/activity_items?activity_id=eq.${activityId}&select=gear:gear_id(name)`,
  );
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  const names: string[] = [];
  for (const r of rows) {
    const n = r?.gear?.name;
    if (typeof n === "string" && n.trim()) names.push(n.trim());
  }
  return names;
}

async function loadExistingSuggestionNames(activityId: string): Promise<string[]> {
  const res = await pgFetch(
    `/generic_suggestions?activity_id=eq.${activityId}&select=name`,
  );
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any) => (typeof r?.name === "string" ? r.name.trim() : ""))
    .filter(Boolean);
}

async function generateFromClaude(
  activity: { name: string; emoji: string },
  existingNames: string[],
): Promise<Array<{ name: string; emoji: string | null }>> {
  const label = (activity.emoji ? `${activity.emoji} ` : "") + (activity.name || "trip");
  const excludeLine = existingNames.length
    ? `Exclude anything already on the user's list or similar to these: ${existingNames.slice(0, 40).join(", ")}.`
    : `The list is currently empty.`;
  const prompt = [
    `You help users pack for outdoor activities by suggesting generic items they might forget.`,
    ``,
    `Activity: ${label}`,
    `${excludeLine}`,
    ``,
    `Generate 12 GENERIC packing items appropriate for this activity. Rules:`,
    `- Prefer items where the specific brand/model barely matters: toiletries, consumables, simple accessories, clothing categories, documents, small tools.`,
    `- Avoid items where a specific model matters a lot (e.g. backpack, tent, sleeping bag, climbing harness, hiking boots, stove, paraglider, climbing rope). The user will add those as branded gear separately.`,
    `- Keep each name concise and generic (e.g. "Hat", not "Wide-brim sun hat"; "Water bottle", not "Nalgene 32oz").`,
    `- Include a single emoji per item that visually represents it.`,
    `- Tailor to the activity. For "Hiking" include things like hat, snacks, map, blister kit. For "Climbing" include chalk, tape, belay gloves. For "Paragliding" include gloves, sunglasses, radio. For a generic "Trip" lean on universally useful items.`,
    ``,
    `Return ONLY a JSON object — no markdown fences, no prose:`,
    `{`,
    `  "suggestions": [`,
    `    { "name": "Hat", "emoji": "🧢" },`,
    `    …`,
    `  ]`,
    `}`,
  ].join("\n");

  const text = await callClaude([{ role: "user", content: prompt }], 1500);
  const raw = coerceJson(text);
  const items = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  const out: Array<{ name: string; emoji: string | null }> = [];
  const seen = new Set<string>();
  for (const it of items) {
    const name = typeof it?.name === "string" ? it.name.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const emoji = typeof it?.emoji === "string" && it.emoji.trim() ? it.emoji.trim() : null;
    out.push({ name, emoji });
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  if (!SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Service role key not configured" }, 500);

  const auth = await requireAuth(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const allowed = await checkRateLimit(auth.token, "generate_suggestions", 20, 3600);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "You're generating suggestions too fast. Try again in a bit." }),
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
  if (!/^[0-9a-f-]{36}$/i.test(activityId)) {
    return json({ error: "Invalid activity_id" }, 400);
  }

  try {
    const isMember = await isActivityMember(auth.userId, activityId);
    if (!isMember) return json({ error: "Not a member of this activity" }, 403);

    const activity = await loadActivity(activityId);
    if (!activity) return json({ error: "Activity not found" }, 404);

    const [existingNames, existingSuggestions] = await Promise.all([
      loadExistingGearNames(activityId),
      loadExistingSuggestionNames(activityId),
    ]);

    // If the cache already has rows, just return them. The client calls us
    // on first-open when it sees an empty cache; a race (two tabs opening
    // the same activity at once) would otherwise double-spend Claude.
    if (existingSuggestions.length > 0) {
      const res = await pgFetch(
        `/generic_suggestions?activity_id=eq.${activityId}&select=id,name,emoji,position&order=position.asc`,
      );
      const rows = res.ok ? await res.json() : [];
      return json({ suggestions: Array.isArray(rows) ? rows : [], reused: true });
    }

    const generated = await generateFromClaude(activity, existingNames);

    // Defense-in-depth: drop anything matching an item already on the list,
    // even though we told Claude to skip them.
    const existingSet = new Set(existingNames.map(normalizeForMatch));
    const filtered = generated.filter((s) => !existingSet.has(normalizeForMatch(s.name)));

    if (filtered.length === 0) {
      return json({ suggestions: [] });
    }

    const toInsert = filtered.map((s, i) => ({
      activity_id: activityId,
      name: s.name,
      emoji: s.emoji,
      position: i,
    }));

    const insertRes = await pgFetch(`/generic_suggestions?select=id,name,emoji,position`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(toInsert),
    });
    if (!insertRes.ok) {
      const t = await insertRes.text();
      console.error(`generic_suggestions insert ${insertRes.status}: ${t.slice(0, 500)}`);
      return json({ error: "Failed to save suggestions" }, 500);
    }
    const inserted = await insertRes.json();
    return json({ suggestions: Array.isArray(inserted) ? inserted : [] });
  } catch (err) {
    return json({ error: (err as Error).message || "Suggestion generation failed" }, 500);
  }
});
