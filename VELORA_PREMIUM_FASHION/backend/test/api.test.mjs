import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Stripe from "stripe";

// IMPORTANT: these env vars must be set before app.js (and anything it
// imports, including the db pool) is loaded, since the connection config is
// resolved once at import time. This points the whole test run at a
// dedicated velorastore_test database rather than your real dev/production one.
process.env.PGHOST = process.env.PGHOST || "localhost";
process.env.PGPORT = process.env.PGPORT || "5432";
process.env.PGUSER = process.env.PGUSER || "postgres";
process.env.PGPASSWORD = process.env.PGPASSWORD || "postgres";
process.env.PGDATABASE = process.env.TEST_PGDATABASE || "velorastore_test";
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

const { default: app } = await import("../app.js");
const { pool } = await import("../db/pool.js");
const { runMigrations } = await import("../db/migrate.js");
const productsRepo = await import("../db/repositories/products.repo.js");
const { ensureSeedAdmin } = await import("../db/repositories/users.repo.js");
const { closeRedis, isRedisConfigured, getRedisClient } = await import("../services/redis.service.js");

let server;
let baseUrl;

before(async () => {
  // Start from a completely clean schema every run so tests never depend on
  // (or get tripped up by) leftover state from a previous run. This list
  // must cover every table any migration creates — it previously omitted
  // coupons/coupon_redemptions/payment_events/store_settings, so coupon and
  // webhook tests would fail with unique-constraint violations on a second
  // consecutive `npm test` run against the same database.
  await pool.query("DROP TABLE IF EXISTS audit_log, coupon_redemptions, payment_events, coupons, store_settings, orders, products, users, schema_migrations CASCADE");
  await runMigrations();
  await ensureSeedAdmin();

  // Same problem, different store: when REDIS_URL is configured, rate-limit
  // counters (velora:rl:*), revoked-token entries, and cached responses
  // persist in Redis across process restarts — Postgres gets a clean slate
  // above but Redis didn't. On a second/third consecutive `npm test` run
  // this left the auth/api rate limiters already partially (or fully)
  // consumed from the previous run, so registration/login tests started
  // failing with a genuine 429 instead of the expected 2xx/4xx. Only
  // reproduces with a real Redis configured, so in-memory-only runs never
  // caught it. Flush every velora:-prefixed key before each run.
  if (isRedisConfigured()) {
    const redis = getRedisClient();
    const keys = await redis.keys("velora:*");
    if (keys.length) await redis.del(keys);
  }

  // A small, known fixture catalog rather than the full 597-item dataset —
  // keeps the suite fast and makes the "out of stock" test deterministic.
  // A few products (not just one) so pagination has something to page through.
  await productsRepo.createProduct({ title: "Test Silk Scarf", sellingPrice: 1500, mrp: 2000, stock: 25 });
  await productsRepo.createProduct({ title: "Test Kurta", sellingPrice: 900, mrp: 1200, stock: 25 });
  await productsRepo.createProduct({ title: "Test Saree", sellingPrice: 2500, mrp: 3200, stock: 25 });
  await productsRepo.createProduct({ title: "Test Lehenga", sellingPrice: 4500, mrp: 6000, stock: 25 });
  await productsRepo.createProduct({ title: "Test Gown", sellingPrice: 3200, mrp: 4000, stock: 25 });
  await productsRepo.createProduct({ title: "Test Jacket", sellingPrice: 1800, mrp: 2400, stock: 25 });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  // Without this the ioredis connection's internal timers (reconnect
  // backoff, keepalive) keep the event loop alive indefinitely when
  // REDIS_URL is set, so `node --test` never exits on its own even though
  // every test has finished — it just hangs until an external timeout
  // kills it. Only reproduces with a real Redis configured, so it wasn't
  // caught until this suite was run against a live instance.
  await closeRedis();
});

