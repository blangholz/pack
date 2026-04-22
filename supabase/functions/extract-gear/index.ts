// Supabase Edge Function: extract-gear
// Given a product URL or a screenshot, ask Claude to extract gear fields.
//
// Request body (JSON):
//   { "url": "https://…" }  OR
//   { "image": { "base64": "…", "mediaType": "image/png" }, "mode"?: "screenshot" | "photo", "forceMultiple"?: boolean }
//
// Response body (JSON):
//   { data: { name, brand, weightGrams, url, imageUrl, notes, quantity } }
//   For mode=photo: { data, confidence: 'high'|'medium'|'low', candidates: [...] }
//
// Auth: the Supabase gateway can't verify this project's ES256 JWTs, so
// verify_jwt is off in config.toml. We instead call the Supabase auth API
// from inside the function (see requireUser) to ensure only signed-in users
// can burn our Anthropic spend.

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
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

// Validate the caller's access token against Supabase auth. Returns the
// user id + raw token on success, or null if the token is missing/invalid.
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

// Calls the hit_rate_limit SQL function with the user's JWT so auth.uid()
// resolves server-side. Fails open on infrastructure errors so a DB blip
// doesn't break the app for legitimate users.
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

const EXTRACTION_SCHEMA = `Return ONLY a JSON object — no markdown fences, no prose. Use null when unknown:
{
  "name": string (concise product name without pack-size suffix, e.g. "MiniWire Alpine QuickDraw"),
  "brand": string|null (manufacturer, e.g. "Black Diamond"),
  "weightGrams": number|null (weight of a SINGLE unit in grams — convert from any unit),
  "quantity": number|null (pack size if the product is a multi-pack, e.g. 3 for "3 Pack" or "Set of 3"; otherwise 1),
  "url": string|null (full product URL on the manufacturer's own site — prefer the brand's own site over retailers like REI, Backcountry, Amazon),
  "imageUrl": string|null (direct https URL to the main product image, ideally .jpg/.png/.webp from the manufacturer),
  "notes": string|null (1–2 short sentences: key features, material, size)
}

Once you've identified the product, use your general knowledge about that specific product to fill in fields that may not be directly visible (weight from specs, the manufacturer's product URL, the main product image URL). Only include values you are reasonably confident about — leave anything uncertain as null.`;

async function callClaude(messages: any[], maxTokens = 800, tools?: any[]) {
  const body: Record<string, unknown> = { model: MODEL, max_tokens: maxTokens, messages };
  if (tools && tools.length) body.tools = tools;
  // Up to 2 attempts with backoff on 429 — busy bursts (multi-photo upload)
  // can blip past Anthropic's per-minute limit; one retry usually clears it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt === 0) {
      const ra = parseInt(res.headers.get("retry-after") || "5", 10);
      const waitMs = Math.min(Math.max(Number.isFinite(ra) ? ra : 5, 1), 10) * 1000;
      console.warn(`Claude 429 — retrying after ${waitMs}ms`);
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

function normalize(raw: Record<string, any>, fallbackUrl: string | null) {
  const str = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const qty = num(raw.quantity);
  return {
    name: str(raw.name),
    brand: str(raw.brand),
    weightGrams: num(raw.weightGrams),
    quantity: qty != null && qty >= 1 ? Math.round(qty) : null,
    url: str(raw.url) || fallbackUrl,
    imageUrl: str(raw.imageUrl),
    notes: str(raw.notes),
  };
}

// Verify that an image URL actually resolves to an image. Claude sometimes
// guesses plausible-but-wrong CDN URLs; without this check we persist a
// broken image URL and the UI shows a blank thumbnail.
async function verifyImageUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept": "image/*",
        "range": "bytes=0-1023",
      },
    });
    if (!res.ok && res.status !== 206) return false;
    const ct = res.headers.get("content-type") || "";
    // drain body to release the connection
    try { await res.arrayBuffer(); } catch { /* ignore */ }
    return ct.startsWith("image/");
  } catch {
    return false;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept": "text/html,application/xhtml+xml",
      },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

// Many outdoor-gear sites don't expose og:image but do embed a schema.org
// Product block with an image field. Checking this recovers a lot of cases.
function extractJsonLdImage(html: string, baseUrl: string): string | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of blocks) {
    let parsed: any;
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (stack.length) {
      const node = stack.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
      const t = node["@type"];
      const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
      if (!isProduct) continue;
      const img = node.image;
      let url: string | null = null;
      if (typeof img === "string") url = img;
      else if (Array.isArray(img) && img.length) {
        url = typeof img[0] === "string" ? img[0] : (img[0]?.url ?? null);
      } else if (img && typeof img === "object" && typeof img.url === "string") {
        url = img.url;
      }
      if (url) {
        try { return new URL(url, baseUrl).toString(); } catch { return url; }
      }
    }
  }
  return null;
}

