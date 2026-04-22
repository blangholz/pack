// Vercel Edge Middleware — runs before filesystem lookup, so this reliably
// intercepts "/?share=<token>" before Vercel's static server serves
// index.html. Rewrites in vercel.json lose the race against the static file
// at "/", which is why we do this here instead of via `rewrites`.
//
// For any URL with a `share` query param on the root path, we rewrite the
// request to /api/share-page so that function can inject OG / Twitter meta
// tags into index.html and return the result. Humans still see /?share=<token>
// in their URL bar and the SPA still runs client-side (the function returns
// the full HTML body, just with extra meta tags).

import { next, rewrite } from '@vercel/edge';

export const config = {
  matcher: '/',
};

export default function middleware(req) {
  const url = new URL(req.url);
  if (url.pathname === '/' && url.searchParams.has('share')) {
    const dest = new URL('/api/share-page', url);
    dest.search = url.search;
    return rewrite(dest);
  }
  return next();
}
