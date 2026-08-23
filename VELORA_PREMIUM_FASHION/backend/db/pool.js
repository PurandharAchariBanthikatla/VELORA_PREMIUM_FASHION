import pg from "pg";

const { Pool } = pg;

function buildConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      // Most managed Postgres providers (Render, Railway, RDS, etc.) require
      // TLS but use certs that Node won't validate against a public CA by
      // default. Set PGSSL=false explicitly if you're connecting to a local
      // Postgres with no TLS at all.
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
    };
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE || "velorastore",
    ssl: false
  };
}

export const pool = new Pool(buildConfig());

export async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Runs `fn` inside a single client with a transaction (BEGIN/COMMIT/ROLLBACK).
 * Use this for any operation that needs more than one statement to succeed
 * or fail together (e.g. creating an order + decrementing stock for each item).
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
