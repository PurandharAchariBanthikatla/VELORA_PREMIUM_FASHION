import { Router } from "express";
import * as products from "../db/repositories/products.repo.js";
import * as orders from "../db/repositories/orders.repo.js";
import * as users from "../db/repositories/users.repo.js";
import * as audit from "../db/repositories/audit.repo.js";
import * as coupons from "../db/repositories/coupons.repo.js";
import * as settingsRepo from "../db/repositories/settings.repo.js";
import * as reviewsRepo from "../db/repositories/reviews.repo.js";
import * as returnsRepo from "../db/repositories/returns.repo.js";
import * as support from "../db/repositories/support.repo.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { uploadProductImage, storeUploadedProductImage } from "../services/upload.service.js";
import { sendOrderStatusEmail, sendReturnStatusEmail, sendSupportReplyEmail } from "../services/email.service.js";
import { refundPayment } from "../services/payment.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { z } from "zod";

const router = Router();

router.use(requireAuth, requireAdmin);

// ---- Dashboard stats ----
router.get("/stats", asyncHandler(async (_req, res) => {
  const [
    totalRevenue, totalOrders, totalCustomers, totalProducts, lowStock,
    ordersByStatus, revenueByDay, topProducts, recentOrders, recentActivity, activeCoupons
  ] = await Promise.all([
    orders.getTotalRevenue(),
    orders.countOrders(),
    users.countCustomers(),
    products.countProducts(),
    products.countLowStock(),
    orders.getOrdersByStatusCounts(),
    orders.getRevenueByDay(),
    orders.getTopProducts(),
    orders.getRecentOrders(),
    audit.getRecentAudit(8),
    coupons.countActiveCoupons()
  ]);

  res.json({
    totalRevenue, totalOrders, totalCustomers, totalProducts, lowStock,
    ordersByStatus, revenueByDay, topProducts, recentOrders, recentActivity, activeCoupons
  });
}));

// ---- Product management ----
router.get("/products", asyncHandler(async (req, res) => {
  const { search, page, pageSize } = req.query;
  const result = await products.getProductsPage({ search, page, pageSize });
  res.json(result);
}));

router.post("/products", asyncHandler(async (req, res) => {
  const product = await products.createProduct(req.body || {});
  await audit.logAudit({
    action: "create",
    entity: "product",
    entityId: product.id,
    summary: `Created product "${product.title}"`,
    adminId: req.user.sub,
    adminName: req.user.name
  });
  res.status(201).json({ product });
}));

router.put("/products/:id", asyncHandler(async (req, res) => {
  const product = await products.updateProduct(req.params.id, req.body || {});
  if (!product) {
    res.status(404).json({ message: "Product not found." });
    return;
  }
  await audit.logAudit({
    action: "update",
    entity: "product",
    entityId: product.id,
    summary: `Updated product "${product.title}"`,
    adminId: req.user.sub,
    adminName: req.user.name
  });
  res.json({ product });
}));

router.delete("/products/:id", asyncHandler(async (req, res) => {
  const existing = await products.getProductById(req.params.id);
  const ok = await products.deleteProduct(req.params.id);
  if (!ok) {
    res.status(404).json({ message: "Product not found." });
    return;
  }
  await audit.logAudit({
    action: "delete",
    entity: "product",
    entityId: req.params.id,
    summary: `Deleted product "${existing?.title || req.params.id}"`,
    adminId: req.user.sub,
    adminName: req.user.name
  });
  res.status(204).end();
}));

// ---- Image upload ----
router.post("/upload", (req, res) => {
  uploadProductImage(req, res, (error) => {
    if (error) {
      res.status(400).json({ message: error.message || "Upload failed." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ message: "No image file was provided." });
      return;
    }
    storeUploadedProductImage(req.file).then(url => res.status(201).json({ url })).catch(error => res.status(error.status || 500).json({ message: error.message || 'Storage upload failed.' }));
  });
});

// ---- Order management ----
router.get("/orders", asyncHandler(async (_req, res) => {
  res.json({ orders: await orders.getAllOrders() });
}));

const VALID_STATUSES = ["confirmed", "processing", "shipped", "delivered", "cancelled"];

router.put("/orders/:id/status", asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ message: `Status must be one of: ${VALID_STATUSES.join(", ")}` });
    return;
  }

  const order = await orders.updateOrderStatus(req.params.id, status);
  if (!order) {
    res.status(404).json({ message: "Order not found." });
    return;
  }

  await audit.logAudit({
    action: "status-update",
    entity: "order",
    entityId: order.orderNumber,
    summary: `Order ${order.orderNumber} marked as "${status}"`,
    adminId: req.user.sub,
    adminName: req.user.name
  });

  sendOrderStatusEmail(order).catch((error) => console.error("Order status email failed:", error.message));

  res.json({ order });
}));

