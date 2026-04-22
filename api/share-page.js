// Vercel serverless function: renders index.html with injected Open Graph /
// Twitter meta tags for share-link URLs (e.g. /?share=<token>).
//
// Why: when someone drops a share URL into iMessage/Slack/Twitter, the
// unfurl bot fetches the page and reads og:* / twitter:* tags. Plain
// index.html has none, so the unfurl is blank. This function handles the
// `?share=<token>` case only — it looks up the list via the
// share-link-preview edge function, splices in dynamic meta tags, and
// returns the same HTML. Humans still see the normal SPA on arrival.
//
// Wired up by a rewrite in vercel.json:
//   { source: "/", has: [{ type: "query", key: "share" }], destination: "/api/share-page" }
//
// Required Vercel env vars (already present for cron-digest):
//   - SUPABASE_FUNCTIONS_URL  (https://<ref>.supabase.co/functions/v1)
//   - SUPABASE_ANON_KEY       (apikey for the functions gateway)

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SITE_ORIGIN = 'https://packupgear.com';
const OG_IMAGE_URL = `${SITE_ORIGIN}/og-share.png`;
const GENERIC_TITLE = 'PackUpGear — Pack up, get out.';
const GENERIC_DESCRIPTION =
  'Track your gear. Build packing lists for every adventure.';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchPreview(token) {
  const fnUrl = process.env.SUPABASE_FUNCTIONS_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!fnUrl || !anon) return null;

  try {
    const target = `${fnUrl.replace(/\/+$/, '')}/share-link-preview`;
    const r = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': anon,
        'authorization': `Bearer ${anon}`,
      },
      body: JSON.stringify({ token }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function buildMeta({ title, description, url }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const img = escapeHtml(OG_IMAGE_URL);
  return [
    `<meta name="description" content="${d}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="PackUpGear">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${u}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="PackUpGear — Pack up, get out.">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${img}">`,
  ].join('\n    ');
}

// Strip any baseline og:*/twitter:*/description meta tags that index.html
// carries for bare-URL unfurls, so our list-specific ones don't stack with
// (and potentially lose to) the generic defaults. Most unfurl bots pick the
// FIRST og:title they see; removing the baseline guarantees the dynamic one
// wins regardless of insertion position.
function stripBaselineMeta(html) {
  // Tail pattern [ \t]*\n? only consumes trailing horizontal whitespace +
  // the single line-ending newline. `\s*` here would greedily eat the next
  // line's leading indent and break the next tag's line-start anchor —
  // leaving every other baseline tag un-stripped.
  return html
    .replace(/^[ \t]*<meta\s+name="description"[^>]*>[ \t]*\n?/gmi, '')
    .replace(/^[ \t]*<meta\s+property="og:[^"]*"[^>]*>[ \t]*\n?/gmi, '')
    .replace(/^[ \t]*<meta\s+name="twitter:[^"]*"[^>]*>[ \t]*\n?/gmi, '');
}

function injectMeta(html, metaBlock) {
  const stripped = stripBaselineMeta(html);
  // Insert right after </title>. If not found (shouldn't happen), fall back
  // to before </head>.
  if (stripped.includes('</title>')) {
    return stripped.replace('</title>', `</title>\n    ${metaBlock}`);
  }
  if (stripped.includes('</head>')) {
    return stripped.replace('</head>', `    ${metaBlock}\n  </head>`);
  }
  return stripped;
}

export default async function handler(req, res) {
  const token = typeof req.query?.share === 'string' ? req.query.share.trim() : '';
  const shareUrl = token
    ? `${SITE_ORIGIN}/?share=${encodeURIComponent(token)}`
    : SITE_ORIGIN;

  // Load index.html from the bundled files (see vercel.json includeFiles).
  let html;
  try {
    html = await readFile(join(process.cwd(), 'index.html'), 'utf8');
  } catch (e) {
    console.error('[share-page] could not read index.html', e);
    res.status(500).send('Internal error');
    return;
  }

  let title = GENERIC_TITLE;
  let description = GENERIC_DESCRIPTION;

  if (token) {
    const preview = await fetchPreview(token);
    if (preview && preview.activity_name) {
      const inviter = (preview.inviter_name || '').trim() || 'A friend';
      const emoji = (preview.activity_emoji || '').trim() || '🎒';
      const activity = (preview.activity_name || '').trim() || 'a packing list';
      title = `Join ${inviter} to pack for ${emoji} ${activity}.`;
      description = 'Tap to open the shared packing list on PackUpGear.';
    } else {
      // Unknown/invalid token — still serve a nice generic card.
      title = 'Join a shared packing list on PackUpGear';
      description = 'Tap to open the shared packing list on PackUpGear.';
    }
  }

  const metaBlock = buildMeta({ title, description, url: shareUrl });
  const out = injectMeta(html, metaBlock);

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader(
    'cache-control',
    'public, s-maxage=300, stale-while-revalidate=60',
  );
  res.status(200).send(out);
}