// The app's CSRF middleware (backend/middleware/security.js) uses a
// double-submit cookie: any mutating request must send an X-CSRF-Token
// header that matches the `velora_csrf` cookie already set on the client.
// A real browser gets this for free (same-origin fetch sends cookies
// automatically); this bare `fetch`-based harness does not have a cookie
// jar, so it has to track and replay the cookie itself, exactly like the
// frontend's `ensureCsrf()` helper does with localStorage.
let csrfToken;
let csrfCookie;

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!csrfToken) await primeCsrf();
    headers["X-CSRF-Token"] = csrfToken;
  }
  if (csrfCookie) headers["Cookie"] = csrfCookie;

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const match = /velora_csrf=([^;]+)/.exec(setCookie);
    if (match) {
      csrfCookie = `velora_csrf=${match[1]}`;
      csrfToken = decodeURIComponent(match[1]);
    }
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { status: response.status, data };
}

async function primeCsrf() {
  const response = await fetch(`${baseUrl}/api/csrf`);
  const data = await response.json();
  csrfToken = data.csrfToken;
  const setCookie = response.headers.get("set-cookie");
  const match = setCookie && /velora_csrf=([^;]+)/.exec(setCookie);
  csrfCookie = match ? `velora_csrf=${match[1]}` : `velora_csrf=${encodeURIComponent(csrfToken)}`;
}

let customerToken;
let customerRefreshToken;
let firstProductId;

test("health check reports the product catalog is loaded", async () => {
  const { status, data } = await api("/api/health");
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.products > 0);
});

test("GET /api/products returns a non-empty catalog", async () => {
  const { status, data } = await api("/api/products?limit=5");
  assert.equal(status, 200);
  assert.ok(data.products.length > 0);
  firstProductId = data.products[0].id;
});

test("a new customer can register", async () => {
  const { status, data } = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Test Customer", email: "customer@test.local", password: "Password123!" }
  });
  assert.equal(status, 201);
  assert.ok(data.token);
  assert.ok(data.refreshToken);
  assert.equal(data.user.role, "customer");
  customerToken = data.token;
  customerRefreshToken = data.refreshToken;
});

test("registering the same email again is rejected", async () => {
  const { status } = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Dup", email: "customer@test.local", password: "Password123!" }
  });
  assert.equal(status, 409);
});

test("logging in with the wrong password is rejected", async () => {
  const { status } = await api("/api/auth/login", {
    method: "POST",
    body: { email: "customer@test.local", password: "Wrong-Password9!" }
  });
  assert.equal(status, 401);
});

test("an authenticated request without a token is rejected", async () => {
  const { status } = await api("/api/auth/me");
  assert.equal(status, 401);
});

