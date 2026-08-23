# VELORA Store — Full-Stack Ecommerce Platform

A full-stack ecommerce app with a customer storefront + account dashboard, and a
separate admin dashboard for managing products, orders, and customers — all backed
by a real Express API with JWT authentication and persisted data.

> **Note on naming:** this project's source catalog data (`backend/data/products.json`)
> still comes from a generic Indian ethnic-wear dataset (kurtas, sarees, lehengas,
> gowns) with placeholder brand/description text — that placeholder copy has been
> rebranded to VELORA throughout, but the underlying product photography is still
> hot-linked from the original third-party CDN (see "What's still incomplete" below).
> "VELORA" is this project's own storefront brand — replace the catalog data with your
> real inventory before using this as an actual production storefront.

## What's included

**Customer-facing**
- Product catalog with search, category filters, and sorting (`frontend/index.html`)
- Real sign up / sign in (JWT access + refresh tokens, bcrypt-hashed passwords)
- Forgot-password / reset-password flow (`frontend/reset-password.html`)
- Cart and wishlist, synced to your account server-side once signed in (not just
  `localStorage`, so they follow you across devices)
- Stock is checked against the live catalog right before checkout, so you see
  "only 2 left" instead of finding out at the payment step
- Product detail view
- Checkout that creates a real, persisted order
- Customer dashboard (`frontend/account.html`) — overview stats, order history
  with a visual status-tracking timeline per order, wishlist, **saved addresses**
  (multiple, with a default), a derived notifications feed (order status
  updates, read/unread), profile editing, and self-service password change
- **Product reviews** — star rating + written review, gated to verified,
  delivered purchases; shown on the product detail page
- **Self-service returns** — request a return per line item from a delivered
  order, tracked through requested → approved/rejected → refunded
- **PDF invoices** — downloadable from any paid order
- **Support tickets** — open a ticket (optionally tied to an order), thread
  replies with the support team, right from the account dashboard

**Admin-facing** (`frontend/admin/`)
- Admin login (`admin/login.html`), gated by role
- Dashboard overview: revenue, order count, customers, low-stock alerts, active
  coupons, top products, recent orders, plus at-a-glance revenue and
  order-status charts
- Full product CRUD (add/edit/delete, stock, pricing) with **image upload**
  (or paste a URL) — paginated so the 597-item catalog doesn't load into one
  giant table
- **Categories** view — derived live from the product catalog (count + stock
  per category), no separate table to keep in sync
- Order management: view all orders, update status (confirmed → processing →
  shipped → delivered / cancelled)
- Customer directory: orders placed and lifetime spend per customer
- **Inventory** view — stock-focused product list with low-stock/out-of-stock
  filters and inline quick stock updates
- **Analytics** — dedicated revenue-trend and order-status charts, top sellers
- **Coupons** — full CRUD (percent or fixed discount, minimum order, usage
  cap, expiry); validated at checkout and applied to the order total
- **Settings** — store name, tagline, support contact, currency, free-shipping
  threshold, tax percent
- **Activity log**: every admin product/order/coupon/settings change is
  recorded with who did it and when
- **Reviews moderation** — publish/hide/delete any customer review
- **Returns & refunds** — review requests, approve/reject, or trigger an
  actual Stripe refund for a specific amount
- **Support** — view and reply to every customer ticket, close/reopen

**Backend**
- Express API in `backend/`, organized into routers (`routes/`), services
  (`services/`), and middleware (`middleware/`) — shared logic (the async-route
  wrapper, the API client, money/HTML-escaping helpers) lives in one place rather
  than being copy-pasted per file
- JWT auth: short-lived access tokens + rotating refresh tokens, with role-based
  access control (`customer` / `admin`)
- `helmet` + rate limiting (tighter limits on `/api/auth/*` to slow down
  brute-forcing) wired into `app.js`
- Orders, users, wishlists, carts, and an admin audit log persisted to
  `backend/data/db.json`
- Products persisted to `backend/data/products.json` (admin edits write back to
  this file)
