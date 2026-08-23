import * as Sentry from '@sentry/node';
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import path from "node:path";
import { fileURLToPath } from "node:url";

import productsRoutes from "./routes/products.routes.js";
import authRoutes from "./routes/auth.routes.js";
import orderRoutes from "./routes/orders.routes.js";
import accountRoutes from "./routes/account.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import couponRoutes from "./routes/coupons.routes.js";
import paymentsRoutes from "./routes/payments.routes.js";
import supportRoutes from "./routes/support.routes.js";
import { csrfEndpoint, csrfTokenMiddleware, originGuard } from "./middleware/security.js";
import { noStoreApi, publicCache } from "./middleware/cache.js";
import * as settingsRepo from './db/repositories/settings.repo.js';
import * as productsRepo from './db/repositories/products.repo.js';
import { getRedisClient, isRedisConfigured, pingRedis, cached } from './services/redis.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");

if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development', tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1) });

const app = express();

app.set("trust proxy", 1);

// contentSecurityPolicy is disabled because the frontend uses a handful of
// inline `style="..."` attributes and one inline `<script>` (admin login)
// plus Google Fonts served from an external origin. Rewriting those to be
// CSP-nonce-friendly is a reasonable follow-up, but out of scope here.
// The rest of Helmet's protections (X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, etc.) are still applied.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
const corsOrigins=(process.env.CORS_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
// Fail fast rather than silently degrading: without an explicit allowlist,
// originGuard (below) has nothing to enforce, so CORS_ORIGINS is required
// in production the same way JWT_SECRET/SMTP config is — a missing value
// here should crash the boot, not quietly ship with an open origin policy.
if (process.env.NODE_ENV === 'production' && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS must be set to a comma-separated allowlist of trusted origins in production.');
}
app.use(cors({ origin: corsOrigins.length ? corsOrigins : (process.env.NODE_ENV === 'production' ? false : true), credentials: false, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] }));
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(originGuard);
app.use('/api', csrfTokenMiddleware);

// Cache policy for static frontend assets: the HTML shell must always be
// revalidated (it's the SPA entry point and can change on every deploy),
// but hashed-looking static assets (css/js/images) are safe to cache harder
// so a real CDN/browser cache actually saves round-trips instead of
// defaulting to "cache nothing" or "cache the HTML forever".
app.use(express.static(frontendDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    else if (/\.(?:css|js|png|jpe?g|webp|svg|gif|ico|woff2?)$/.test(filePath)) res.setHeader("Cache-Control", "public, max-age=86400");
  }
}));

// Generous general limit so normal browsing/checkout never gets throttled...
// Backed by Redis (shared across replicas) in production; falls back to an
// in-memory store in development when REDIS_URL isn't set. A per-pod memory
// store in production would let an attacker just get load-balanced to a
// fresh pod to reset their own limit, which defeats the point.
const redisClient = getRedisClient();
// express-rate-limit forbids sharing one Store instance across multiple
// limiters (each tracks its own counters and calls store.init() itself) —
// doing so throws ERR_ERL_STORE_REUSE at the second rateLimit() call. That
// throw only happens when REDIS_URL is actually set (the in-memory default
// store has no such restriction), so this was never caught until this
// session's live-Redis run. Each limiter now gets its own RedisStore with a
// distinct key prefix so their counters don't collide either.
const makeRateLimitStore = (prefix) => redisClient
  ? new RedisStore({ sendCommand: (...args) => redisClient.call(...args), prefix })
  : undefined;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRateLimitStore('velora:rl:api:')
});

// ...but auth endpoints get a much tighter limit to slow down credential
// stuffing / brute-force login and registration-spam attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait a few minutes and try again." },
  store: makeRateLimitStore('velora:rl:auth:')
});

app.get('/api/csrf', csrfEndpoint);
app.use("/api/auth", authLimiter, noStoreApi, authRoutes);
app.use("/api", apiLimiter);
app.use("/api/account", noStoreApi, accountRoutes);
app.use("/api/admin", noStoreApi, adminRoutes);
app.use("/api/support", noStoreApi, supportRoutes);
app.use("/api", noStoreApi, orderRoutes);
app.use("/api", noStoreApi, couponRoutes);
app.use("/api", noStoreApi, paymentsRoutes);
app.use("/api", productsRoutes);

// /api/health checks the database (and, if configured, Redis) and is meant
// for readiness probes — if Postgres is briefly unreachable, the pod should
// stop receiving traffic without being killed and restarted for something
// that isn't its fault. Redis is intentionally non-fatal here: a Redis
// outage degrades rate-limiting/caching/token-revocation but the store
// itself keeps working, so it shouldn't take the pod out of rotation.
// /api/live is a liveness probe: cheap, dependency-free, only answers "is
// this Node process still responsive" — a transient DB outage must never
// cause Kubernetes to restart otherwise-healthy pods.
app.get('/api/health', async (_req,res) => {
  const redis = await pingRedis();
  try {
    await (await import('./db/pool.js')).pool.query('SELECT 1');
    res.json({ ok:true, service:'velora', version:process.env.APP_VERSION||'production', redis });
  } catch {
    res.status(503).json({ok:false,service:'velora',redis});
  }
});
app.get('/api/live', (_req,res) => { res.json({ ok:true, service:'velora' }); });
app.get('/api/store/settings', publicCache(60), async (_req,res) => {
  const s = await cached('store-settings', 60, () => settingsRepo.getSettings());
  res.json({ settings:{ currency:s.currency, freeShippingThreshold:s.freeShippingThreshold, taxPercent:s.taxPercent, storeName:s.storeName } });
});

// SEO: sitemap is generated from the live catalog so new/removed products
// stay in sync automatically, rather than a static file going stale. Cached
// briefly since the full catalog listing isn't cheap to regenerate on every
// crawler hit. Registered before the SPA catch-all so it isn't swallowed by
// the `sendFile(index.html)` fallback below.
app.get('/sitemap.xml', publicCache(3600), async (req, res) => {
  const origin = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
  const urls = await cached('sitemap-urls', 3600, async () => {
    const all = await productsRepo.getAllProducts();
    const staticPaths = ['/', '/privacy.html', '/terms.html', '/returns-policy.html', '/shipping-policy.html'];
    return [...staticPaths, ...all.map(p => `/?product=${encodeURIComponent(p.id)}`)];
  });
  res.setHeader('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${origin}${u}</loc></url>`).join('\n')}\n</urlset>`);
});

app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  if (process.env.SENTRY_DSN) Sentry.captureException(error);
  console.error(error);
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    res.status(400).json({ message: "Invalid JSON request body." });
    return;
  }

  res.status(500).json({
    message: "The Velora backend could not complete the request.",
    detail: process.env.NODE_ENV === "production" ? undefined : error.message
  });
});

export default app;