test("GET /api/auth/me returns the signed-in user", async () => {
  const { status, data } = await api("/api/auth/me", {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert.equal(status, 200);
  assert.equal(data.user.email, "customer@test.local");
});

test("cart and wishlist persist server-side per account", async () => {
  const putCart = await api("/api/account/cart", {
    method: "PUT",
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { cart: [{ id: firstProductId, qty: 2 }] }
  });
  assert.equal(putCart.status, 200);

  const getCart = await api("/api/account/cart", {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert.equal(getCart.data.cart.length, 1);
  assert.equal(getCart.data.cart[0].qty, 2);

  const putWishlist = await api("/api/account/wishlist", {
    method: "PUT",
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { wishlist: [firstProductId] }
  });
  assert.equal(putWishlist.status, 200);
});

test("cart validation flags a quantity that exceeds stock", async () => {
  const { status, data } = await api("/api/cart/validate", {
    method: "POST",
    body: { items: [{ productId: firstProductId, quantity: 999999 }] }
  });
  assert.equal(status, 200);
  assert.equal(data.valid, false);
  assert.equal(data.items[0].available, false);
});

// NOTE: there is no `POST /api/orders` route in this codebase — the app
// creates orders exclusively through the Stripe-backed
// `POST /api/payments/checkout` flow (see routes/payments.routes.js and
// frontend/app.js's beginCheckout/placeOrder). The two tests that used to
// live here were written for an older direct/COD order-creation endpoint
// that no longer exists, so they always 404'd. Rewritten below against the
// real endpoint.

test("checkout with a bogus product id is rejected before any payment is attempted", async () => {
  const { status, data } = await api("/api/payments/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { items: [{ productId: "does-not-exist", quantity: 1 }], shippingAddress: "1 Test St" }
  });
  assert.equal(status, 400);
  assert.ok(/no longer available/i.test(data.message));
});

test("checkout validates stock before contacting Stripe, and fails cleanly with Stripe unconfigured", async () => {
  // STRIPE_SECRET_KEY is deliberately unset in this test run (no outbound
  // network access to Stripe from this environment), so this proves two
  // things at once: (1) createPendingOrder's stock check runs and passes
  // for valid stock, and (2) when session creation then fails, the order is
  // rolled back to 'cancelled' and the reserved stock is restored rather
  // than leaking a stuck pending_payment order or oversold inventory.
  const before = await api(`/api/products/${firstProductId}`);
  const stockBefore = before.data.stock;

  const { status, data } = await api("/api/payments/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { items: [{ productId: firstProductId, quantity: 1 }], shippingAddress: "1 Test St" }
  });
  assert.equal(status, 503);
  assert.match(data.message, /stripe/i);

  const after = await api(`/api/products/${firstProductId}`);
  assert.equal(after.data.stock, stockBefore, "stock must be restored after a failed checkout attempt");
});

test("checkout releases reserved stock immediately when Stripe fails, so retries can recycle it", async () => {
  // Documents real, intentional behavior: createPendingOrder reserves stock
  // inside a transaction, but if session creation then fails the checkout
  // route calls markPaymentFailed, which restores that stock in the same
  // request. That means concurrent checkout *attempts* against a small pool
  // do NOT behave like "first N win, the rest are rejected" — a failed
  // attempt frees its unit almost immediately, so more than N of M
  // concurrent attempts can each individually pass the stock check over the
  // life of the race. The real safety invariant is tested separately below
  // (never negative, never more reserved than physically exists at any
  // instant) — this test just proves stock is fully accounted for at rest.
  const admin = await adminAuth();
  const created = await api("/api/admin/products", {
    method: "POST",
    headers: admin,
    body: { title: "Concurrency Recycle Item", sellingPrice: 500, mrp: 600, stock: 3 }
  });
  const productId = created.data.product.id;

  const attempts = await Promise.all(
    Array.from({ length: 6 }, () =>
      api("/api/payments/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
        body: { items: [{ productId, quantity: 1 }], shippingAddress: "1 Test St" }
      })
    )
  );
  for (const a of attempts) assert.ok([503, 400].includes(a.status), `unexpected status ${a.status}`);

  const finalProduct = await api(`/api/products/${productId}`);
  assert.equal(finalProduct.data.stock, 3, "stock must end back at 3 once every failed checkout has rolled back");
});

test("concurrent order placement never oversells stock, even when reservations are not released", async () => {
  // This is the real "can never oversell" proof the brief asks for. It
  // calls createPendingOrder directly (the same function the checkout route
  // uses) with no Stripe/release step in the way, so reservations stick —
  // isolating exactly the invariant that matters: with stock=3 and 6
  // concurrent buyers each wanting 1 unit, the `SELECT ... FOR UPDATE` row
  // lock must let exactly 3 succeed and reject the other 3, and stock must
  // never go negative or be double-counted.
  const ordersRepo = await import("../db/repositories/orders.repo.js");
  const usersRepo = await import("../db/repositories/users.repo.js");
  const settingsRepo = await import("../db/repositories/settings.repo.js");

  const admin = await adminAuth();
  const created = await api("/api/admin/products", {
    method: "POST",
    headers: admin,
    body: { title: "Concurrency Oversell Item", sellingPrice: 500, mrp: 600, stock: 3 }
  });
  const productId = created.data.product.id;
  const settings = await settingsRepo.getSettings();

  const buyers = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      usersRepo.createUser({ name: `Oversell Buyer ${i}`, email: `oversell-${Date.now()}-${i}@test.local`, password: "OversellPass1!" })
    )
  );

  const results = await Promise.allSettled(
    buyers.map((buyer) =>
      ordersRepo.createPendingOrder({
        user: { id: buyer.id, name: buyer.name, email: buyer.email },
        items: [{ productId, quantity: 1 }],
        shippingAddress: "1 Oversell St",
        settings
      })
    )
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  assert.equal(succeeded, 3, "exactly as many orders as available stock should succeed under concurrency");
  assert.equal(rejected, 3, "the remaining concurrent buyers must be rejected as out of stock, not oversold");

  const finalProduct = await api(`/api/products/${productId}`);
  assert.equal(finalProduct.data.stock, 0, "stock must reach exactly zero, never negative, after 3 successful concurrent purchases of 3 units");
});

