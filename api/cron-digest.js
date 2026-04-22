// Vercel cron handler for the daily re-engagement digest.
//
// Triggered by the entry in vercel.json under "crons" — Vercel POSTs here
// on schedule with an Authorization: Bearer <CRON_SECRET> header (Vercel's
// own cron secret, set via project env var). We verify that, then proxy the
// call to the Supabase digest-emails edge function with our own
// DIGEST_CRON_SECRET so the edge function knows the call is legitimate.
//
// Required Vercel env vars:
//   - SUPABASE_FUNCTIONS_URL  (e.g. https://<ref>.supabase.co/functions/v1)
//   - SUPABASE_ANON_KEY       (apikey header for the functions gateway)
//   - DIGEST_CRON_SECRET      (matches the same secret in Supabase function env)
//   - CRON_SECRET             (Vercel-generated; auto-injected when you add a cron)

export default async function handler(req, res) {
  // Vercel cron always uses GET; allow POST too for manual ad-hoc triggers.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  // Verify Vercel's cron token. Vercel sets CRON_SECRET automatically when
  // a cron job is configured; it sends "Authorization: Bearer <secret>" on
  // each invocation.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${expected}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const fnUrl = process.env.SUPABASE_FUNCTIONS_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const digestSecret = process.env.DIGEST_CRON_SECRET;
  if (!fnUrl || !anon || !digestSecret) {
    return res.status(500).json({
      error: 'Server misconfigured',
      missing: {
        SUPABASE_FUNCTIONS_URL: !fnUrl,
        SUPABASE_ANON_KEY: !anon,
        DIGEST_CRON_SECRET: !digestSecret,
      },
    });
  }

  try {
    const target = `${fnUrl.replace(/\/+$/, '')}/digest-emails`;
    const r = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': anon,
        'authorization': `Bearer ${anon}`,
        'x-cron-secret': digestSecret,
      },
      body: JSON.stringify({}),
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('content-type', 'application/json');
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream call failed', detail: String(err) });
  }
}
