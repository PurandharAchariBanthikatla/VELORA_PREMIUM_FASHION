import { Router } from 'express';
import * as ordersRepo from '../db/repositories/orders.repo.js';
import * as returnsRepo from '../db/repositories/returns.repo.js';
import * as settingsRepo from '../db/repositories/settings.repo.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { streamInvoicePdf } from '../services/invoice.service.js';
import { sendReturnStatusEmail } from '../services/email.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { z } from 'zod';

const router = Router();

function loadOwnedOrder(paramName = 'id') {
  return asyncHandler(async (req, res, next) => {
    const order = await ordersRepo.getOrderById(req.params[paramName]);
    if (!order || (order.userId !== req.user.sub && req.user.role !== 'admin')) {
      res.status(404).json({ message: 'Order not found.' });
      return;
    }
    req.order = order;
    next();
  });
}

router.get('/orders', requireAuth, asyncHandler(async (req, res) => res.json({ orders: await ordersRepo.getOrdersByUser(req.user.sub) })));
router.get('/orders/:id', requireAuth, loadOwnedOrder(), asyncHandler(async (req, res) => res.json({ order: req.order })));

// Invoice PDF — only for orders that have actually been paid, since an
// invoice for an unpaid/pending order isn't a real tax document.
router.get('/orders/:id/invoice', requireAuth, loadOwnedOrder(), asyncHandler(async (req, res) => {
  if (!req.order.paidAt) {
    res.status(400).json({ message: 'An invoice is only available once an order has been paid.' });
    return;
  }
  const settings = await settingsRepo.getSettings();
  streamInvoicePdf(res, { order: req.order, settings });
}));

// ---- Returns / refund requests ----
const returnSchema = z.object({
  productId: z.string().min(1).max(200),
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  reason: z.string().trim().min(1).max(500)
});

router.get('/orders/:id/returns', requireAuth, loadOwnedOrder(), asyncHandler(async (req, res) => {
  res.json({ returns: await returnsRepo.getReturnsByOrder(req.order.id) });
}));

router.post('/orders/:id/returns', requireAuth, loadOwnedOrder(), validateBody(returnSchema), asyncHandler(async (req, res) => {
  const { productId, quantity, reason } = req.body;
  try {
    const item = await returnsRepo.assertReturnEligible(req.order, productId, quantity);
    const created = await returnsRepo.createReturn({ orderId: req.order.id, userId: req.user.sub, productId, productTitle: item.title, quantity, reason });
    sendReturnStatusEmail(req.order, created).catch((error) => console.error('Return-requested email failed:', error.message));
    res.status(201).json({ return: created });
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
  }
}));

router.get('/returns', requireAuth, asyncHandler(async (req, res) => res.json({ returns: await returnsRepo.getReturnsByUser(req.user.sub) })));

export default router;
