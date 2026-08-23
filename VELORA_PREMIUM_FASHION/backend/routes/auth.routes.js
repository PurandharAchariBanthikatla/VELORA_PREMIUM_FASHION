import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import * as users from "../db/repositories/users.repo.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken, tokensMatch } from "../utils/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import { sendPasswordResetEmail } from "../services/email.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validateBody, email as emailSchema, strongPassword } from '../middleware/validate.js';
import { revokeAccessToken } from '../services/redis.service.js';
import { z } from 'zod';

// req.user is the already-verified JWT payload (has jti + exp). Revoking it
// immediately closes the window where a logged-out or just-rotated access
// token would otherwise stay usable until it naturally expires (~15 min).
function revokeCurrentToken(req) {
  const ttl = req.user?.exp ? req.user.exp - Math.floor(Date.now() / 1000) : 0;
  return revokeAccessToken(req.user?.jti, ttl);
}

const router = Router();
const registerSchema=z.object({name:z.string().trim().min(2).max(100),email:emailSchema,password:strongPassword});
const loginSchema=z.object({email:emailSchema,password:z.string().min(1).max(128)});
const resetSchema=z.object({email:emailSchema,token:z.string().min(20).max(200),newPassword:strongPassword});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await users.setRefreshTokenHash(user.id, hashToken(refreshToken));
  return { accessToken, refreshToken };
}

router.post("/register", validateBody(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !isValidEmail(email) || !password || String(password).length < 6) {
    res.status(400).json({ message: "Please provide a valid name, email and a password of at least 6 characters." });
    return;
  }

  const existing = await users.getUserByEmail(email);
  if (existing) {
    res.status(409).json({ message: "This email is already registered." });
    return;
  }

  const user = await users.createUser({ name: String(name).trim(), email, password });
  const { accessToken, refreshToken } = await issueTokens(user);
  res.status(201).json({ token: accessToken, refreshToken, user: users.publicUser(user) });
}));

router.post("/login", validateBody(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await users.getUserByEmail(email || "");

  if (!user || !(await users.verifyPassword(user, password))) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  const { accessToken, refreshToken } = await issueTokens(user);
  res.json({ token: accessToken, refreshToken, user: users.publicUser(user) });
}));

// Exchanges a valid refresh token for a new access token (and rotates the refresh token).
router.post("/refresh", asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    res.status(400).json({ message: "Refresh token is required." });
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    res.status(401).json({ message: "Refresh token is invalid or has expired. Please sign in again." });
    return;
  }

  const user = await users.getUserById(payload.sub);
  if (!user || !user.refreshTokenHash || !tokensMatch(refreshToken, user.refreshTokenHash)) {
    res.status(401).json({ message: "Session no longer valid. Please sign in again." });
    return;
  }

  const { accessToken, refreshToken: newRefreshToken } = await issueTokens(user);
  res.json({ token: accessToken, refreshToken: newRefreshToken, user: users.publicUser(user) });
}));

router.post("/logout", requireAuth, asyncHandler(async (req, res) => {
  await users.clearRefreshTokenHash(req.user.sub);
  await revokeCurrentToken(req);
  res.json({ message: "Signed out." });
}));

router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await users.getUserById(req.user.sub);
  if (!user) {
    res.status(404).json({ message: "User not found." });
    return;
  }
  res.json({ user: users.publicUser(user) });
}));

router.put("/me", requireAuth, asyncHandler(async (req, res) => {
  const { name, phone, address } = req.body || {};
  const user = await users.updateProfile(req.user.sub, {
    name: name ? String(name).trim() : undefined,
    phone: phone !== undefined ? String(phone).trim() : undefined,
    address: address !== undefined ? String(address).trim() : undefined
  });
  if (!user) {
    res.status(404).json({ message: "User not found." });
    return;
  }
  res.json({ user: users.publicUser(user) });
}));

// Self-service password change for a signed-in user.
router.put("/password", requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    res.status(400).json({ message: "New password must be at least 6 characters." });
    return;
  }

  const user = await users.getUserById(req.user.sub);
  if (!user) {
    res.status(404).json({ message: "User not found." });
    return;
  }

  if (!(await users.verifyPassword(user, currentPassword))) {
    res.status(401).json({ message: "Current password is incorrect." });
    return;
  }

  await users.updatePassword(user.id, newPassword); // also clears refreshTokenHash
  await revokeCurrentToken(req);
  const { accessToken, refreshToken } = await issueTokens(user);
  res.json({ message: "Password updated.", token: accessToken, refreshToken });
}));

// Request a password reset. Always returns a generic 200 message so this
// endpoint can't be used to enumerate which emails are registered.
router.post("/forgot-password", validateBody(z.object({email:emailSchema})), asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  const user = await users.getUserByEmail(email || "");

  const genericResponse = { message: "If that email is registered, a password reset link has been sent." };

  if (!user) {
    res.json(genericResponse);
    return;
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await users.setResetToken(user.id, tokenHash, expires);

  const origin = req.headers.origin || `${req.protocol}://${req.get("host")}`;
  const resetLink = `${origin}/reset-password.html?email=${encodeURIComponent(user.email)}&token=${rawToken}`;
  await sendPasswordResetEmail(user.email, resetLink);

  // In non-production environments, echo the token back so the flow can be
  // tested end-to-end without configuring a real SMTP server.
  if (process.env.NODE_ENV !== "production") {
    res.json({ ...genericResponse, devResetToken: rawToken, devResetLink: resetLink });
    return;
  }

  res.json(genericResponse);
}));

router.post("/reset-password", validateBody(resetSchema), asyncHandler(async (req, res) => {
  const { email, token, newPassword } = req.body || {};
  if (!email || !token || !newPassword || String(newPassword).length < 6) {
    res.status(400).json({ message: "Email, token, and a new password (6+ characters) are required." });
    return;
  }

  const user = await users.getUserByEmail(email);
  const invalid = () => res.status(400).json({ message: "This reset link is invalid or has expired." });

  if (!user || !user.resetTokenHash || !user.resetTokenExpires) {
    invalid();
    return;
  }

  if (new Date(user.resetTokenExpires).getTime() < Date.now()) {
    await users.clearResetToken(user.id);
    invalid();
    return;
  }

  const matches = await bcrypt.compare(String(token), user.resetTokenHash);
  if (!matches) {
    invalid();
    return;
  }

  await users.updatePassword(user.id, newPassword); // also clears refreshTokenHash
  await users.clearResetToken(user.id);

  res.json({ message: "Password reset successfully. Please sign in with your new password." });
}));

export default router;
