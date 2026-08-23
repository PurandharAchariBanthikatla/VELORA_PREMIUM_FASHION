import { Router } from "express";
import * as coupons from "../db/repositories/coupons.repo.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Lets the storefront check a coupon code against the current bag subtotal
// before checkout. The order-creation route re-validates it as the final
// source of truth, the same pattern used for stock validation.
router.post("/coupons/validate", asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body || {};
  if (!code) {
    res.status(400).json({ valid: false, reason: "Please enter a coupon code." });
    return;
  }
  const result = await coupons.validateCoupon(code, Number(subtotal) || 0);
  res.json(result);
}));

export default router;
