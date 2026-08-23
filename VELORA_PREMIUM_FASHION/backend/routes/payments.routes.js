import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { z } from 'zod';
import * as orders from '../db/repositories/orders.repo.js';
import * as coupons from '../db/repositories/coupons.repo.js';
import * as settings from '../db/repositories/settings.repo.js';
import { createCheckoutSession, constructWebhookEvent, refundPayment } from '../services/payment.service.js';
import { sendOrderConfirmationEmail, sendRefundEmail } from '../services/email.service.js';
import { pool, withTransaction } from '../db/pool.js';

const router=Router();
const checkoutSchema=z.object({items:z.array(z.object({productId:z.string().min(1).max(200),quantity:z.coerce.number().int().min(1).max(1000)})).min(1).max(100),shippingAddress:z.string().trim().min(5).max(1000),couponCode:z.string().trim().max(50).optional()});

router.post('/payments/checkout',requireAuth,validateBody(checkoutSchema),async(req,res)=>{
  try{
    const store=await settings.getSettings();
    if(String(store.currency).toUpperCase()!=='INR') return res.status(400).json({message:'Stripe checkout is currently configured for INR only.'});
    const order=await orders.createPendingOrder({user:{id:req.user.sub,name:req.user.name,email:req.user.email},...req.body,settings:store,paymentProvider:'stripe'});
    let session;
    try{session=await createCheckoutSession({order,settings:store});}
    catch(e){await orders.markPaymentFailed(order.id);throw e;}
    await orders.attachPaymentSession(order.id,session.id);
    res.status(201).json({checkoutUrl:session.url,orderId:order.id,orderNumber:order.orderNumber,summary:order.summary});
  }catch(e){res.status(e.status||400).json({message:e.message||'Unable to start payment.'});}
});

router.post('/payments/webhook',async(req,res)=>{
  try{
    const event=constructWebhookEvent(req.body,req.get('stripe-signature'));
    const already=await pool.query('SELECT 1 FROM payment_events WHERE event_id=$1',[event.id]);
    if(already.rowCount){return res.json({received:true,duplicate:true});}
    if(event.type==='checkout.session.completed'){
      const s=event.data.object; const order=await orders.confirmPaidOrder({orderId:s.metadata?.orderId,sessionId:s.id,paymentIntentId:s.payment_intent});
      if(order) sendOrderConfirmationEmail(order).catch(console.error);
    }else if(event.type==='checkout.session.expired'){
      if(event.data.object.metadata?.orderId) await orders.markPaymentFailed(event.data.object.metadata.orderId);
    }else if(event.type==='payment_intent.payment_failed'){
      if(event.data.object.metadata?.orderId) await orders.markPaymentFailed(event.data.object.metadata.orderId);
    }else if(event.type==='charge.refunded'){
      const pi=event.data.object.payment_intent; if(pi) {const order=await orders.markRefunded(pi); if(order) sendRefundEmail(order).catch(console.error);}
    }
    await pool.query('INSERT INTO payment_events(event_id,event_type) VALUES($1,$2)',[event.id,event.type]);
    res.json({received:true});
  }catch(e){console.error('Stripe webhook:',e.message);res.status(400).send('Webhook Error');}
});

router.post('/payments/refund/:id',requireAuth,requireAdmin,validateBody(z.object({amount:z.coerce.number().positive().optional()})),async(req,res)=>{
  const order=await orders.getOrderById(req.params.id); if(!order) return res.status(404).json({message:'Order not found.'});
  if(!order.paymentIntentId||order.payment?.status!=='paid') return res.status(400).json({message:'This order has no refundable paid Stripe payment.'});
  try{const refund=await refundPayment(order.paymentIntentId,req.body.amount);res.json({refundId:refund.id,status:refund.status});}catch(e){res.status(e.statusCode||400).json({message:e.message});}
});
export default router;
