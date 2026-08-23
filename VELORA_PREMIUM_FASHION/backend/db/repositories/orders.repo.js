import crypto from 'node:crypto';
import { pool, withTransaction } from '../pool.js';
import { adjustStock } from './products.repo.js';
import { validateCoupon, redeemCouponAtomically } from './coupons.repo.js';

function toOrder(row) {
  if (!row) return null;
  return { id: row.id, orderNumber: row.order_number, userId: row.user_id, customer: row.customer, items: row.items, shippingAddress: row.shipping_address, payment: row.payment, summary: row.summary, status: row.status, statusHistory: row.status_history, couponCode: row.coupon_code || null, paymentProvider: row.payment_provider, paymentSessionId: row.payment_session_id, paymentIntentId: row.payment_intent_id, paidAt: row.paid_at, refundedAt: row.refunded_at, createdAt: row.created_at };
}

export async function createPendingOrder({ user, items, shippingAddress, couponCode, settings, paymentProvider='stripe' }) {
  return withTransaction(async client => {
    const lineItems=[];
    for (const raw of items) {
      const productId = raw.productId; const quantity = Math.max(1, Number(raw.quantity)||1);
      const {rows}=await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[productId]); const product=rows[0];
      if(!product) throw Object.assign(new Error('Some bag items are no longer available.'),{status:400});
      if(product.stock<quantity) throw Object.assign(new Error(product.stock===0?`"${product.title}" is out of stock.`:`Only ${product.stock} of "${product.title}" left in stock.`),{status:400});
      lineItems.push({productId:product.id,title:product.title,image:product.image,unitPrice:Number(product.selling_price),quantity});
    }
    const subtotal=lineItems.reduce((s,i)=>s+i.unitPrice*i.quantity,0);
    let discount=0, appliedCouponCode=null, couponId=null;
    if(couponCode){ const result=await validateCoupon(couponCode,subtotal,client); if(!result.valid) throw Object.assign(new Error(result.reason),{status:400}); discount=result.discount; appliedCouponCode=result.coupon.code; couponId=result.coupon.id; }
    const discounted=Math.max(0,subtotal-discount);
    const shipping=discounted===0 || discounted>=Number(settings.freeShippingThreshold)?0:Number(process.env.SHIPPING_FEE||299);
    const taxes=Math.round(discounted*Number(settings.taxPercent)/100);
    const total=discounted+shipping+taxes;
    const id=crypto.randomUUID(), orderNumber=`VLR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`, now=new Date().toISOString();
    const order={id,orderNumber,userId:user.id,customer:{name:user.name,email:user.email},items:lineItems,shippingAddress,payment:{method:paymentProvider,status:'pending'},summary:{items:lineItems.reduce((n,i)=>n+i.quantity,0),subtotal,discount,shipping,taxes,total},status:'pending_payment',statusHistory:[{status:'pending_payment',at:now}],couponCode:appliedCouponCode};
    await client.query(`INSERT INTO orders (id,order_number,user_id,customer,items,shipping_address,payment,summary,status,status_history,coupon_code,payment_provider) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,orderNumber,user.id,JSON.stringify(order.customer),JSON.stringify(order.items),shippingAddress,JSON.stringify(order.payment),JSON.stringify(order.summary),order.status,JSON.stringify(order.statusHistory),couponId?appliedCouponCode:null,paymentProvider]);
    for(const item of lineItems) await adjustStock(item.productId,-item.quantity,client);
    return order;
  });
}

export async function attachPaymentSession(orderId, sessionId){ const {rows}=await pool.query('UPDATE orders SET payment_session_id=$2 WHERE id=$1 RETURNING *',[orderId,sessionId]); return toOrder(rows[0]); }

export async function confirmPaidOrder({orderId,sessionId,paymentIntentId}){ return withTransaction(async client=>{
  const {rows}=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId]); const row=rows[0]; if(!row) return null;
  if(row.status==='confirmed'||row.status==='processing'||row.status==='shipped'||row.status==='delivered') return toOrder(row);
  if(sessionId && row.payment_session_id && row.payment_session_id!==sessionId) throw new Error('Payment session mismatch.');
  let couponId=null; if(row.coupon_code){ const c=await client.query('SELECT id FROM coupons WHERE code=$1 FOR UPDATE',[row.coupon_code]); couponId=c.rows[0]?.id; }
  if(couponId) await redeemCouponAtomically(row.coupon_code,row.id,row.user_id,couponId,client);
  const payment={...(row.payment||{}),status:'paid',provider:'stripe',paymentIntentId};
  const now=new Date().toISOString(); const history=[...(row.status_history||[]),{status:'confirmed',at:now}];
  const updated=await client.query(`UPDATE orders SET status='confirmed',payment=$2,payment_intent_id=$3,paid_at=now(),status_history=$4 WHERE id=$1 RETURNING *`,[row.id,JSON.stringify(payment),paymentIntentId,JSON.stringify(history)]);
  return toOrder(updated.rows[0]);
}); }

export async function markPaymentFailed(orderId){ return withTransaction(async client=>{ const {rows}=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId]); const row=rows[0]; if(!row||row.status!=='pending_payment') return toOrder(row); for(const i of row.items||[]) await adjustStock(i.productId,i.quantity,client); const history=[...(row.status_history||[]),{status:'cancelled',at:new Date().toISOString(),reason:'payment_failed'}]; const updated=await client.query(`UPDATE orders SET status='cancelled',status_history=$2 WHERE id=$1 RETURNING *`,[orderId,JSON.stringify(history)]); return toOrder(updated.rows[0]); }); }

export async function markRefunded(paymentIntentId){ const {rows}=await pool.query(`UPDATE orders SET status='refunded',refunded_at=now(),payment=jsonb_set(payment,'{status}','"refunded"') WHERE payment_intent_id=$1 RETURNING *`,[paymentIntentId]); return toOrder(rows[0]); }
export async function getOrderByPaymentSession(sessionId){const {rows}=await pool.query('SELECT * FROM orders WHERE payment_session_id=$1',[sessionId]);return toOrder(rows[0]);}
export async function getOrdersByUser(userId){const {rows}=await pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC',[userId]);return rows.map(toOrder);}
export async function getOrderById(id){const {rows}=await pool.query('SELECT * FROM orders WHERE id::text=$1 OR order_number=$1',[id]);return toOrder(rows[0]);}
export async function getAllOrders(){const {rows}=await pool.query('SELECT * FROM orders ORDER BY created_at DESC');return rows.map(toOrder);}
export async function updateOrderStatus(id,status){const now=new Date().toISOString();const {rows}=await pool.query(`UPDATE orders SET status=$2,status_history=status_history||$3::jsonb WHERE id::text=$1 OR order_number=$1 RETURNING *`,[id,status,JSON.stringify([{status,at:now}])]);return toOrder(rows[0]);}
export async function countOrders(){const {rows}=await pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE status<>\'pending_payment\'');return rows[0].n;}
export async function getTotalRevenue(){const {rows}=await pool.query("SELECT COALESCE(SUM((summary->>'total')::numeric),0) total FROM orders WHERE status NOT IN ('pending_payment','cancelled')");return Number(rows[0].total);}
export async function getOrdersByStatusCounts(){const {rows}=await pool.query('SELECT status,COUNT(*)::int n FROM orders GROUP BY status');return Object.fromEntries(rows.map(r=>[r.status,r.n]));}
export async function getRevenueByDay(){const {rows}=await pool.query("SELECT to_char(created_at,'YYYY-MM-DD') AS day,SUM((summary->>'total')::numeric) total FROM orders WHERE status NOT IN ('pending_payment','cancelled') GROUP BY day ORDER BY day");return Object.fromEntries(rows.map(r=>[r.day,Number(r.total)]));}
export async function getTopProducts(limit=5){const {rows}=await pool.query(`SELECT item->>'productId' product_id,item->>'title' title,SUM((item->>'quantity')::int) qty,SUM((item->>'quantity')::int*(item->>'unitPrice')::numeric) revenue FROM orders,jsonb_array_elements(items) item WHERE status NOT IN ('pending_payment','cancelled') GROUP BY product_id,title ORDER BY revenue DESC LIMIT $1`,[limit]);return rows.map(r=>({title:r.title,qty:Number(r.qty),revenue:Number(r.revenue)}));}
export async function getRecentOrders(limit=8){const {rows}=await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT $1',[limit]);return rows.map(toOrder);}
