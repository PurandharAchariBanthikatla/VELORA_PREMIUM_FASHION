import crypto from "node:crypto";
import { pool } from "../pool.js";

function toReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id,
    orderId: row.order_id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    reviewerName: row.reviewer_name || undefined
  };
}

// A customer can review a product once they have a delivered order that
// contains it — this is the same check used both to gate the "Write a
// review" button and to reject a forged POST straight to the API.
export async function findEligibleOrderForReview(userId, productId) {
  const { rows } = await pool.query(
    `SELECT id FROM orders
     WHERE user_id = $1 AND status = 'delivered'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(items) i WHERE i->>'productId' = $2)
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = orders.id AND r.product_id = $2)
     ORDER BY created_at DESC LIMIT 1`,
    [userId, productId]
  );
  return rows[0]?.id || null;
}

export async function createReview({ productId, userId, orderId, rating, title, body }) {
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO reviews (id, product_id, user_id, order_id, rating, title, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, productId, userId, orderId, rating, title, body]
  );
  return toReview(rows[0]);
}

export async function getReviewsForProduct(productId, { includeHidden = false } = {}) {
  const { rows } = await pool.query(
    `SELECT r.*, u.name AS reviewer_name FROM reviews r
     JOIN users u ON u.id = r.user_id
     WHERE r.product_id = $1 ${includeHidden ? "" : "AND r.status = 'published'"}
     ORDER BY r.created_at DESC`,
    [productId]
  );
  return rows.map(toReview);
}

export async function getRatingSummary(productId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(AVG(rating), 0)::numeric(2,1) AS average
     FROM reviews WHERE product_id = $1 AND status = 'published'`,
    [productId]
  );
  return { count: rows[0].count, average: Number(rows[0].average) };
}

export async function listAllReviews({ status } = {}) {
  const clauses = [];
  const params = [];
  if (status) { params.push(status); clauses.push(`r.status = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT r.*, u.name AS reviewer_name, p.title AS product_title FROM reviews r
     JOIN users u ON u.id = r.user_id
     JOIN products p ON p.id = r.product_id
     ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""}
     ORDER BY r.created_at DESC LIMIT 500`,
    params
  );
  return rows.map((r) => ({ ...toReview(r), productTitle: r.product_title }));
}

export async function setReviewStatus(id, status) {
  const { rows } = await pool.query(`UPDATE reviews SET status = $2 WHERE id = $1 RETURNING *`, [id, status]);
  return toReview(rows[0]);
}

export async function deleteReview(id) {
  const { rowCount } = await pool.query(`DELETE FROM reviews WHERE id = $1`, [id]);
  return rowCount > 0;
}