// Magento stores (La Sportiva, Scarpa, several climbing brands) don't emit
// og:image or JSON-LD Product. They embed the gallery as a JSON blob in the
// HTML with "img":"https://…" entries. Grab the first one.
function extractMagentoGalleryImage(html: string, baseUrl: string): string | null {
  const m = html.match(/"img"\s*:\s*"(https?:\\?\/\\?\/[^"]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i);
  if (!m?.[1]) return null;
  const unescaped = m[1].replace(/\\\//g, "/");
  try { return new URL(unescaped, baseUrl).toString(); }
  catch { return unescaped; }
}

function extractOgImage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      try {
        return new URL(m[1], baseUrl).toString();
      } catch {
        return m[1];
      }
    }
  }
  return extractJsonLdImage(html, baseUrl) || extractMagentoGalleryImage(html, baseUrl);
}

async function claudeExtractFromHtml(url: string, html: string) {
  const snippet = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .slice(0, 40_000);
  const prompt = [
    `Extract product details from this outdoor-gear page.`,
    `Product URL: ${url}`,
    "",
    snippet
      ? "HTML snippet (scripts/styles removed):\n" + snippet
      : "No HTML was fetched — use your general knowledge about this product URL.",
    "",
    EXTRACTION_SCHEMA,
  ].join("\n");
  const text = await callClaude([{ role: "user", content: prompt }], 800);
  return normalize(coerceJson(text), url);
}

// Ask Claude for missing fields once we know the product identity.
// A separate, focused prompt gets better recall than the multi-field schema.
async function enrichByIdentity(name: string, brand: string | null) {
  const prompt = [
    `I've identified an outdoor-gear product. Use your knowledge to fill in the fields below.`,
    ``,
    `Brand: ${brand ?? "unknown"}`,
    `Product: ${name}`,
    ``,
    `Return ONLY a JSON object — no markdown, no prose. Use null only if you genuinely have no knowledge:`,
    `{`,
    `  "weightGrams": number|null (weight of a single unit in grams; be specific, don't round vaguely),`,
    `  "url": string|null (full product URL on the manufacturer's own site),`,
    `  "imageUrl": string|null (direct https URL to the main product image)`,
    `}`,
  ].join("\n");
  try {
    const text = await callClaude([{ role: "user", content: prompt }], 300);
    const raw = coerceJson(text);
    const str = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      weightGrams: num(raw.weightGrams),
      url: str(raw.url),
      imageUrl: str(raw.imageUrl),
    };
  } catch {
    return { weightGrams: null, url: null, imageUrl: null };
  }
}

