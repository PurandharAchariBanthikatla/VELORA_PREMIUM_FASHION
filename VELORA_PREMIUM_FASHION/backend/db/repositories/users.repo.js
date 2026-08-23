import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../pool.js";

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    phone: row.phone,
    addresses: row.addresses || [],
    wishlist: row.wishlist || [],
    cart: row.cart || [],
    refreshTokenHash: row.refresh_token_hash,
    resetTokenHash: row.reset_token_hash,
    resetTokenExpires: row.reset_token_expires,
    createdAt: row.created_at
  };
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, refreshTokenHash, resetTokenHash, resetTokenExpires, ...rest } = user;
  return rest;
}

export async function getUserById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return toUser(rows[0]);
}

export async function getUserByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [String(email).toLowerCase()]);
  return toUser(rows[0]);
}

export async function createUser({ name, email, password, role = "customer" }) {
  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, name, String(email).toLowerCase(), passwordHash, role]
  );
  return toUser(rows[0]);
}

export async function updateProfile(id, { name, phone, address }) {
  const { rows } = await pool.query(
    `UPDATE users SET
       name = COALESCE($2, name),
       phone = COALESCE($3, phone),
       addresses = CASE WHEN $4::text IS NOT NULL THEN to_jsonb(ARRAY[$4::text]) ELSE addresses END
     WHERE id = $1
     RETURNING *`,
    [id, name ?? null, phone ?? null, address ?? null]
  );
  return toUser(rows[0]);
}

export async function updatePassword(id, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    `UPDATE users SET password_hash = $2, refresh_token_hash = NULL WHERE id = $1`,
    [id, passwordHash]
  );
}

export async function verifyPassword(user, password) {
  return bcrypt.compare(String(password || ""), user.passwordHash);
}

export async function setRefreshTokenHash(id, hash) {
  await pool.query("UPDATE users SET refresh_token_hash = $2 WHERE id = $1", [id, hash]);
}

export async function clearRefreshTokenHash(id) {
  await pool.query("UPDATE users SET refresh_token_hash = NULL WHERE id = $1", [id]);
}

export async function setResetToken(id, tokenHash, expires) {
  await pool.query(
    "UPDATE users SET reset_token_hash = $2, reset_token_expires = $3 WHERE id = $1",
    [id, tokenHash, expires]
  );
}

export async function clearResetToken(id) {
  await pool.query("UPDATE users SET reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $1", [id]);
}

export async function getCart(id) {
  const { rows } = await pool.query("SELECT cart FROM users WHERE id = $1", [id]);
  return rows[0]?.cart || [];
}

export async function setCart(id, cart) {
  await pool.query("UPDATE users SET cart = $2 WHERE id = $1", [id, JSON.stringify(cart)]);
}

// ---- Saved addresses ----
// Stored as a JSONB array of structured objects on the same `addresses`
// column that used to hold plain strings. Older accounts with legacy
// string entries are normalized to objects on read so nothing breaks.
function normalizeAddress(raw) {
  if (typeof raw === "string") {
    return { id: crypto.randomUUID(), label: "Address", line1: raw, line2: "", city: "", state: "", pincode: "", phone: "", isDefault: false };
  }
  return {
    id: raw.id || crypto.randomUUID(),
    label: raw.label || "Address",
    line1: raw.line1 || "",
    line2: raw.line2 || "",
    city: raw.city || "",
    state: raw.state || "",
    pincode: raw.pincode || "",
    phone: raw.phone || "",
    isDefault: Boolean(raw.isDefault)
  };
}

export async function getAddresses(id) {
  const { rows } = await pool.query("SELECT addresses FROM users WHERE id = $1", [id]);
  return (rows[0]?.addresses || []).map(normalizeAddress);
}

async function saveAddresses(id, addresses) {
  const { rows } = await pool.query(
    "UPDATE users SET addresses = $2 WHERE id = $1 RETURNING addresses",
    [id, JSON.stringify(addresses)]
  );
  return (rows[0]?.addresses || []).map(normalizeAddress);
}

export async function addAddress(id, input) {
  const addresses = (await getAddresses(id));
  const next = normalizeAddress({ ...input, id: crypto.randomUUID() });
  if (next.isDefault || addresses.length === 0) {
    addresses.forEach((a) => (a.isDefault = false));
    next.isDefault = true;
  }
  addresses.push(next);
  return saveAddresses(id, addresses);
}

export async function updateAddress(id, addressId, input) {
  const addresses = await getAddresses(id);
  const index = addresses.findIndex((a) => a.id === addressId);
  if (index === -1) return null;
  if (input.isDefault) addresses.forEach((a) => (a.isDefault = false));
  addresses[index] = normalizeAddress({ ...addresses[index], ...input, id: addressId });
  return saveAddresses(id, addresses);
}

export async function deleteAddress(id, addressId) {
  const addresses = await getAddresses(id);
  const next = addresses.filter((a) => a.id !== addressId);
  if (next.length > 0 && !next.some((a) => a.isDefault)) next[0].isDefault = true;
  return saveAddresses(id, next);
}

export async function setDefaultAddress(id, addressId) {
  const addresses = await getAddresses(id);
  addresses.forEach((a) => (a.isDefault = a.id === addressId));
  return saveAddresses(id, addresses);
}

export async function getWishlist(id) {
  const { rows } = await pool.query("SELECT wishlist FROM users WHERE id = $1", [id]);
  return rows[0]?.wishlist || [];
}

export async function setWishlist(id, wishlist) {
  await pool.query("UPDATE users SET wishlist = $2 WHERE id = $1", [id, JSON.stringify(wishlist)]);
}

export async function listCustomersWithStats() {
  const { rows } = await pool.query(`
    SELECT
      u.id, u.name, u.email, u.phone, u.created_at,
      COUNT(o.id)::int AS order_count,
      COALESCE(SUM((o.summary->>'total')::numeric), 0) AS total_spent
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    WHERE u.role = 'customer'
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    createdAt: r.created_at,
    orderCount: r.order_count,
    totalSpent: Number(r.total_spent)
  }));
}

export async function countCustomers() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'customer'");
  return rows[0].n;
}

export async function ensureSeedAdmin() {
  const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length > 0) return;

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash("Admin@123", 10);
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ($1, 'Store Admin', 'admin@velora.com', $2, 'admin')`,
    [id, passwordHash]
  );
  console.log("Seeded default admin account: admin@velora.com / Admin@123");
}
