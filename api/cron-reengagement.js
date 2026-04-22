// Vercel cron handler for the daily re-engagement follow-up emails.
//
// Triggered by the entry in vercel.json under "crons" — Vercel POSTs here on
// schedule with an Authorization: Bearer <CRON_SECRET> header. We verify
// that, then proxy to the Supabase reengagement-emails edge function with
// our own REENGAGEMENT_CRON_SECRET so the edge function knows the call is
// legitimate.
//
// Required Vercel env vars:
//   - SUPABASE_FUNCTIONS_URL      (e.g. https://<ref>.supabase.co/functions/v1)
//   - SUPABASE_ANON_KEY           (apikey header for the functions gateway)
//   - REENGAGEMENT_CRON_SECRET    (matches the same secret in Supabase function env)
//   - CRON_SECRET                 (Vercel-generated; auto-injected when you add a cron)

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${expected}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const fnUrl = process.env.SUPABASE_FUNCTIONS_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const cronSecret = process.env.REENGAGEMENT_CRON_SECRET;
  if (!fnUrl || !anon || !cronSecret) {
    return res.status(500).json({
      error: 'Server misconfigured',
      missing: {
        SUPABASE_FUNCTIONS_URL: !fnUrl,
        SUPABASE_ANON_KEY: !anon,
        REENGAGEMENT_CRON_SECRET: !cronSecret,
      },
    });
  }

  try {
    const target = `${fnUrl.replace(/\/+$/, '')}/reengagement-emails`;
    const r = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': anon,
        'authorization': `Bearer ${anon}`,
        'x-cron-secret': cronSecret,
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
