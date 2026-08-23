import app from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { seedProducts } from "./db/seed.js";
import { ensureSeedAdmin } from "./db/repositories/users.repo.js";
import { countProducts } from "./db/repositories/products.repo.js";
import { pool } from "./db/pool.js";
import { verifySmtp, isEmailConfigured } from "./services/email.service.js";

const port = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000;

async function start() {
  // Migrations and the admin seed are safe to run on every boot — both are
  // idempotent (migrations track what's already applied; ensureSeedAdmin
  // only inserts if no admin exists yet).
  await runMigrations();
  await ensureSeedAdmin();

  // email.service.js already fails fast at import time if SMTP_HOST/USER/PASS
  // are missing in production, but that only checks the values are *present*
  // — not that they're actually correct. A typo'd password or a blocked port
  // would otherwise go undetected until the first real customer needs a
  // password-reset email, and even then would fail silently (send() catches
  // errors and just logs). Verifying the SMTP connection at boot, in
  // production, turns that into a fail-fast startup error instead.
  if (process.env.NODE_ENV === "production" && isEmailConfigured()) {
    try {
      await verifySmtp();
      console.log("SMTP connection verified.");
    } catch (error) {
      console.error("SMTP verification failed at startup:", error.message);
      throw new Error(`Cannot start: SMTP is configured but unreachable/rejecting auth (${error.message})`);
    }
  }

  // The product catalog is only auto-seeded if the table is completely
  // empty (a brand-new database), so restarting the server never overwrites
  // prices/stock/products you've since edited through the admin dashboard.
  // To re-seed intentionally, run `npm run db:seed` yourself.
  const existingProducts = await countProducts();
  if (existingProducts === 0) {
    console.log("Products table is empty — seeding the bundled catalog...");
    await seedProducts();
  }

  const server = app.listen(port, () => {
    console.log(`Velora store running at http://localhost:${port}`);
  });

  // Kubernetes (and any other orchestrator running multiple replicas behind
  // a load balancer) sends SIGTERM before killing a pod — for a rolling
  // update, a scale-down, or a node drain. Without handling it, Node's
  // default behavior is to terminate immediately, which drops in-flight
  // requests and can leave a Postgres transaction half-committed. This:
  //   1. stops accepting new connections immediately (server.close),
  //   2. lets in-flight requests finish naturally,
  //   3. closes the Postgres pool once the server is fully drained,
  //   4. force-exits after SHUTDOWN_TIMEOUT_MS as a backstop, so a stuck
  //      connection can never hang the pod past its terminationGracePeriod.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);

    const forceExit = setTimeout(() => {
      console.error(`Graceful shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async (closeError) => {
      if (closeError) console.error("Error while closing HTTP server:", closeError);
      try {
        await pool.end();
      } catch (poolError) {
        console.error("Error while closing the database pool:", poolError);
      }
      clearTimeout(forceExit);
      process.exit(closeError ? 1 : 0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error("Failed to start the Velora store server:", error);
  process.exit(1);
});
