import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_ADDRESS = process.env.SMTP_FROM || "no-reply@velora-store.example";

const isConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
if (process.env.NODE_ENV === 'production' && !isConfigured) throw new Error('SMTP_HOST/SMTP_USER/SMTP_PASS must be configured in production.');

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function send({ to, subject, html, text }) {
  if (!isConfigured || !transporter) {
    // Dev fallback: no SMTP configured, so just log what would have been sent.
    // This keeps the whole email flow fully wired end-to-end without requiring
    // real credentials for local development or this demo build.
    console.log(`\n[DEV EMAIL] To: ${to}\n[DEV EMAIL] Subject: ${subject}\n[DEV EMAIL] Body:\n${text || html}\n`);
    return { delivered: false, mode: "console" };
  }

  try {
    await transporter.sendMail({ from: FROM_ADDRESS, to, subject, html, text });
    return { delivered: true, mode: "smtp" };
  } catch (error) {
    console.error("Email send failed:", error.message);
    return { delivered: false, mode: "smtp-error", error: error.message };
  }
}

export function isEmailConfigured() {
  return isConfigured;
}

export async function sendOrderConfirmationEmail(order) {
  const itemLines = order.items.map((i) => `  - ${i.title} x${i.quantity} — ₹${i.unitPrice * i.quantity}`).join("\n");
  const text = `Hi ${order.customer.name},\n\nYour order ${order.orderNumber} is confirmed.\n\n${itemLines}\n\nTotal: ₹${order.summary.total}\nShipping to: ${order.shippingAddress}\n\nThank you for shopping with us.`;
  return send({
    to: order.customer.email,
    subject: `Order confirmed — ${order.orderNumber}`,
    text
  });
}

export async function sendOrderStatusEmail(order) {
  const text = `Hi ${order.customer.name},\n\nYour order ${order.orderNumber} status changed to: ${order.status}.\n\nTotal: ₹${order.summary.total}`;
  return send({
    to: order.customer.email,
    subject: `Order ${order.orderNumber} — status update: ${order.status}`,
    text
  });
}

export async function sendPasswordResetEmail(email, resetLink) {
  const text = `We received a request to reset your Velora Store password.\n\nReset it here (valid for 1 hour):\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.`;
  return send({
    to: email,
    subject: "Reset your Velora Store password",
    text
  });
}

export async function verifySmtp() { if (!transporter) return false; await transporter.verify(); return true; }
export async function sendRefundEmail(order) { return send({to:order.customer.email,subject:`Refund processed — ${order.orderNumber}`,text:`Hi ${order.customer.name},\n\nYour refund for order ${order.orderNumber} has been processed.\n\nThank you for shopping with VELORA.`}); }

export async function sendReturnStatusEmail(order, ret) {
  const statusText = { requested: 'received your return request', approved: 'approved your return', rejected: 'was unable to approve your return', refunded: 'processed your refund' }[ret.status] || `updated your return to "${ret.status}"`;
  return send({
    to: order.customer.email,
    subject: `Return update — ${order.orderNumber}`,
    text: `Hi ${order.customer.name},\n\nWe ${statusText} for "${ret.productTitle}" (qty ${ret.quantity}) from order ${order.orderNumber}.${ret.adminNote ? `\n\nNote from our team: ${ret.adminNote}` : ''}${ret.refundAmount ? `\n\nRefund amount: ₹${ret.refundAmount}` : ''}\n\nThank you for shopping with VELORA.`
  });
}

export async function sendSupportReplyEmail(user, ticket) {
  return send({
    to: user.email,
    subject: `New reply on your support ticket — ${ticket.subject}`,
    text: `Hi ${user.name},\n\nOur team replied to your support ticket "${ticket.subject}". Sign in to your account to view and respond.\n\nThank you for shopping with VELORA.`
  });
}
