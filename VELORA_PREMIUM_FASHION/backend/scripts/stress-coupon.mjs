// Concurrency smoke test. Requires a test DB fixture and a valid customer
// token. Fetches its own CSRF token/cookie first — without it, the global
// CSRF middleware rejects every POST with 403 before it ever reaches the
// coupon-validation logic being tested (same issue fixed in
// stress-rate-limit.mjs; see that file's comment for why the reuse is safe).
const base = process.env.VELORA_URL || 'http://127.0.0.1:3000';
const token = process.env.VELORA_TOKEN;
if (!token) throw new Error('VELORA_TOKEN required');
const code = process.env.COUPON_CODE || 'RACE10';
const requests = Number(process.env.REQUESTS || 20);

const csrfRes = await fetch(`${base}/api/csrf`);
const { csrfToken } = await csrfRes.json();
const cookie = csrfRes.headers.get('set-cookie')?.split(';')[0];
if (!csrfToken || !cookie) throw new Error('Could not obtain a CSRF token/cookie from /api/csrf');

const results = await Promise.all(Array.from({ length: requests }, () => fetch(`${base}/api/coupons/validate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, cookie },
  body: JSON.stringify({ code, subtotal: 1000 })
})));
console.log(await Promise.all(results.map(async (r) => ({ status: r.status, data: await r.json() }))));

