// Concurrency/rate-limit smoke test against a live server. Every mutating
// request needs a valid CSRF double-submit token (cookie + header) or the
// CSRF middleware (mounted globally on /api/*, ahead of the auth rate
// limiter) rejects it with 403 before it ever reaches the limiter — which
// previously made this script always report rateLimited:0 and fail, even
// when the rate limiter itself was working correctly. Fetch one token/cookie
// up front and reuse it on every request (CSRF protects against
// cross-*site* forgery, not same-script reuse of one legitimately-obtained
// token, so this is the correct way to drive the login endpoint here).
const base = process.env.VELORA_URL || 'http://127.0.0.1:3000';
const n = Number(process.env.REQUESTS || 100);

const csrfRes = await fetch(`${base}/api/csrf`);
const { csrfToken } = await csrfRes.json();
const cookie = csrfRes.headers.get('set-cookie')?.split(';')[0];
if (!csrfToken || !cookie) throw new Error('Could not obtain a CSRF token/cookie from /api/csrf');

const results = await Promise.all(Array.from({ length: n }, () => fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, cookie },
  body: JSON.stringify({ email: 'rate-test@example.com', password: 'wrong' })
})));
const limited = results.filter((r) => r.status === 429).length;
console.log({ requests: n, rateLimited: limited });
if (!limited) process.exitCode = 1;