test("a customer cannot access admin routes", async () => {
  const { status } = await api("/api/admin/stats", {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert.equal(status, 403);
});

test("a fresh refresh token can be exchanged for a new access token", async () => {
  const { status, data } = await api("/api/auth/refresh", {
    method: "POST",
    body: { refreshToken: customerRefreshToken }
  });
  assert.equal(status, 200);
  assert.ok(data.token);
  assert.ok(data.refreshToken);
  // Refresh tokens rotate: the old one must no longer work.
  customerRefreshToken = data.refreshToken;
});

test("a rotated-out refresh token can no longer be used", async () => {
  // customerRefreshToken has already been rotated once in the previous test;
  // re-using the token from registration should now fail.
  const staleAttempt = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Rotate Check", email: "rotate-check@test.local", password: "Password123!" }
  });
  const staleRefresh = staleAttempt.data.refreshToken;

  const first = await api("/api/auth/refresh", { method: "POST", body: { refreshToken: staleRefresh } });
  assert.equal(first.status, 200);

  const reused = await api("/api/auth/refresh", { method: "POST", body: { refreshToken: staleRefresh } });
  assert.equal(reused.status, 401);
});

test("changing password invalidates the previous refresh token", async () => {
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Password Change", email: "pwchange@test.local", password: "Password123!" }
  });
  const { token, refreshToken } = reg.data;

  const changed = await api("/api/auth/password", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: { currentPassword: "Password123!", newPassword: "NewPassword456!" }
  });
  assert.equal(changed.status, 200);

  const oldRefreshAttempt = await api("/api/auth/refresh", { method: "POST", body: { refreshToken } });
  assert.equal(oldRefreshAttempt.status, 401);

  // And the new password actually works.
  const loginWithNew = await api("/api/auth/login", {
    method: "POST",
    body: { email: "pwchange@test.local", password: "NewPassword456!" }
  });
  assert.equal(loginWithNew.status, 200);
});

test("forgot-password / reset-password round trip works end to end", async () => {
  await api("/api/auth/register", {
    method: "POST",
    body: { name: "Reset Flow", email: "resetflow@test.local", password: "Password123!" }
  });

  const forgot = await api("/api/auth/forgot-password", {
    method: "POST",
    body: { email: "resetflow@test.local" }
  });
  assert.equal(forgot.status, 200);
  assert.ok(forgot.data.devResetToken, "dev mode should echo the reset token for testability");

  const reset = await api("/api/auth/reset-password", {
    method: "POST",
    body: { email: "resetflow@test.local", token: forgot.data.devResetToken, newPassword: "ResetPassword789!" }
  });
  assert.equal(reset.status, 200);

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: "resetflow@test.local", password: "ResetPassword789!" }
  });
  assert.equal(login.status, 200);
});