// Autocomplete-style product search. Uses Claude + web_search to list up
// to 5 matching products for the user's query. We keep this cheap: no
// per-result image verification (happens on select), no og:image fetch.
async function searchProducts(query: string) {
  const prompt = [
    `You are an outdoor-gear product search. The user is typing a query into a search box.`,
    ``,
    `Query: "${query}"`,
    ``,
    `Use the web_search tool to find up to 5 specific products that match. Each result should be a concrete product (not a category or review).`,
    ``,
    `Return ONLY a JSON object — no markdown, no prose:`,
    `{`,
    `  "suggestions": [`,
    `    {`,
    `      "name": string (concise product name, no pack-size suffix),`,
    `      "brand": string|null,`,
    `      "weightGrams": number|null (single-unit weight in grams if you know it),`,
    `      "quantity": number|null (pack size if multi-pack, else 1),`,
    `      "url": string|null (manufacturer product page when possible, else reputable retailer),`,
    `      "imageUrl": string|null (direct image URL from the product page),`,
    `      "notes": string|null (1 short sentence: key spec)`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    `Order results by best match first. If the query is too vague to suggest specific products, return an empty array.`,
  ].join("\n");
  const text = await callClaude(
    [{ role: "user", content: prompt }],
    4000,
    [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
  );
  let raw: Record<string, any>;
  try {
    raw = coerceJson(text);
  } catch (e) {
    throw new Error(`search: could not parse model output: ${text.slice(0, 200)}`);
  }
  const items = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  return items.slice(0, 5).map((r: any) => normalize(r, null));
}

// Use Claude's web_search tool to find a product page URL when we don't have one
// (or the one we have doesn't resolve). The caller then fetches the page for og:image.
async function searchWebForProductUrl(name: string, brand: string | null): Promise<string | null> {
  const query = brand ? `${brand} ${name}` : name;
  const prompt = [
    `Search the web to find the product page for this outdoor-gear item:`,
    ``,
    `Product: ${query}`,
    ``,
    `Prefer the manufacturer's own site; otherwise a reputable retailer (REI, Backcountry, MEC, Moosejaw).`,
    `The page must be an actual product/detail page — not a category, review, or blog post.`,
    ``,
    `Return ONLY a JSON object, no markdown or prose:`,
    `{ "url": string|null }`,
  ].join("\n");
  try {
    const text = await callClaude(
      [{ role: "user", content: prompt }],
      1500,
      [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    );
    const raw = coerceJson(text);
    const v = raw.url;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

// Enrich a known product (by name + optional brand) with a verified thumbnail,
// a manufacturer URL, and a weight guess. Used after the user picks a search
// suggestion — guarantees at least one web-search attempt for an image.
async function extractFromIdentity(name: string, brand: string | null) {
  const enriched = await enrichByIdentity(name, brand);
  let imageUrl: string | null = enriched.imageUrl;
  let url: string | null = enriched.url;

  if (imageUrl && !(await verifyImageUrl(imageUrl))) imageUrl = null;

  if (!imageUrl && url) {
    const html = await fetchHtml(url);
    if (html) {
      const og = extractOgImage(html, url);
      if (og && (await verifyImageUrl(og))) imageUrl = og;
    }
  }

  if (!imageUrl) {
    const searchedUrl = await searchWebForProductUrl(name, brand);
    if (searchedUrl) {
      url = url || searchedUrl;
      const html = await fetchHtml(searchedUrl);
      if (html) {
        const og = extractOgImage(html, searchedUrl);
        if (og && (await verifyImageUrl(og))) imageUrl = og;
      }
    }
  }

  return {
    name,
    brand,
    weightGrams: enriched.weightGrams,
    quantity: null,
    url,
    imageUrl,
    notes: null,
  };
}

async function extractFromUrl(url: string) {
  const html = (await fetchHtml(url)) || "";
  const data = await claudeExtractFromHtml(url, html);
  data.url = data.url || url;
  if (html) {
    const og = extractOgImage(html, url);
    if (og) data.imageUrl = og;
  }
  if (data.imageUrl && !(await verifyImageUrl(data.imageUrl))) data.imageUrl = null;
  if (!data.imageUrl && data.name) {
    const searchedUrl = await searchWebForProductUrl(data.name, data.brand);
    if (searchedUrl) {
      const h = await fetchHtml(searchedUrl);
      if (h) {
        const og = extractOgImage(h, searchedUrl);
        if (og && (await verifyImageUrl(og))) data.imageUrl = og;
      }
    }
  }
  return data;
}

// Shared post-processing: fill gaps via identity, fetch og:image, verify, web-search fallback.
async function enrichGearData(data: ReturnType<typeof normalize>) {
  if (data.name && (!data.weightGrams || !data.url || !data.imageUrl)) {
    const enriched = await enrichByIdentity(data.name, data.brand);
    data.weightGrams = data.weightGrams ?? enriched.weightGrams;
    data.url = data.url || enriched.url;
    data.imageUrl = data.imageUrl || enriched.imageUrl;
  }
  if (data.url) {
    const html = await fetchHtml(data.url);
    if (html) {
      const og = extractOgImage(html, data.url);
      if (og) data.imageUrl = og;
    }
  }
  if (data.imageUrl && !(await verifyImageUrl(data.imageUrl))) data.imageUrl = null;
  if (!data.imageUrl && data.name) {
    const searchedUrl = await searchWebForProductUrl(data.name, data.brand);
    if (searchedUrl) {
      if (!data.url) data.url = searchedUrl;
      const html = await fetchHtml(searchedUrl);
      if (html) {
        const og = extractOgImage(html, searchedUrl);
        if (og && (await verifyImageUrl(og))) data.imageUrl = og;
      }
    }
  }
  return data;
}

// Image identification: returns top candidates with a confidence label.
// Mode 'auto' handles both photographs of physical gear AND screenshots of
// product pages with one unified prompt. Modes 'photo' and 'screenshot' use
// scenario-specific wording for cases where the caller knows the source.
// When forceMultiple is true, always return 2-3 candidates even on high
// confidence — used for re-identify and on desktop where alternates are
// always shown.
async function extractCandidatesFromPhoto(
  image: { base64: string; mediaType: string },
  forceMultiple: boolean,
  mode: "photo" | "screenshot" | "auto" = "photo",
) {
  let intro: string[];
  if (mode === "screenshot") {
    intro = [
      "This is a screenshot of an outdoor gear product page.",
      "Identify the product from the visible page text (name, brand, listed weight, URL in the address bar) plus your product knowledge.",
    ];
  } else if (mode === "photo") {
    intro = [
      "This is a photograph of an outdoor gear product on a plain background.",
      "Identify the product from visible branding, model markings, distinctive shape, materials, or your product knowledge.",
    ];
  } else {
    intro = [
      "This image shows an outdoor gear product. It may be either:",
      "  (A) a photograph of the physical product, often on a plain background, OR",
      "  (B) a screenshot of a webpage showing the product (with product photos, text, specs, possibly a URL in the address bar).",
      "Identify the product using whichever signals are present: visible logos and model markings, page text and specs, the URL bar, distinctive shape — plus your product knowledge to fill in fields not directly visible.",
    ];
  }

  const prompt = [
    ...intro,
    "",
    "Return ONLY a JSON object — no markdown fences, no prose:",
    "{",
    `  "confidence": "high" | "medium" | "low",`,
    `  "candidates": [`,
    `    {`,
    `      "name": string (concise product name without pack-size suffix),`,
    `      "brand": string|null (manufacturer),`,
    `      "weightGrams": number|null (single-unit weight in grams from page text or your product knowledge),`,
    `      "quantity": number|null (pack size if multi-pack, else 1),`,
    `      "url": string|null (manufacturer's product page — visible in screenshot or from your knowledge; never invent),`,
    `      "imageUrl": string|null (manufacturer's product image URL from your knowledge),`,
    `      "notes": string|null (1-2 short sentences: key features, material, size)`,
    `    }`,
    `  ]`,
    "}",
    "",
    "Confidence levels:",
    `- "high": clear identification — explicit page text/URL, OR unambiguous visible branding.`,
    `- "medium": brand identifiable but the exact model is your best guess.`,
    `- "low": no clear branding visible; guessing from shape and category alone.`,
    "",
    "Rules:",
    forceMultiple
      ? "- ALWAYS return 2 or 3 candidates ordered by likelihood (best first), even if confidence is high — the user wants to see alternatives."
      : `- If confidence is "high", return exactly 1 candidate. Otherwise return 2 or 3 candidates ordered by likelihood (best first).`,
    "- Each candidate must be a specific named product (e.g. \"Black Diamond Solution Harness\"), not a generic category.",
    "- For multi-packs (e.g. \"3 Pack\"), return the SINGLE-unit weight and set quantity to the pack size.",
    "- url: never invent — only return URLs you are sure about (visible in the screenshot, or from your knowledge of the manufacturer's site).",
    "- Do NOT describe the image itself; only extract gear data.",
  ].join("\n");

  const text = await callClaude(
    [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
    1800,
  );

  const raw = coerceJson(text);
  const conf: "high" | "medium" | "low" =
    raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
      ? raw.confidence
      : "low";
  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates.slice(0, 3) : [];
  const candidates = rawCandidates
    .map((c: any) => normalize(c, null))
    .filter((c: ReturnType<typeof normalize>) => c.name);

  if (candidates.length === 0) {
    throw new Error("Couldn't identify any gear in the photo. Try a clearer shot with the brand visible.");
  }

  // Eagerly enrich only the TOP candidate. Alternates ship raw — the client
  // lazy-enriches them via the {identity} mode if the user picks one. This
  // keeps per-photo Anthropic call count bounded (~3 instead of ~7), which
  // matters when the user uploads several photos in quick succession.
  const top = await enrichGearData(candidates[0]);
  const result = [top, ...candidates.slice(1)];

  return {
    data: top,
    confidence: conf,
    candidates: result,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  const auth = await requireAuth(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const allowed = await checkRateLimit(auth.token, "extract_gear", 30, 60);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Please wait a minute before trying again." }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60", ...CORS_HEADERS },
      },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    if (typeof body?.query === "string" && body.query.trim().length >= 3) {
      const suggestions = await searchProducts(body.query.trim());
      return json({ suggestions });
    }
    if (body?.identity && typeof body.identity.name === "string" && body.identity.name.trim()) {
      const name = body.identity.name.trim();
      const brand = typeof body.identity.brand === "string" && body.identity.brand.trim()
        ? body.identity.brand.trim()
        : null;
      const data = await extractFromIdentity(name, brand);
      return json({ data });
    }
    if (typeof body?.url === "string" && body.url.trim()) {
      const data = await extractFromUrl(body.url.trim());
      return json({ data });
    }
    if (body?.image?.base64 && body?.image?.mediaType) {
      const requestedMode = body?.mode;
      const mode: "photo" | "screenshot" | "auto" =
        requestedMode === "photo" || requestedMode === "screenshot" || requestedMode === "auto"
          ? requestedMode
          : "auto";
      const forceMultiple = body?.forceMultiple === true;
      const result = await extractCandidatesFromPhoto(body.image, forceMultiple, mode);
      return json(result);
    }
    return json({ error: "Provide { query }, { url }, or { image: { base64, mediaType } }" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message || "Extraction failed" }, 500);
  }
});
