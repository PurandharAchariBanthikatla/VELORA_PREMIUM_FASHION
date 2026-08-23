import { Router } from "express";
import * as users from "../db/repositories/users.repo.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/wishlist", requireAuth, asyncHandler(async (req, res) => {
  res.json({ wishlist: await users.getWishlist(req.user.sub) });
}));

router.put("/wishlist", requireAuth, asyncHandler(async (req, res) => {
  const wishlist = Array.isArray(req.body.wishlist) ? req.body.wishlist : [];
  await users.setWishlist(req.user.sub, wishlist);
  res.json({ wishlist });
}));

// Cart is persisted server-side per account so it's the same on every device
// a customer signs into, instead of living only in that browser's localStorage.
router.get("/cart", requireAuth, asyncHandler(async (req, res) => {
  res.json({ cart: await users.getCart(req.user.sub) });
}));

router.put("/cart", requireAuth, asyncHandler(async (req, res) => {
  const cart = (Array.isArray(req.body.cart) ? req.body.cart : [])
    .filter((item) => item && item.id)
    .map((item) => ({ id: String(item.id), qty: Math.max(1, Number(item.qty) || 1) }));
  await users.setCart(req.user.sub, cart);
  res.json({ cart });
}));

// ---- Saved addresses ----
router.get("/addresses", requireAuth, asyncHandler(async (req, res) => {
  res.json({ addresses: await users.getAddresses(req.user.sub) });
}));

router.post("/addresses", requireAuth, asyncHandler(async (req, res) => {
  const addresses = await users.addAddress(req.user.sub, req.body || {});
  res.status(201).json({ addresses });
}));

router.put("/addresses/:addressId", requireAuth, asyncHandler(async (req, res) => {
  const addresses = await users.updateAddress(req.user.sub, req.params.addressId, req.body || {});
  if (!addresses) {
    res.status(404).json({ message: "Address not found." });
    return;
  }
  res.json({ addresses });
}));

router.delete("/addresses/:addressId", requireAuth, asyncHandler(async (req, res) => {
  const addresses = await users.deleteAddress(req.user.sub, req.params.addressId);
  res.json({ addresses });
}));

router.put("/addresses/:addressId/default", requireAuth, asyncHandler(async (req, res) => {
  const addresses = await users.setDefaultAddress(req.user.sub, req.params.addressId);
  res.json({ addresses });
}));

export default router;
