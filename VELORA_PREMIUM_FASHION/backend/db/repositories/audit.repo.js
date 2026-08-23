import crypto from "node:crypto";
import { pool } from "../pool.js";

export async function logAudit({ action, entity, entityId, summary, adminId, adminName }) {
  await pool.query(
    `INSERT INTO audit_log (id, action, entity, entity_id, summary, admin_id, admin_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [crypto.randomUUID(), action, entity, entityId, summary, adminId, adminName]
  );
}

export async function getRecentAudit(limit = 100) {
  const { rows } = await pool.query("SELECT * FROM audit_log ORDER BY at DESC LIMIT $1", [limit]);
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    summary: row.summary,
    adminId: row.admin_id,
    adminName: row.admin_name,
    at: row.at
  }));
}
