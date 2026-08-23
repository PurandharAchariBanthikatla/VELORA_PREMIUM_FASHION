# VELORA production deployment

## Required services
- Managed PostgreSQL 16+ with automated point-in-time recovery.
- Managed Redis (or Redis-compatible: AWS ElastiCache, Upstash, etc.) — required for cross-replica rate limiting, immediate access-token revocation, and response caching. See `backend/services/redis.service.js`. The server refuses to boot in production without `REDIS_URL` set.
- Stripe live mode + webhook endpoint `POST /api/payments/webhook`.
- SMTP provider tested against a real inbox.
- S3-compatible object storage + CDN; run `npm run mirror:images` before launch.
- Sentry project.
- Load balancer with HTTPS termination and `/api/health` health checks.

## Horizontal scaling
Run multiple identical stateless VELORA containers behind an AWS ALB/NLB, Cloudflare Load Balancer, or equivalent. JWT access/refresh tokens are self-contained, so no sticky sessions are required. Postgres is the shared source of truth; Redis is the shared rate-limit/cache/revocation store — without it, each replica would enforce rate limits and token revocation independently, which an attacker can trivially bypass by being load-balanced across pods; S3/CDN is the shared media store. Each task must use the same production environment variables.

Health check: `GET /api/health` should return HTTP 200 only when Postgres is reachable; the response also reports Redis status under `redis`, but a Redis outage is non-fatal to the health check (rate limiting/caching degrade gracefully rather than taking the pod out of rotation). Configure the load balancer to use a 10-second interval, 5-second timeout, healthy threshold 2, unhealthy threshold 3.

Deploy flow: build immutable image -> run migrations once as a release job -> deploy new tasks -> wait for health checks -> drain old tasks.

## CDN/cache strategy
- Product images are immutable S3 objects and are served through the CDN with `Cache-Control: public,max-age=31536000,immutable`.
- JS/CSS/static assets are served with `Cache-Control: public, max-age=86400`; HTML is served `no-cache` so releases propagate immediately (see the `setHeaders` block in `backend/app.js`).
- Private API responses (`/api/auth`, `/api/account`, `/api/admin`, `/api/orders`, `/api/support`, `/api/payments`, coupon routes) now send `Cache-Control: no-store` (see `backend/middleware/cache.js`) — this was previously only a stated intention in this doc and in the NetworkPolicy comments, not an actual header; a CDN placed in front of the app per this doc could otherwise have cached one customer's private response and served it to another. Public catalog/category/store-settings/sitemap responses are short-TTL edge-cacheable instead.

## Stripe
Use live keys only in a secrets manager. Configure Stripe to send `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, and `charge.refunded` to `/api/payments/webhook`. Verify the signature and keep webhook processing idempotent using `payment_events`.

## Backups
The included GitHub Actions workflow runs a daily `pg_dump` and stores it in S3. For a serious production workload, enable managed Postgres PITR as the primary recovery mechanism and retain independent daily/weekly/monthly backup copies. Test restoration regularly.

## Security checklist
- `NODE_ENV=production`.
- Generate two different random JWT secrets with at least 32 bytes of entropy.
- Configure restrictive `CORS_ORIGINS`.
- Configure Redis (`REDIS_URL`), SMTP, Stripe, S3, Sentry and `PUBLIC_APP_URL`.
- Use HTTPS only.
- Store secrets in AWS Secrets Manager/SSM, GitHub Actions secrets, or equivalent—not in the repository.
- Verify SMTP delivery to a real inbox before launch.
- Run `npm test` against a dedicated real PostgreSQL test database.
- Run the image mirror script from a networked environment and verify every catalog image resolves through your CDN.
