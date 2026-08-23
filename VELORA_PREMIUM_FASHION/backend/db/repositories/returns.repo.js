import crypto from "node:crypto";
import { pool } from "../pool.js";

const RETURN_WINDOW_DAYS = Number(process.env.RETURN_WINDOW_DAYS || 7);

function toReturn(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    productId: row.product_id,
    productTitle: row.product_title,
    quantity: row.quantity,
    reason: row.reason,
    status: row.status,
    refundAmount: row.refund_amount !== null ? Number(row.refund_amount) : null,
    adminNote: row.admin_note,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    orderNumber: row.order_number || undefined
  };
}

// A return can only be requested for a delivered order, within the return
// window, for an item that's actually in that order, and only once per
// item (re-requesting an already-requested/resolved line is rejected).
export async function assertReturnEligible(order, productId, quantity) {
  if (order.status !== "delivered") throw Object.assign(new Error("Only delivered orders are eligible for a return."), { status: 400 });
  const deliveredAt = (order.statusHistory || []).find((h) => h.status === "delivered")?.at;
  if (deliveredAt && Date.now() - new Date(deliveredAt).getTime() > RETURN_WINDOW_DAYS * 86400000) {
    throw Object.assign(new Error(`The ${RETURN_WINDOW_DAYS}-day return window for this order has passed.`), { status: 400 });
  }
  const item = (order.items || []).find((i) => i.productId === productId);
  if (!item) throw Object.assign(new Error("That item is not part of this order."), { status: 400 });
  if (quantity > item.quantity) throw Object.assign(new Error(`You can return at most ${item.quantity} of this item.`), { status: 400 });
  const { rows } = await pool.query(`SELECT 1 FROM returns WHERE order_id = $1 AND product_id = $2 AND status <> 'rejected'`, [order.id, productId]);
  if (rows.length) throw Object.assign(new Error("A return has already been requested for this item."), { status: 409 });
  return item;
}

export async function createReturn({ orderId, userId, productId, productTitle, quantity, reason }) {
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO returns (id, order_id, user_id, product_id, product_title, quantity, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, orderId, userId, productId, productTitle, quantity, reason]
  );
  return toReturn(rows[0]);
}

export async function getReturnsByOrder(orderId) {
  const { rows } = await pool.query(`SELECT * FROM returns WHERE order_id = $1 ORDER BY requested_at DESC`, [orderId]);
  return rows.map(toReturn);
}

export async function getReturnsByUser(userId) {
  const { rows } = await pool.query(
    `SELECT r.*, o.order_number FROM returns r JOIN orders o ON o.id = r.order_id
     WHERE r.user_id = $1 ORDER BY r.requested_at DESC`,
    [userId]
  );
  return rows.map(toReturn);
}

export async function getReturnById(id) {
  const { rows } = await pool.query(`SELECT r.*, o.order_number FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.id = $1`, [id]);
  return toReturn(rows[0]);
}

export async function listAllReturns({ status } = {}) {
  const params = [];
  let where = "";
  if (status) { params.push(status); where = "WHERE r.status = $1"; }
  const { rows } = await pool.query(
    `SELECT r.*, o.order_number, u.name AS customer_name, u.email AS customer_email
     FROM returns r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
     ${where} ORDER BY r.requested_at DESC LIMIT 500`,
    params
  );
  return rows.map((r) => ({ ...toReturn(r), customerName: r.customer_name, customerEmail: r.customer_email }));
}

export async function updateReturnStatus(id, { status, refundAmount, adminNote }) {
  const { rows } = await pool.query(
    `UPDATE returns SET status = $2, refund_amount = COALESCE($3, refund_amount), admin_note = COALESCE($4, admin_note), resolved_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status, refundAmount ?? null, adminNote ?? null]
  );
  return toReturn(rows[0]);
}
