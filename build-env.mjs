// Generates env.js so the static frontend can read build-time env vars.
// Runs locally (reads .env if present) and on Vercel (reads process.env).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  for (const raw of readFileSync('.env', 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    if (process.env[key]) continue;
    process.env[key] = valRaw.replace(/^["']|["']$/g, '');
  }
}

const env = {
  SUPABASE_URL: (process.env.SUPABASE_URL || '').trim(),
  SUPABASE_ANON_KEY: (process.env.SUPABASE_ANON_KEY || '').trim(),
};

const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.warn(`[build-env] Missing env vars: ${missing.join(', ')}`);
}

writeFileSync('env.js', `window.ENV = ${JSON.stringify(env)};\n`);
console.log('[build-env] wrote env.js');
