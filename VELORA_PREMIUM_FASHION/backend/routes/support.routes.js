import { Router } from 'express';
import * as support from '../db/repositories/support.repo.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { z } from 'zod';

const router = Router();

const createSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(1).max(4000),
  orderId: z.string().trim().max(200).optional()
});
const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

function loadOwnTicket() {
  return asyncHandler(async (req, res, next) => {
    const result = await support.getTicketWithMessages(req.params.id);
    if (!result || (result.ticket.userId !== req.user.sub && req.user.role !== 'admin')) {
      res.status(404).json({ message: 'Support ticket not found.' });
      return;
    }
    req.ticketResult = result;
    next();
  });
}

router.post('/', requireAuth, validateBody(createSchema), asyncHandler(async (req, res) => {
  const ticket = await support.createTicket({
    userId: req.user.sub,
    subject: req.body.subject,
    orderId: req.body.orderId || null,
    senderName: req.user.name,
    body: req.body.body
  });
  res.status(201).json({ ticket });
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json({ tickets: await support.getTicketsByUser(req.user.sub) });
}));

router.get('/:id', requireAuth, loadOwnTicket(), asyncHandler(async (req, res) => {
  res.json(req.ticketResult);
}));

router.post('/:id/messages', requireAuth, loadOwnTicket(), validateBody(messageSchema), asyncHandler(async (req, res) => {
  const message = await support.addMessage(req.params.id, { senderRole: req.user.role === 'admin' ? 'admin' : 'customer', senderName: req.user.name, body: req.body.body });
  res.status(201).json({ message });
}));

export default router;
