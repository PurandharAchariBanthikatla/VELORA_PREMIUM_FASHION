import Stripe from 'stripe';

let stripe;
function getStripe() {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error('Stripe is not configured.'), { status: 503 });
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: process.env.STRIPE_API_VERSION || undefined });
  }
  return stripe;
}

export async function createCheckoutSession({ order, settings }) {
  const client = getStripe();
  const currency = String(settings.currency || 'INR').toLowerCase();
  const origin = process.env.PUBLIC_APP_URL;
  if (!origin) throw Object.assign(new Error('PUBLIC_APP_URL is required for payments.'), { status: 503 });
  const lineItems = order.items.map(item => ({
    price_data: { currency, product_data: { name: item.title, images: item.image ? [new URL(item.image, origin).toString()] : [] }, unit_amount: Math.round(item.unitPrice * 100) },
    quantity: item.quantity
  }));
  if (order.summary.shipping > 0) lineItems.push({ price_data: { currency, product_data: { name: 'Shipping' }, unit_amount: Math.round(order.summary.shipping * 100) }, quantity: 1 });
  if (order.summary.taxes > 0) lineItems.push({ price_data: { currency, product_data: { name: `Tax (${settings.taxPercent}%)` }, unit_amount: Math.round(order.summary.taxes * 100) }, quantity: 1 });
  return client.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: order.customer.email,
    success_url: `${origin}/?payment=success&order=${encodeURIComponent(order.orderNumber)}`,
    cancel_url: `${origin}/?payment=cancelled&order=${encodeURIComponent(order.orderNumber)}`,
    metadata: { orderId: order.id, orderNumber: order.orderNumber },
    payment_intent_data: { metadata: { orderId: order.id, orderNumber: order.orderNumber } }
  });
}

export function constructWebhookEvent(rawBody, signature) {
  const client = getStripe();
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
  return client.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

export async function refundPayment(paymentIntentId, amount) {
  const client = getStripe();
  return client.refunds.create({ payment_intent: paymentIntentId, ...(amount ? { amount: Math.round(amount * 100) } : {}) });
}