- A default admin account is auto-seeded on first run
- An automated test suite (`npm test`, Node's built-in test runner) covering auth,
  orders, stock validation, admin CRUD, and the token-rotation/password-reset flows

## Run locally

You need a Postgres database. The quickest way to get one:

```bash
docker run -d --name velora-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=velorastore \
  postgres:16-alpine
```

(Or use a local Postgres install, or a free-tier managed database — see "Production
database" below.)

Then:

```bash
npm install
npm start
```

`npm start` automatically runs migrations, seeds the default admin account, and — only
if the products table is completely empty — seeds the bundled product catalog. You
don't need to run any setup command separately for a first run.

Open `http://localhost:3000`.

- Storefront: `http://localhost:3000`
- Customer dashboard: `http://localhost:3000/account.html` (after signing in)
- Admin dashboard: `http://localhost:3000/admin/login.html`

Run the test suite any time with:

```bash
npm test
```

(This runs against a separate `velorastore_test` database — set `TEST_PGDATABASE` to
change its name — so it never touches your real data. Create it once with
`createdb velorastore_test` or the Postgres client of your choice; the test suite handles
its own schema/migrations/fixtures from there.)

### Manual migration/seed commands

These run automatically on `npm start`, but you can also run them directly:

```bash
npm run db:migrate   # apply any pending schema migrations
npm run db:seed      # (re-)load backend/data/products.json into the products table
```

`db:seed` is an upsert by product id — safe to re-run, but it will overwrite
title/price/etc. for any product whose id matches one in that JSON file, including
ones you've since edited through the admin dashboard. It won't touch products you
added directly through the admin panel (different id scheme).

### Default admin login

```
Email:    admin@velora.com
Password: Admin@123
```

This account is created automatically the first time the server runs. **Change this
password** the first time you sign in — go to Admin Dashboard → there's no in-app admin
password-change UI yet, so for now use the customer-side password endpoint directly:

```bash
curl -X PUT http://localhost:3000/api/auth/password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin access token from /api/auth/login>" \
  -d '{"currentPassword":"Admin@123","newPassword":"something-much-stronger"}'
```

(Or use the "forgot password" flow from the login screen — see below.)

## Password reset, without a real email server

There's no live SMTP configured in this environment, so `forgot-password` doesn't
send a real email by default — it logs what *would* be sent to the server console
(prefixed `[DEV EMAIL]`) and, outside `NODE_ENV=production`, also returns the reset
link directly in the API response so you can test the flow without an inbox. To send
real email, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in
your environment — `backend/services/email.service.js` will pick them up automatically
via `nodemailer`. This has not been tested against a live SMTP provider in this
environment; test it against a real inbox before relying on it in production.

## How data is stored

This runs on real Postgres now (it used to be two JSON files — see "Migrating from an
older version" below if that's where you're coming from).

- **Schema**: `backend/db/migrations/001_init.sql` (`users`, `products`, `orders`,
  `audit_log`) plus `002_velora_upgrade.sql` (`coupons`, `store_settings`, and an
  `orders.coupon_code` column) — both tracked by a `schema_migrations` table so
  `npm run db:migrate` only ever applies what's pending
- **Data access**: `backend/db/repositories/` — one file per entity
  (`users.repo.js`, `products.repo.js`, `orders.repo.js`, `audit.repo.js`). Routes call
  these instead of writing SQL inline, so the query logic lives in one place per entity
- **Connection**: `backend/db/pool.js` — reads `DATABASE_URL` if set, otherwise
  individual `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` vars
- **Order placement is a real transaction**: creating an order and decrementing stock
  for each line item happens inside a single `BEGIN`/`COMMIT`, using
  `SELECT ... FOR UPDATE` to lock the product rows being purchased. Verified this
  actually prevents overselling by firing 5 concurrent checkout requests at a
  3-in-stock product — exactly 3 succeeded, 2 correctly failed, final stock was exactly
  0, never negative.

**Heads up on re-seeding:** `npm run db:seed` (or `npm run build`, which calls it) will
overwrite any product whose id matches one in `backend/data/products.json`, including
title/price edits you've made through the admin panel — because it upserts by id. It
won't touch products you added directly through the admin panel, since those get a
different id prefix (`admin-...`). `npm start` alone never re-seeds an already-populated
catalog, only an empty one.

### Production database

Any managed Postgres works — Render, Railway, Supabase, Neon, AWS RDS, etc. Set
`DATABASE_URL` to the connection string they give you. Most of them terminate TLS with
a certificate Node won't validate against a public CA by default, which is why
`pool.js` defaults to `ssl: { rejectUnauthorized: false }` when `DATABASE_URL` is set —
set `PGSSL=false` only if you're deliberately connecting to a local Postgres with no
TLS at all.

### Migrating from an older version of this project

If you have an existing `backend/data/db.json` from a previous version (JSON-file
storage), there isn't an automated import script for it in this version — the schema
changed meaningfully enough (real foreign keys, `NUMERIC` pricing, JSONB fields) that a
straight file copy won't work. If you need your old users/orders carried over, the
cleanest path is a short one-off script that reads that JSON file and calls
`users.repo.js`/`orders.repo.js` functions to re-insert each record — happy to write
that if you need it, it just wasn't something anyone had actual data for yet, so it's
not included speculatively.

## API reference

**Public**
- `GET /api/health`
- `GET /api/products?category=men&search=shirt&sort=price-asc`
- `GET /api/products/:id`
- `GET /api/categories`
- `POST /api/cart/validate` — `{ items: [{productId, quantity}] }`, checks stock without placing an order

**Auth**
- `POST /api/auth/register` — `{ name, email, password }` → `{ token, refreshToken, user }`
- `POST /api/auth/login` — `{ email, password }` → `{ token, refreshToken, user }`
- `POST /api/auth/refresh` — `{ refreshToken }` → new `{ token, refreshToken, user }`
- `POST /api/auth/logout` (auth required) — revokes the current refresh token
- `GET /api/auth/me` (auth required)
- `PUT /api/auth/me` (auth required) — update `name` / `phone` / `address`
- `PUT /api/auth/password` (auth required) — `{ currentPassword, newPassword }`, also rotates refresh tokens
- `POST /api/auth/forgot-password` — `{ email }`
- `POST /api/auth/reset-password` — `{ email, token, newPassword }`

**Customer** (auth required, Bearer token)
- `GET /api/orders` — your own orders
- `POST /api/orders` — `{ items: [{productId, quantity}], shippingAddress, payment: {method, cardNumber?} }`
- `GET /api/orders/:id`
- `GET /api/account/wishlist` / `PUT /api/account/wishlist`
- `GET /api/account/cart` / `PUT /api/account/cart`

**Admin** (auth required, `role: "admin"`)
- `GET /api/admin/stats`
- `GET /api/admin/products?page=&pageSize=&search=` (paginated) / `POST /api/admin/products` / `PUT /api/admin/products/:id` / `DELETE /api/admin/products/:id`
- `POST /api/admin/upload` — multipart form, field name `image`, returns `{ url }`
- `GET /api/admin/orders` / `PUT /api/admin/orders/:id/status`
- `GET /api/admin/users`
- `GET /api/admin/audit` — recent admin actions

Payments are a demo flow — orders are marked "paid" without actually charging a card.
Connect Stripe (or another processor) before accepting real payments.

## Deploy (Docker — self-hosted)

This project no longer targets Vercel or Render. It ships with a `Dockerfile` so you can
run it on any machine or VPS that has Docker installed — your own server, a home lab box,
a cloud VM (DigitalOcean/Linode/EC2/etc.), anywhere. It needs a Postgres database
reachable from the container — either run one alongside it (below), or point it at a
managed provider and skip straight to running the app container.

No Docker Compose here (by request) — just plain `docker run`, wired together with a
Docker network.

### Build and run (app + a Postgres container, no managed DB)

```bash
# 1. Create a network so the two containers can reach each other by name
docker network create velora-net

# 2. Run Postgres
docker volume create velora-pg-data
docker run -d --name velora-postgres --network velora-net \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=velorastore \
  -v velora-pg-data:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:16-alpine

# 3. Build the app image
docker build -t velora-store .

# 4. Run the app, pointing it at the Postgres container by name
docker run -d --name velora-store --network velora-net \
  -p 3000:3000 \
  -e PGHOST=velora-postgres -e PGPORT=5432 -e PGUSER=postgres -e PGPASSWORD=postgres -e PGDATABASE=velorastore \
  -e PGSSL=false \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  -v velora-uploads:/app/frontend/uploads \
  --restart unless-stopped \
  velora-store

# 5. Check it's healthy (migrations + seeding happen automatically on first boot)
curl http://localhost:3000/api/health
```

The app is now running at `http://localhost:3000`.

### Build and run (app only, pointing at a managed Postgres)

If you're using a managed database (Render, Railway, Supabase, Neon, RDS, etc.), skip
the Postgres container entirely:

```bash
docker build -t velora-store .
docker run -d --name velora-store -p 3000:3000 \
  -e DATABASE_URL="postgres://user:password@your-host:5432/velorastore" \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  -v velora-uploads:/app/frontend/uploads \
  --restart unless-stopped \
  velora-store
```

**Common operations:**

```bash
docker logs -f velora-store              # view app logs
docker logs -f velora-postgres           # view database logs
docker stop velora-store velora-postgres   # stop both (data is preserved)
docker start velora-postgres velora-store  # start the DB first, then the app
docker rm -f velora-store                # remove the app container (DB untouched)
docker volume rm velora-pg-data          # wipe the database and start fresh
docker volume rm velora-uploads          # wipe uploaded product images
```

To rebuild the app after making code changes, just repeat steps 3–4 (the Postgres
container doesn't need to change).

### Deploying to a remote server

1. Copy this project to the server (or `git clone` it there), or push the image to a
   registry (`docker build -t your-registry/velora-store . && docker push ...`) and pull it
   on the server instead.
2. Make sure Docker is installed on the server.
3. Run the `docker network create` / `docker run` commands above on the server (or point
   `DATABASE_URL` at a managed Postgres instead of running one yourself — often the
   better choice for a real deployment, since it comes with backups).
4. Put a reverse proxy (nginx, Caddy, or Traefik) in front of port 3000 to handle TLS/HTTPS
   and your domain name — the app itself only serves plain HTTP.

### Notes

- The Docker image bundles the already-generated `backend/data/products.json`, used to
  seed Postgres on first boot, so it works without any outbound network access to the
  original GitHub product-data source once the image is built.
- Uploaded product images land in `frontend/uploads/` inside the container — mount a
  volume there (as shown above) if you want them to survive a rebuild.
- Always set `JWT_SECRET` and `JWT_REFRESH_SECRET` yourself for anything beyond local
  testing. Without them, the app falls back to hardcoded dev secrets, which is fine on
  your laptop but not safe for a publicly reachable deployment.
- Set up your own backup schedule for the Postgres volume/database — `docker volume` on
  its own is not a backup strategy.

## What's still incomplete

Everything below was pending as of the last review. Items marked **done** were built,
tested, and verified working in this pass; the rest are genuinely still open —
mostly because they need something this environment can't provide (a real payment
processor, a real SMTP account, or a browser to click through) or because they're
larger scope than fit in this pass.

**VELORA rebrand + dashboard expansion (this pass)**
- Full rebrand from the previous placeholder brand to VELORA — Premium Fashion &
  Lifestyle — across every user-facing string, the storefront/customer/admin UI,
  localStorage keys, the JWT-carried namespace, the seeded admin account, and the
  product catalog's placeholder brand/description text.
- New luxury visual system: jewel-tone + gold-gradient palette, Playfair
  Display/Jost typography, animated hero background, image-zoom product cards,
  gradient buttons/nav, scroll-reveal, and a redesigned dashboard shell (customer
  + admin) with sidebar navigation, stat cards, and section transitions.
- Customer dashboard: **Saved Addresses** (multiple, with a default — new
  `/api/account/addresses` CRUD, backward-compatible with the old single-string
  address field) and a **Notifications** feed derived from each order's status
  history, plus an order-tracking timeline embedded in My Orders.
- Admin dashboard: **Categories** (derived from the live catalog), **Inventory**
  (stock-focused view with quick inline updates), **Analytics** (dedicated charts),
  **Coupons** (new `coupons` table, full CRUD, validated and applied at checkout),
  and **Settings** (new `store_settings` table).
- **Important caveat**: this sandbox has no outbound network access and no local
  Postgres instance, so none of the new backend code could be run against a live
  database or exercised through a browser here. Every backend and frontend file was
  syntax-checked (`node --check`) and manually reviewed for correctness, but it has
  not been integration-tested end-to-end the way the pre-existing `npm test` suite
  covers the original routes. Run `npm run db:migrate && npm test` locally before
  trusting the new endpoints in production.

**Auth / accounts**
- ~~No password reset flow~~ — **done**: forgot/reset-password, dev-mode token
  display since there's no live SMTP here (see above)
- ~~No self-service password change~~ — **done**, in the customer dashboard's
  Security tab; there's no dedicated *admin* UI for it yet, use the API directly
  (see "Default admin login" above)
- ~~No token refresh~~ — **done**: 15-minute access tokens, 7-day refresh tokens,
  automatic silent refresh-and-retry on 401 in the frontend API client

**Commerce**
- Payments are still a demo flow — no real Stripe/Razorpay integration. This needs
  real API keys and a live network connection to a payment processor, neither of
  which this environment has, so it hasn't been built or tested here.
- ~~No email notifications~~ — **partially done**: order confirmation, order status
  changes, and password reset all fire through a shared email service. It has never
  sent a real email in this environment (no outbound SMTP access) — it logs what
  would be sent. Set `SMTP_*` env vars to send real mail, and test against a real
  inbox before trusting it.
- ~~Cart/wishlist not synced server-side~~ — **done**
- ~~No stock check on the frontend before checkout~~ — **done**, plus the backend
  now actually validates requested quantity against stock when an order is placed
  (this was a real gap in the original checkout flow — a customer could order more
  than was in stock and the order would silently succeed)

**Admin**
- ~~No image upload~~ — **done** (multer, 5MB limit, image MIME types only)
- ~~No pagination on the admin product table~~ — **done**, server-side, 20/page by default
- ~~No audit trail~~ — **done**: product create/update/delete and order status
  changes are recorded with who/when/what

**Infra / hardening**
- ~~No rate limiting or `helmet`~~ — **done**
- ~~No automated tests~~ — **done**: `npm test` runs 19 integration tests against a
  dedicated `velorastore_test` Postgres database (won't touch your real data),
  covering registration, login, stock validation, order placement, admin CRUD, and
  the refresh-token/password-reset flows. This is a smoke-test suite, not
  exhaustive coverage — there's no dedicated unit-test layer for individual
  functions in isolation.
- ~~JSON-file "database"~~ — **done**: migrated to real Postgres with proper
  schema, foreign keys, and indexes. Order placement (creating the order +
  decrementing stock for every line item) now runs inside an actual database
  transaction with row-level locking (`SELECT ... FOR UPDATE`) — tested by firing
  5 concurrent checkout requests at a 3-in-stock item; exactly 3 succeeded, 2
  correctly failed, and final stock landed at exactly 0. The old JSON-file version
  could not have made that guarantee under real concurrent load.
- Product images are still hot-linked from third-party CDNs (Flipkart image URLs
  from the original dataset) for the pre-existing catalog. This genuinely could
  not be fixed in this environment — this sandbox's network allowlist doesn't
  include the CDN domain the images are hosted on, so there was no way to download
  and re-host them. Going forward, though, the admin image-upload feature means any
  product you add or edit from here on doesn't have to depend on an external CDN.
- Real payments (Stripe/Razorpay) — still not built. This needs real API keys and
  live network access to a payment processor, neither of which is available in this
  environment, so it hasn't been attempted here yet.
- ~~No animated/polished UI~~ — **done**: scroll-reveal on section entrances,
  staggered product-card entrance animations, a skeleton loading state for the
  product grid (replacing plain "Loading..." text), animated count-up on dashboard
  stat numbers, badge "bump" animations on cart/wishlist/order count changes,
  button micro-interactions, and a working fade-out for the splash loader (which,
  worth noting, was completely non-functional before this pass — the loading
  screen existed in the HTML/CSS but nothing in the JS ever hid it, so the site
  would have been stuck behind a permanent splash screen). All animations respect
  `prefers-reduced-motion`.

**Known limitations found during this pass (not by reading code, by testing):**
- Refresh tokens were originally hashed with `bcrypt` for storage, which silently
  truncates its input at 72 bytes. Two refresh tokens issued to the same user share
  an identical prefix well past that point (JWT header + the `sub`/`type` claims
  come before the random part), so `bcrypt` was hashing the same truncated prefix
  every time — meaning "rotate the refresh token to invalidate old sessions" wasn't
  actually invalidating anything. Fixed: refresh tokens are hashed with SHA-256
  instead, which has no such limit — there's a regression test for it
  (`changing password invalidates the previous refresh token` in
  `backend/test/api.test.mjs`).
- A Postgres type-inference bug: queries shaped like
  `WHERE id = $1 OR order_number = $1` (used to look up an order by either its
  UUID or its human-readable order number) failed with
  `operator does not exist: text = uuid`, because Postgres infers `$1`'s type from
  the first comparison it sees and then can't compare that same parameter against
  a `text` column. Fixed by casting explicitly: `WHERE id::text = $1 OR order_number = $1`.

# VELORA production hardening (2026-08)

This build replaces the demo card flow with Stripe Checkout, adds signed webhook processing and refunds, makes store settings authoritative at server-side checkout calculation, and makes coupon redemption race-safe with a conditional database update plus redemption record.

### Production setup

1. Copy `.env.example` to `.env` and populate every production value. Never commit `.env`.
2. Generate secrets with `openssl rand -hex 32`; use different values for `JWT_SECRET` and `JWT_REFRESH_SECRET`.
3. Configure a managed PostgreSQL database and run `npm run db:migrate`.
4. Configure Stripe live mode and point its webhook endpoint at `/api/payments/webhook` with the signing secret.
5. Configure SMTP and run a real-inbox delivery test for order confirmation, shipping/status, password reset and refund emails.
6. Configure S3 + CDN and run `npm run mirror:images` from a networked environment to replace all third-party product-image URLs in `products.json`.
7. Configure Sentry.
8. Configure the daily GitHub Actions PostgreSQL backup secrets and managed-Postgres PITR.
9. Deploy multiple stateless app replicas behind an HTTPS load balancer using `/api/health` as the health check. See `DEPLOYMENT_PRODUCTION.md`.

### Payment flow

The browser never posts a card number to VELORA. Checkout creates a server-side Stripe Checkout Session from database prices, taxes, shipping and the final coupon decision, then redirects to Stripe-hosted payment UI. The webhook is the source of truth for successful payment and is idempotent via `payment_events`. Refunds are initiated from the admin API and finalized by Stripe webhook events.

### Important verification boundary

This repository was hardened and syntax-checked in the current environment, but this environment does not provide outbound DNS/network access, live Stripe credentials, live SMTP credentials, S3 credentials, a running PostgreSQL server, or a real browser session. Therefore those external launch gates cannot honestly be marked as executed here. Run the supplied CI, image mirror, backup, rate-limit and production QA procedures in a networked staging environment before accepting live traffic.

# VELORA customer-experience completion (2026-08, session 2)

This pass added the remaining customer-facing and operational pieces requested but not yet present: Redis (shared rate limiting, immediate access-token revocation on logout/password-change, response caching — required in production via `REDIS_URL`, same fail-fast pattern as `CORS_ORIGINS`), product reviews (gated to verified, delivered purchases), self-service returns with admin approve/reject/refund (refund calls the existing Stripe `refundPayment` service), PDF invoices (PDFKit, streamed, no external rendering dependency), a full support-ticket system (customer + admin), four real legal pages (privacy, terms, returns policy, shipping policy), and SEO basics (`robots.txt`, a catalog-driven `/sitemap.xml`). It also fixed two real gaps found while doing this: private API responses now actually send `Cache-Control: no-store` (previously only documented, not enforced), and logout/password-change now revoke the current access token immediately instead of leaving it valid for its remaining lifetime.

New database objects: migration `004_customer_experience.sql` adds `reviews`, `returns`, `support_tickets`, `support_messages` — purely additive, no existing table changed.

**Verification boundary (same standard as above):** every new/changed file passes `node --check` via `npm run check`, and nothing existing was removed or altered in behavior beyond the two fixes named above. This session had the same infrastructure gap as the previous one — no `psql`, `redis-server`, or npm-registry access — so the new migration, repositories, routes, Redis-backed rate limiting, and the new Stripe refund call path have not been run against real Postgres/Redis/Stripe, and the new frontend flows have not been exercised in a real browser. Run `npm run db:migrate && npm test` against a real database, and manually smoke-test the review/return/support/invoice flows, before trusting this in production. See `PRODUCTION_READINESS_REPORT.md` §5 for the full accounting.
