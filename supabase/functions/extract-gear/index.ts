// Supabase Edge Function: extract-gear
// Given a product URL or a screenshot, ask Claude to extract gear fields.
//
// Request body (JSON):
//   { "url": "https://…" }  OR
//   { "image": { "base64": "…", "mediaType": "image/png" } }
//
// Response body (JSON): { name, brand, weightGrams, url, imageUrl, notes }
//
// Auth: relies on the Supabase gateway verifying the caller's JWT
// (set verify_jwt = true in supabase/config.toml so only signed-in users hit it).

// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
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

async function callClaude(messages: any[], maxTokens = 800) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude ${res.status}: ${text.slice(0, 300)}`);
  }
  const payload = await res.json();
  const parts = Array.isArray(payload?.content) ? payload.content : [];
  return parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
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
  return null;
}

async function extractFromUrl(url: string) {
  const html = (await fetchHtml(url)) || "";
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
  const data = normalize(coerceJson(text), url);

  // Prefer og:image from the actual page over Claude's guess.
  if (html) {
    const og = extractOgImage(html, url);
    if (og) data.imageUrl = og;
  }
  return data;
}

async function extractFromImage(image: { base64: string; mediaType: string }) {
  const prompt = [
    "This is a screenshot of an outdoor gear product page.",
    "Identify the product, then extract the fields below.",
    "",
    EXTRACTION_SCHEMA,
    "",
    "Rules:",
    "- Prefer listed product weight over shipping weight.",
    "- For multi-packs (e.g. '3 Pack'), return the weight of a SINGLE unit and set quantity to the pack size.",
    "- The URL should be the manufacturer's own product page when you are confident; otherwise use whatever URL is visible in the screenshot's address bar, else null.",
    "- Do NOT describe the screenshot itself; only extract the gear data.",
  ].join("\n");

  const text = await callClaude(
    [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.base64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
    900,
  );
  const data = normalize(coerceJson(text), null);

  // If Claude returned a product URL, fetch it to grab a clean og:image.
  if (data.url) {
    const html = await fetchHtml(data.url);
    if (html) {
      const og = extractOgImage(html, data.url);
      if (og) data.imageUrl = og;
    }
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    if (typeof body?.url === "string" && body.url.trim()) {
      const data = await extractFromUrl(body.url.trim());
      return json({ data });
    }
    if (body?.image?.base64 && body?.image?.mediaType) {
      const data = await extractFromImage(body.image);
      return json({ data });
    }
    return json({ error: "Provide either { url } or { image: { base64, mediaType } }" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message || "Extraction failed" }, 500);
  }
});
