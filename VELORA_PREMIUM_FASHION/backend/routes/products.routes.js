import { Router } from "express";
import * as products from "../db/repositories/products.repo.js";
import * as reviews from "../db/repositories/reviews.repo.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { publicCache } from "../middleware/cache.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { z } from "zod";

const router = Router();

router.get("/health", asyncHandler(async (_req, res) => {
  const count = await products.countProducts();
  res.json({ ok: true, products: count, uptime: Math.round(process.uptime()) });
}));

router.get("/products", publicCache(30), asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const category = String(req.query.category || "").trim().toLowerCase();
  const sort = String(req.query.sort || "featured");
  const limit = Number(req.query.limit || 0);

  const result = await products.searchProducts({ search, category, sort, limit });
  res.json({ count: result.length, products: result });
}));

router.get("/products/:id", publicCache(30), asyncHandler(async (req, res) => {
  const product = await products.getProductById(req.params.id);
  if (!product) {
    res.status(404).json({ message: "Product not found" });
    return;
  }
  // Blend in the real, review-derived rating once at least one published
  // review exists — otherwise keep the catalog's seeded static rating so
  // brand-new products (with zero reviews) don't show "0 stars".
  const summary = await reviews.getRatingSummary(product.id);
  if (summary.count > 0) { product.rating = summary.average; product.reviewCount = summary.count; }
  res.json(product);
}));

router.get("/categories", publicCache(120), asyncHandler(async (_req, res) => {
  const result = await products.getCategoriesAndGenders();
  res.json(result);
}));

// Lets the frontend check stock for the current bag before checkout, so a
// customer sees "only 2 left" instead of finding out at the payment step.
// The order-creation route still re-validates this itself as the final
// source of truth.
router.post("/cart/validate", asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const result = await products.validateCartItems(items);
  res.json(result);
}));

// ---- Reviews ----
const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).default(""),
  body: z.string().trim().min(1).max(2000)
});

router.get("/products/:id/reviews", publicCache(30), asyncHandler(async (req, res) => {
  const list = await reviews.getReviewsForProduct(req.params.id);
  const summary = await reviews.getRatingSummary(req.params.id);
  res.json({ reviews: list, summary });
}));

// Tells the frontend whether to show a "Write a review" button for this
// product on this account, without leaking *which* order made them
// eligible (that's resolved server-side again on the actual POST).
router.get("/products/:id/reviews/eligibility", requireAuth, asyncHandler(async (req, res) => {
  const orderId = await reviews.findEligibleOrderForReview(req.user.sub, req.params.id);
  res.json({ eligible: Boolean(orderId) });
}));

router.post("/products/:id/reviews", requireAuth, validateBody(reviewSchema), asyncHandler(async (req, res) => {
  const orderId = await reviews.findEligibleOrderForReview(req.user.sub, req.params.id);
  if (!orderId) {
    res.status(403).json({ message: "You can only review products from a delivered order, once per purchase." });
    return;
  }
  const review = await reviews.createReview({ productId: req.params.id, userId: req.user.sub, orderId, ...req.body });
  res.status(201).json({ review });
}));

export default router;
