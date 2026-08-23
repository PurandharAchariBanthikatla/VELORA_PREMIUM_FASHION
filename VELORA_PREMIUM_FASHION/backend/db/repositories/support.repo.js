import crypto from "node:crypto";
import { pool, withTransaction } from "../pool.js";

function toTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    orderId: row.order_id,
    subject: row.subject,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.customer_name || undefined,
    customerEmail: row.customer_email || undefined,
    orderNumber: row.order_number || undefined
  };
}

function toMessage(row) {
  return { id: row.id, ticketId: row.ticket_id, senderRole: row.sender_role, senderName: row.sender_name, body: row.body, createdAt: row.created_at };
}

export async function createTicket({ userId, subject, orderId, senderName, body }) {
  return withTransaction(async (client) => {
    const id = crypto.randomUUID();
    const { rows } = await client.query(
      `INSERT INTO support_tickets (id, user_id, order_id, subject) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, userId, orderId || null, subject]
    );
    await client.query(
      `INSERT INTO support_messages (id, ticket_id, sender_role, sender_name, body) VALUES ($1,$2,'customer',$3,$4)`,
      [crypto.randomUUID(), id, senderName, body]
    );
    return toTicket(rows[0]);
  });
}

export async function addMessage(ticketId, { senderRole, senderName, body }) {
  return withTransaction(async (client) => {
    const ticket = (await client.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId])).rows[0];
    if (!ticket) return null;
    const { rows } = await client.query(
      `INSERT INTO support_messages (id, ticket_id, sender_role, sender_name, body) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [crypto.randomUUID(), ticketId, senderRole, senderName, body]
    );
    // A customer reply reopens a ticket that was pending customer response;
    // an admin reply marks it pending (waiting on the customer) unless it's
    // already been closed out from under them.
    const nextStatus = senderRole === "admin" ? "pending" : ticket.status === "closed" ? "open" : "open";
    await client.query(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [ticketId, nextStatus]);
    return toMessage(rows[0]);
  });
}

export async function getTicketsByUser(userId) {
  const { rows } = await pool.query(`SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]);
  return rows.map(toTicket);
}

export async function getTicketWithMessages(ticketId) {
  const ticketRes = await pool.query(
    `SELECT t.*, u.name AS customer_name, u.email AS customer_email, o.order_number
     FROM support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN orders o ON o.id = t.order_id
     WHERE t.id = $1`,
    [ticketId]
  );
  if (!ticketRes.rows[0]) return null;
  const messagesRes = await pool.query(`SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticketId]);
  return { ticket: toTicket(ticketRes.rows[0]), messages: messagesRes.rows.map(toMessage) };
}

export async function listAllTickets({ status } = {}) {
  const params = [];
  let where = "";
  if (status) { params.push(status); where = "WHERE t.status = $1"; }
  const { rows } = await pool.query(
    `SELECT t.*, u.name AS customer_name, u.email AS customer_email, o.order_number
     FROM support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN orders o ON o.id = t.order_id
     ${where} ORDER BY t.updated_at DESC LIMIT 500`,
    params
  );
  return rows.map(toTicket);
}

export async function setTicketStatus(ticketId, status) {
  const { rows } = await pool.query(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [ticketId, status]);
  return toTicket(rows[0]);
}