test("the default admin account can sign in and reach admin routes", async () => {
  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: "admin@velora.com", password: "Admin@123" }
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, "admin");

  const adminToken = login.data.token;
  const stats = await api("/api/admin/stats", { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(stats.status, 200);
  assert.ok("totalRevenue" in stats.data);
});

test("admin can create, update, and delete a product, and it's recorded in the audit log", async () => {
  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: "admin@velora.com", password: "Admin@123" }
  });
  const adminToken = login.data.token;
  const authHeader = { Authorization: `Bearer ${adminToken}` };

  const created = await api("/api/admin/products", {
    method: "POST",
    headers: authHeader,
    body: { title: "Test Product", sellingPrice: 999, mrp: 1999, stock: 3 }
  });
  assert.equal(created.status, 201);
  const productId = created.data.product.id;

  const updated = await api(`/api/admin/products/${productId}`, {
    method: "PUT",
    headers: authHeader,
    body: { title: "Test Product Updated" }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.product.title, "Test Product Updated");

  const deleted = await api(`/api/admin/products/${productId}`, { method: "DELETE", headers: authHeader });
  assert.equal(deleted.status, 204);

  const audit = await api("/api/admin/audit", { headers: authHeader });
  assert.equal(audit.status, 200);
  const actions = audit.data.audit.map((entry) => entry.action);
  assert.ok(actions.includes("create"));
  assert.ok(actions.includes("update"));
  assert.ok(actions.includes("delete"));
});

test("admin product listing is paginated", async () => {
  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: "admin@velora.com", password: "Admin@123" }
  });
  const adminToken = login.data.token;

  const page = await api("/api/admin/products?page=1&pageSize=5", {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(page.status, 200);
  assert.equal(page.data.products.length, 5);
  assert.ok(page.data.pages > 1);
});

// ---------------------------------------------------------------------
// Phase 2 coverage: coupons, saved addresses, categories, settings,
// Stripe webhooks (signed, duplicate, out-of-order), refunds, and
// concurrency safety for coupons and inventory.
// ---------------------------------------------------------------------

async function adminAuth() {
  const login = await api("/api/auth/login", { method: "POST", body: { email: "admin@velora.com", password: "Admin@123" } });
  return { Authorization: `Bearer ${login.data.token}` };
}

test("public coupon validation endpoint reflects coupon rules", async () => {
  const admin = await adminAuth();
  await api("/api/admin/coupons", {
    method: "POST",
    headers: admin,
    body: { code: "PUBLIC10", type: "percent", value: 10, minOrder: 100, maxUses: 5 }
  });

  const tooSmall = await api("/api/coupons/validate", { method: "POST", body: { code: "PUBLIC10", subtotal: 50 } });
  assert.equal(tooSmall.data.valid, false);

  const ok = await api("/api/coupons/validate", { method: "POST", body: { code: "PUBLIC10", subtotal: 1000 } });
  assert.equal(ok.data.valid, true);
  assert.equal(ok.data.discount, 100);

  const missing = await api("/api/coupons/validate", { method: "POST", body: { code: "DOES-NOT-EXIST", subtotal: 1000 } });
  assert.equal(missing.data.valid, false);
});

