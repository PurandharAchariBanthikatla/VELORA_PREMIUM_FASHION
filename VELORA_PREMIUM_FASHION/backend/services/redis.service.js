import Redis from "ioredis";

// Redis is used for three things that are broken under >1 replica without
// it (the Helm chart already runs 3 replicas by default, and the
// NetworkPolicy already anticipated a `redisPort` egress rule — this wires
// up the client that was missing):
//   1. A shared store for express-rate-limit, so brute-force/rate limits are
//      enforced across all replicas instead of resetting per-pod.
//   2. Immediate access-token revocation on logout/password-change (JWTs are
//      normally valid until they expire — without a shared revocation store,
//      a stolen or logged-out token stays usable for up to 15 minutes).
//   3. A short-TTL cache for read-heavy, rarely-changing data (category
//      list, store settings) to cut repeat load on Postgres.
//
// Redis is optional in development (everything degrades to in-memory/no-op)
// but required in production for the same reason CORS_ORIGINS/JWT secrets
// are required: silently degrading to per-pod state in production is a
// correctness bug waiting to happen, not a safe default.

const REDIS_URL = process.env.REDIS_URL;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !REDIS_URL) {
  throw new Error(
    "REDIS_URL must be set in production — rate limiting and token revocation are not safe across multiple replicas without a shared store."
  );
}

let client = null;
if (REDIS_URL) {
  client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 200, 5000)
  });
  client.on("error", (error) => {
    // Never crash the process on a transient Redis blip — /api/health below
    // reports it, and callers here all treat Redis as best-effort (cache
    // misses fail open, rate limiting falls back to allowing the request
    // rather than 500ing the whole API because Redis hiccuped).
    console.error("Redis error:", error.message);
  });
}

export function isRedisConfigured() {
  return Boolean(client);
}

export function getRedisClient() {
  return client;
}

export async function pingRedis() {
  if (!client) return { configured: false, ok: true };
  try {
    await client.ping();
    return { configured: true, ok: true };
  } catch (error) {
    return { configured: true, ok: false, error: error.message };
  }
}

export async function closeRedis() {
  if (client) await client.quit().catch(() => {});
}

// ---- Access-token revocation (logout / password change) ----
// Keyed by the token's `jti`, TTL'd to the token's own remaining lifetime so
// the set never grows unbounded — an entry disappears exactly when the JWT
// it revokes would have expired anyway.
const REVOKED_PREFIX = "velora:revoked-jti:";

export async function revokeAccessToken(jti, ttlSeconds) {
  if (!client || !jti || !ttlSeconds || ttlSeconds <= 0) return;
  try {
    await client.set(REVOKED_PREFIX + jti, "1", "EX", Math.ceil(ttlSeconds));
  } catch (error) {
    console.error("Failed to revoke access token in Redis:", error.message);
  }
}

export async function isAccessTokenRevoked(jti) {
  if (!client || !jti) return false;
  try {
    return Boolean(await client.exists(REVOKED_PREFIX + jti));
  } catch {
    // Fail open: a Redis outage should degrade to "tokens work until they
    // naturally expire" (the pre-Redis behavior), not lock everyone out.
    return false;
  }
}

// ---- Small read-through cache helpers ----
const CACHE_PREFIX = "velora:cache:";

export async function cacheGet(key) {
  if (!client) return null;
  try {
    const raw = await client.get(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  if (!client) return;
  try {
    await client.set(CACHE_PREFIX + key, JSON.stringify(value), "EX", Math.max(1, ttlSeconds));
  } catch (error) {
    console.error("Redis cache write failed:", error.message);
  }
}

export async function cacheDel(keyOrPrefix) {
  if (!client) return;
  try {
    await client.del(CACHE_PREFIX + keyOrPrefix);
  } catch (error) {
    console.error("Redis cache delete failed:", error.message);
  }
}

// Wraps a compute function with a cache-aside pattern: return the cached
// value if present, otherwise compute, cache, and return it. Used for data
// that's read far more often than it changes (categories, store settings).
export async function cached(key, ttlSeconds, computeFn) {
  const hit = await cacheGet(key);
  if (hit !== null) return hit;
  const value = await computeFn();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