// ---- Customers ----
router.get("/users", asyncHandler(async (_req, res) => {
  res.json({ users: await users.listCustomersWithStats() });
}));

// ---- Audit log ----
router.get("/audit", asyncHandler(async (_req, res) => {
  res.json({ audit: await audit.getRecentAudit(100) });
}));

// ---- Categories (derived from the live product catalog — no separate
// table to keep in sync; renaming/merging is done by bulk-editing products) ----
router.get("/categories", asyncHandler(async (_req, res) => {
  const all = await products.getAllProducts();
  const map = new Map();
  all.forEach((p) => {
    const key = p.category || "Uncategorized";
    if (!map.has(key)) map.set(key, { name: key, productCount: 0, totalStock: 0, genders: new Set() });
    const entry = map.get(key);
    entry.productCount += 1;
    entry.totalStock += Number(p.stock) || 0;
    entry.genders.add(p.gender || "Unisex");
  });
  const categories = [...map.values()]
    .map((c) => ({ ...c, genders: [...c.genders] }))
    .sort((a, b) => b.productCount - a.productCount);
  res.json({ categories });
}));

// ---- Inventory (same product table, stock-focused view + quick update) ----
router.get("/inventory", asyncHandler(async (req, res) => {
  const all = await products.getAllProducts();
  const { search, stockFilter } = req.query;
  let list = all;
  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter((p) => p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }
  if (stockFilter === "low") list = list.filter((p) => p.stock > 0 && p.stock <= 5);
  if (stockFilter === "out") list = list.filter((p) => p.stock <= 0);
  res.json({
    products: list.map((p) => ({ id: p.id, title: p.title, image: p.image, category: p.category, stock: p.stock })),
    lowStock: all.filter((p) => p.stock > 0 && p.stock <= 5).length,
    outOfStock: all.filter((p) => p.stock <= 0).length,
    totalUnits: all.reduce((n, p) => n + (Number(p.stock) || 0), 0)
  });
}));

router.put("/inventory/:id/stock", asyncHandler(async (req, res) => {
  const { stock } = req.body || {};
  if (!Number.isFinite(Number(stock)) || Number(stock) < 0) {
    res.status(400).json({ message: "Stock must be a non-negative number." });
    return;
  }
  const product = await products.updateProduct(req.params.id, { stock: Number(stock) });
  if (!product) {
    res.status(404).json({ message: "Product not found." });
    return;
  }
  await audit.logAudit({
    action: "update",
    entity: "inventory",
    entityId: product.id,
    summary: `Set stock for "${product.title}" to ${product.stock}`,
    adminId: req.user.sub,
    adminName: req.user.name
  });
  res.json({ product });
}));

// ---- Coupons ----
router.get("/coupons", asyncHandler(async (_req, res) => {
  res.json({ coupons: await coupons.listCoupons() });
}));

router.post("/coupons", asyncHandler(async (req, res) => {
  if (!req.body?.code) {
    res.status(400).json({ message: "Coupon code is required." });
    return;
  }
  try {
    const coupon = await coupons.createCoupon(req.body);
    await audit.logAudit({
      action: "create", entity: "coupon", entityId: coupon.code,
      summary: `Created coupon "${coupon.code}"`, adminId: req.user.sub, adminName: req.user.name
    });
    res.status(201).json({ coupon });
  } catch (error) {
    res.status(409).json({ message: error.code === "23505" ? "That coupon code already exists." : error.message });
  }
}));

router.put("/coupons/:id", asyncHandler(async (req, res) => {
  const coupon = await coupons.updateCoupon(req.params.id, req.body || {});
  if (!coupon) {
    res.status(404).json({ message: "Coupon not found." });
    return;
  }
  await audit.logAudit({
    action: "update", entity: "coupon", entityId: coupon.code,
    summary: `Updated coupon "${coupon.code}"`, adminId: req.user.sub, adminName: req.user.name
  });
  res.json({ coupon });
}));

router.delete("/coupons/:id", asyncHandler(async (req, res) => {
  const ok = await coupons.deleteCoupon(req.params.id);
  if (!ok) {
    res.status(404).json({ message: "Coupon not found." });
    return;
  }
  await audit.logAudit({
    action: "delete", entity: "coupon", entityId: req.params.id,
    summary: "Deleted a coupon", adminId: req.user.sub, adminName: req.user.name
  });
  res.status(204).end();
}));

// ---- Store settings ----
router.get("/settings", asyncHandler(async (_req, res) => {
  res.json({ settings: await settingsRepo.getSettings() });
}));

router.put("/settings", asyncHandler(async (req, res) => {
  const settings = await settingsRepo.updateSettings(req.body || {});
  await audit.logAudit({
    action: "update", entity: "settings", entityId: "store",
    summary: "Updated store settings", adminId: req.user.sub, adminName: req.user.name
  });
  res.json({ settings });
}));