test("coupon redemption is atomic under concurrency and never exceeds max_uses", async () => {
  // This exercises the actual production code path (redeemCouponAtomically's
  // conditional `UPDATE ... WHERE used_count < max_uses`), not a simulation
  // of it — 10 concurrent "redeem" calls race against a coupon capped at 3
  // uses, proving Postgres row-level locking serializes them correctly
  // rather than letting every concurrent reader see a stale used_count.
  const couponsRepo = await import("../db/repositories/coupons.repo.js");
  const usersRepo = await import("../db/repositories/users.repo.js");
  const ordersRepo = await import("../db/repositories/orders.repo.js");

  const coupon = await couponsRepo.createCoupon({ code: "RACE3", type: "fixed", value: 10, minOrder: 0, maxUses: 3 });
  const buyer = await usersRepo.createUser({ name: "Race Buyer", email: `race-${Date.now()}@test.local`, password: "RacePassword1!" });

  // Each "redemption" needs a distinct order row (coupon_redemptions has a
  // UNIQUE(coupon_id, order_id) constraint), so seed 10 throwaway orders
  // first, then race the redemption calls against the shared coupon.
  const orderIds = [];
  for (let i = 0; i < 10; i++) {
    const order = await ordersRepo.createPendingOrder({
      user: { id: buyer.id, name: buyer.name, email: buyer.email },
      items: [{ productId: firstProductId, quantity: 1 }],
      shippingAddress: "1 Race St",
      settings: { freeShippingThreshold: 999999, taxPercent: 0 }
    });
    orderIds.push(order.id);
  }

  const results = await Promise.allSettled(
    orderIds.map((orderId) => couponsRepo.redeemCouponAtomically("RACE3", orderId, buyer.id, coupon.id))
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  assert.equal(succeeded, 3, "exactly max_uses redemptions should succeed under concurrency");
  assert.equal(failed, 7);

  const final = await couponsRepo.getCouponByCode("RACE3");
  assert.equal(final.usedCount, 3, "used_count must never exceed max_uses, even under a race");
});

test("saved addresses CRUD round-trip, including default-address switching", async () => {
  const first = await api("/api/account/addresses", {
    method: "POST",
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { label: "Home", line1: "1 Test St", city: "Hyderabad", zip: "500001" }
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.addresses.length, 1);
  const homeId = first.data.addresses[0].id;

  const second = await api("/api/account/addresses", {
    method: "POST",
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { label: "Work", line1: "2 Test Ave", city: "Hyderabad", zip: "500002" }
  });
  const workId = second.data.addresses.find((a) => a.label === "Work").id;

  const updated = await api(`/api/account/addresses/${homeId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { line1: "1 Updated St" }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.addresses.find((a) => a.id === homeId).line1, "1 Updated St");

  const defaulted = await api(`/api/account/addresses/${workId}/default`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert.ok(defaulted.data.addresses.find((a) => a.id === workId).isDefault);

  const deleted = await api(`/api/account/addresses/${homeId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert.equal(deleted.data.addresses.length, 1);
  assert.equal(deleted.data.addresses[0].id, workId);
});

test("admin categories endpoint reflects the live product catalog", async () => {
  const admin = await adminAuth();
  const res = await api("/api/admin/categories", { headers: admin });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data.categories));
});

test("admin settings update changes tax and free-shipping math on the next order (server-authoritative)", async () => {
  const admin = await adminAuth();
  const ordersRepo = await import("../db/repositories/orders.repo.js");
  const usersRepo = await import("../db/repositories/users.repo.js");
  const settingsRepo = await import("../db/repositories/settings.repo.js");

  const updated = await api("/api/admin/settings", {
    method: "PUT",
    headers: admin,
    body: { taxPercent: 18, freeShippingThreshold: 1 }
  });
  assert.equal(updated.status, 200);
  assert.equal(Number(updated.data.settings.taxPercent), 18);

  const buyer = await usersRepo.createUser({ name: "Tax Buyer", email: `tax-${Date.now()}@test.local`, password: "TaxPassword1!" });
  const product = await api(`/api/products/${firstProductId}`);
  const settings = await settingsRepo.getSettings();

  const order = await ordersRepo.createPendingOrder({
    user: { id: buyer.id, name: buyer.name, email: buyer.email },
    items: [{ productId: firstProductId, quantity: 1 }],
    shippingAddress: "1 Tax St",
    settings
  });

  const expectedTax = Math.round(product.data.sellingPrice * 0.18);
  assert.equal(order.summary.taxes, expectedTax, "tax must be computed server-side from Admin Settings, not client input");
  assert.equal(order.summary.shipping, 0, "shipping should be waived once the order clears the (now near-zero) free-shipping threshold");
});

test("webhooks: a signed checkout.session.completed event confirms the order and redeems its coupon exactly once, even delivered twice", async () => {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_for_signature_construction_only";
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_dummy_secret";

  const ordersRepo = await import("../db/repositories/orders.repo.js");
  const couponsRepo = await import("../db/repositories/coupons.repo.js");
  const usersRepo = await import("../db/repositories/users.repo.js");
  const settingsRepo = await import("../db/repositories/settings.repo.js");

  await couponsRepo.createCoupon({ code: "WEBHOOK10", type: "percent", value: 10, minOrder: 0, maxUses: 5 });
  const buyer = await usersRepo.createUser({ name: "Webhook Buyer", email: `webhook-${Date.now()}@test.local`, password: "WebhookPass1!" });
  const settings = await settingsRepo.getSettings();

  const order = await ordersRepo.createPendingOrder({
    user: { id: buyer.id, name: buyer.name, email: buyer.email },
    items: [{ productId: firstProductId, quantity: 1 }],
    shippingAddress: "1 Webhook St",
    couponCode: "WEBHOOK10",
    settings
  });
  await ordersRepo.attachPaymentSession(order.id, `cs_test_${order.id}`);

  const payload = JSON.stringify({
    id: `evt_${order.id}`,
    type: "checkout.session.completed",
    data: { object: { id: `cs_test_${order.id}`, metadata: { orderId: order.id, orderNumber: order.orderNumber }, payment_intent: `pi_${order.id}` } }
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });

  const deliver = () => fetch(`${baseUrl}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payload
  }).then((r) => r.json().then((data) => ({ status: r.status, data })));

  const first = await deliver();
  assert.equal(first.status, 200);
  assert.notEqual(first.data.duplicate, true);

  // Simulate Stripe retrying the exact same event (duplicate delivery) —
  // must be a safe no-op, not a double-confirm or double coupon redemption.
  const second = await deliver();
  assert.equal(second.status, 200);
  assert.equal(second.data.duplicate, true);

  const confirmedOrder = await ordersRepo.getOrderById(order.id);
  assert.equal(confirmedOrder.status, "confirmed");

  const coupon = await couponsRepo.getCouponByCode("WEBHOOK10");
  assert.equal(coupon.usedCount, 1, "coupon must be redeemed exactly once despite the duplicate webhook delivery");

  return { order, signature, payload };
});

test("webhooks: an out-of-order payment_intent.payment_failed after confirmation is a safe no-op", async () => {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_for_signature_construction_only";
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_dummy_secret";

  const ordersRepo = await import("../db/repositories/orders.repo.js");
  const usersRepo = await import("../db/repositories/users.repo.js");
  const settingsRepo = await import("../db/repositories/settings.repo.js");
  const buyer = await usersRepo.createUser({ name: "OOO Buyer", email: `ooo-${Date.now()}@test.local`, password: "OooPassword1!" });
  const settings = await settingsRepo.getSettings();

  const order = await ordersRepo.createPendingOrder({
    user: { id: buyer.id, name: buyer.name, email: buyer.email },
    items: [{ productId: firstProductId, quantity: 1 }],
    shippingAddress: "1 OOO St",
    settings
  });
  await ordersRepo.attachPaymentSession(order.id, `cs_ooo_${order.id}`);

  const stockBefore = (await api(`/api/products/${firstProductId}`)).data.stock;

  const confirmedPayload = JSON.stringify({
    id: `evt_ooo_confirm_${order.id}`,
    type: "checkout.session.completed",
    data: { object: { id: `cs_ooo_${order.id}`, metadata: { orderId: order.id, orderNumber: order.orderNumber }, payment_intent: `pi_ooo_${order.id}` } }
  });
  const confirmSig = Stripe.webhooks.generateTestHeaderString({ payload: confirmedPayload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  await fetch(`${baseUrl}/api/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": confirmSig }, body: confirmedPayload });

  // A late/duplicated `payment_intent.payment_failed` arrives after the
  // order was already confirmed (e.g. Stripe redelivering an earlier retry
  // out of order). It must NOT cancel the order or restore its stock.
  const failedPayload = JSON.stringify({
    id: `evt_ooo_fail_${order.id}`,
    type: "payment_intent.payment_failed",
    data: { object: { metadata: { orderId: order.id, orderNumber: order.orderNumber } } }
  });
  const failSig = Stripe.webhooks.generateTestHeaderString({ payload: failedPayload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = await fetch(`${baseUrl}/api/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": failSig }, body: failedPayload });
  assert.equal(res.status, 200);

  const finalOrder = await ordersRepo.getOrderById(order.id);
  assert.equal(finalOrder.status, "confirmed", "an out-of-order failure event must not un-confirm a paid order");

  const stockAfter = (await api(`/api/products/${firstProductId}`)).data.stock;
  assert.equal(stockAfter, stockBefore, "stock must not be restored for an order that is actually paid");
});

test("webhooks: a signed charge.refunded event marks the order refunded and rejects a bad signature", async () => {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_for_signature_construction_only";
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_dummy_secret";

  const ordersRepo = await import("../db/repositories/orders.repo.js");
  const usersRepo = await import("../db/repositories/users.repo.js");
  const settingsRepo = await import("../db/repositories/settings.repo.js");
  const buyer = await usersRepo.createUser({ name: "Refund Buyer", email: `refund-${Date.now()}@test.local`, password: "RefundPass1!" });
  const settings = await settingsRepo.getSettings();

  const order = await ordersRepo.createPendingOrder({
    user: { id: buyer.id, name: buyer.name, email: buyer.email },
    items: [{ productId: firstProductId, quantity: 1 }],
    shippingAddress: "1 Refund St",
    settings
  });
  const sessionId = `cs_refund_${order.id}`;
  const paymentIntentId = `pi_refund_${order.id}`;
  await ordersRepo.attachPaymentSession(order.id, sessionId);
  await ordersRepo.confirmPaidOrder({ orderId: order.id, sessionId, paymentIntentId });

  const refundPayload = JSON.stringify({
    id: `evt_refund_${order.id}`,
    type: "charge.refunded",
    data: { object: { payment_intent: paymentIntentId } }
  });

  // Tampered/forged signature must be rejected outright.
  const forged = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: refundPayload
  });
  assert.equal(forged.status, 400);
  const stillConfirmed = await ordersRepo.getOrderById(order.id);
  assert.equal(stillConfirmed.status, "confirmed", "a forged webhook signature must not be able to mutate order state");

  const validSig = Stripe.webhooks.generateTestHeaderString({ payload: refundPayload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const real = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": validSig },
    body: refundPayload
  });
  assert.equal(real.status, 200);

  const refunded = await ordersRepo.getOrderById(order.id);
  assert.equal(refunded.status, "refunded");
  assert.ok(refunded.refundedAt);
});

test("admin refund endpoint rejects orders with no paid Stripe payment", async () => {
  const admin = await adminAuth();
  const ordersRepo = await import("../db/repositories/orders.repo.js");
  const usersRepo = await import("../db/repositories/users.repo.js");
  const settingsRepo = await import("../db/repositories/settings.repo.js");
  const buyer = await usersRepo.createUser({ name: "Unpaid Buyer", email: `unpaid-${Date.now()}@test.local`, password: "UnpaidPass1!" });
  const settings = await settingsRepo.getSettings();
  const order = await ordersRepo.createPendingOrder({
    user: { id: buyer.id, name: buyer.name, email: buyer.email },
    items: [{ productId: firstProductId, quantity: 1 }],
    shippingAddress: "1 Unpaid St",
    settings
  });

  const res = await api(`/api/payments/refund/${order.id}`, { method: "POST", headers: admin, body: {} });
  assert.equal(res.status, 400);
});