// ---- Reviews moderation ----
router.get("/reviews", asyncHandler(async (req, res) => {
  res.json({ reviews: await reviewsRepo.listAllReviews({ status: req.query.status || undefined }) });
}));

router.put("/reviews/:id", asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!["published", "hidden"].includes(status)) {
    res.status(400).json({ message: 'Status must be "published" or "hidden".' });
    return;
  }
  const review = await reviewsRepo.setReviewStatus(req.params.id, status);
  if (!review) { res.status(404).json({ message: "Review not found." }); return; }
  await audit.logAudit({ action: "update", entity: "review", entityId: review.id, summary: `Set review to "${status}"`, adminId: req.user.sub, adminName: req.user.name });
  res.json({ review });
}));

router.delete("/reviews/:id", asyncHandler(async (req, res) => {
  const ok = await reviewsRepo.deleteReview(req.params.id);
  if (!ok) { res.status(404).json({ message: "Review not found." }); return; }
  await audit.logAudit({ action: "delete", entity: "review", entityId: req.params.id, summary: "Deleted a review", adminId: req.user.sub, adminName: req.user.name });
  res.status(204).end();
}));

// ---- Returns / refunds ----
router.get("/returns", asyncHandler(async (req, res) => {
  res.json({ returns: await returnsRepo.listAllReturns({ status: req.query.status || undefined }) });
}));

const resolveReturnSchema = z.object({
  status: z.enum(["approved", "rejected", "refunded"]),
  refundAmount: z.coerce.number().positive().optional(),
  adminNote: z.string().trim().max(1000).optional()
});

router.put("/returns/:id", validateBody(resolveReturnSchema), asyncHandler(async (req, res) => {
  const existing = await returnsRepo.getReturnById(req.params.id);
  if (!existing) { res.status(404).json({ message: "Return request not found." }); return; }

  let refundAmount = req.body.refundAmount;
  // "refunded" actually calls Stripe — the order must have a paid,
  // refundable payment intent. Approving without refunding (e.g. an
  // exchange instead of a refund) is a separate status that skips Stripe.
  if (req.body.status === "refunded") {
    const order = await orders.getOrderById(existing.orderId);
    if (!order?.paymentIntentId || order.payment?.status !== "paid") {
      res.status(400).json({ message: "This order has no refundable paid payment to refund against." });
      return;
    }
    try {
      const refund = await refundPayment(order.paymentIntentId, refundAmount);
      refundAmount = refundAmount ?? (refund.amount ? refund.amount / 100 : undefined);
    } catch (error) {
      res.status(error.statusCode || 400).json({ message: `Stripe refund failed: ${error.message}` });
      return;
    }
  }

  const updated = await returnsRepo.updateReturnStatus(req.params.id, { status: req.body.status, refundAmount, adminNote: req.body.adminNote });
  const order = await orders.getOrderById(updated.orderId);
  if (order) sendReturnStatusEmail(order, updated).catch((error) => console.error("Return status email failed:", error.message));

  await audit.logAudit({ action: "update", entity: "return", entityId: updated.id, summary: `Return for "${updated.productTitle}" set to "${updated.status}"`, adminId: req.user.sub, adminName: req.user.name });
  res.json({ return: updated });
}));

// ---- Support tickets ----
router.get("/support", asyncHandler(async (req, res) => {
  res.json({ tickets: await support.listAllTickets({ status: req.query.status || undefined }) });
}));

router.get("/support/:id", asyncHandler(async (req, res) => {
  const result = await support.getTicketWithMessages(req.params.id);
  if (!result) { res.status(404).json({ message: "Ticket not found." }); return; }
  res.json(result);
}));

router.post("/support/:id/messages", validateBody(z.object({ body: z.string().trim().min(1).max(4000) })), asyncHandler(async (req, res) => {
  const message = await support.addMessage(req.params.id, { senderRole: "admin", senderName: req.user.name, body: req.body.body });
  if (!message) { res.status(404).json({ message: "Ticket not found." }); return; }
  const result = await support.getTicketWithMessages(req.params.id);
  const customer = await users.getUserById(result.ticket.userId);
  if (customer) sendSupportReplyEmail(customer, result.ticket).catch((error) => console.error("Support reply email failed:", error.message));
  res.status(201).json({ message });
}));

router.put("/support/:id/status", validateBody(z.object({ status: z.enum(["open", "pending", "closed"]) })), asyncHandler(async (req, res) => {
  const ticket = await support.setTicketStatus(req.params.id, req.body.status);
  if (!ticket) { res.status(404).json({ message: "Ticket not found." }); return; }
  res.json({ ticket });
}));

export default router;
