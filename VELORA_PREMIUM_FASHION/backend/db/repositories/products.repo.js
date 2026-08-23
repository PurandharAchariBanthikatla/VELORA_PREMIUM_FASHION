import crypto from "node:crypto";
import { pool } from "../pool.js";

function toProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    brand: row.brand,
    image: row.image,
    color: row.color,
    sellingPrice: Number(row.selling_price),
    mrp: Number(row.mrp),
    discountPercent: row.discount_percent,
    category: row.category,
    gender: row.gender,
    section: row.section,
    description: row.description,
    rating: Number(row.rating),
    stock: row.stock,
    source: row.source,
    createdAt: row.created_at
  };
}

function computeDiscount(sellingPrice, mrp) {
  if (!mrp || mrp <= 0) return 0;
  return Math.max(0, Math.round(100 - (sellingPrice / mrp) * 100));
}

export async function getAllProducts() {
  const { rows } = await pool.query("SELECT * FROM products ORDER BY created_at ASC");
  return rows.map(toProduct);
}

export async function getProductById(id) {
  const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
  return toProduct(rows[0]);
}

export async function getProductsByIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await pool.query("SELECT * FROM products WHERE id = ANY($1)", [ids]);
  return rows.map(toProduct);
}

// Public storefront listing: search + category filter + sort, all done in SQL
// rather than pulling the whole catalog into Node and filtering in memory.
export async function searchProducts({ search, category, sort, limit }) {
  const clauses = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(title ILIKE $${params.length} OR brand ILIKE $${params.length} OR category ILIKE $${params.length} OR gender ILIKE $${params.length} OR color ILIKE $${params.length})`);
  }

  if (category && category !== "all") {
    const cat = category.toLowerCase();
    if (cat === "men" || cat === "women") {
      params.push(cat);
      clauses.push(`LOWER(gender) = $${params.length}`);
    } else {
      params.push(`%${cat}%`);
      clauses.push(`(LOWER(category) LIKE $${params.length} OR LOWER(section) LIKE $${params.length} OR LOWER(source) LIKE $${params.length} OR LOWER(title) LIKE $${params.length})`);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const sortMap = {
    "price-asc": "selling_price ASC",
    "price-desc": "selling_price DESC",
    "name-asc": "title ASC",
    "discount-desc": "discount_percent DESC"
  };
  const orderBy = sortMap[sort] || "rating DESC";

  const limitClause = limit > 0 ? `LIMIT ${Number(limit)}` : "";

  const { rows } = await pool.query(
    `SELECT * FROM products ${where} ORDER BY ${orderBy} ${limitClause}`,
    params
  );
  return rows.map(toProduct);
}

export async function getCategoriesAndGenders() {
  const categories = await pool.query("SELECT DISTINCT category FROM products WHERE category <> '' ORDER BY category");
  const genders = await pool.query("SELECT DISTINCT gender FROM products WHERE gender <> '' ORDER BY gender");
  return {
    categories: categories.rows.map((r) => r.category),
    genders: genders.rows.map((r) => r.gender)
  };
}

// Paginated + searchable listing for the admin dashboard.
export async function getProductsPage({ search, page, pageSize } = {}) {
  const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const current = Math.max(1, Number(page) || 1);
  const offset = (current - 1) * size;

  const params = [];
  let where = "";
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE (title ILIKE $${params.length} OR brand ILIKE $${params.length} OR category ILIKE $${params.length})`;
  }

  const countResult = await pool.query(`SELECT COUNT(*)::int AS n FROM products ${where}`, params);
  const total = countResult.rows[0].n;
  const pages = Math.max(1, Math.ceil(total / size));

  params.push(size, offset);
  const { rows } = await pool.query(
    `SELECT * FROM products ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { products: rows.map(toProduct), total, page: Math.min(current, pages), pages, pageSize: size };
}

export async function createProduct(input) {
  const id = `admin-${crypto.randomUUID()}`;
  const sellingPrice = Number(input.sellingPrice) || 0;
  const mrp = Number(input.mrp) || sellingPrice;
  const { rows } = await pool.query(
    `INSERT INTO products
       (id, title, brand, image, color, selling_price, mrp, discount_percent, category, gender, section, description, rating, stock, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'admin')
     RETURNING *`,
    [
      id,
      String(input.title || "Untitled product").trim(),
      String(input.brand || "Velora Store").trim(),
      String(input.image || "").trim(),
      String(input.color || "").trim(),
      sellingPrice,
      mrp,
      computeDiscount(sellingPrice, mrp),
      String(input.category || "Collection").trim(),
      String(input.gender || "Unisex").trim(),
      String(input.section || "Collection").trim(),
      String(input.description || "").trim(),
      Number(input.rating) || 4.0,
      Number.isFinite(Number(input.stock)) ? Number(input.stock) : 25
    ]
  );
  return toProduct(rows[0]);
}

export async function updateProduct(id, input) {
  const existing = await getProductById(id);
  if (!existing) return null;

  const sellingPrice = input.sellingPrice !== undefined ? Number(input.sellingPrice) : existing.sellingPrice;
  const mrp = input.mrp !== undefined ? Number(input.mrp) : existing.mrp;

  const { rows } = await pool.query(
    `UPDATE products SET
       title = $2, brand = $3, image = $4, color = $5, selling_price = $6, mrp = $7,
       discount_percent = $8, category = $9, gender = $10, section = $11, description = $12,
       stock = $13
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.title ?? existing.title,
      input.brand ?? existing.brand,
      input.image ?? existing.image,
      input.color ?? existing.color,
      sellingPrice,
      mrp,
      computeDiscount(sellingPrice, mrp),
      input.category ?? existing.category,
      input.gender ?? existing.gender,
      input.section ?? existing.section,
      input.description ?? existing.description,
      input.stock !== undefined ? Number(input.stock) : existing.stock
    ]
  );
  return toProduct(rows[0]);
}

export async function deleteProduct(id) {
  const { rowCount } = await pool.query("DELETE FROM products WHERE id = $1", [id]);
  return rowCount > 0;
}

export async function adjustStock(id, delta, client = pool) {
  await client.query("UPDATE products SET stock = GREATEST(0, stock + $2) WHERE id = $1", [id, delta]);
}

export async function countProducts() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM products");
  return rows[0].n;
}

export async function countLowStock(threshold = 5) {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM products WHERE stock <= $1", [threshold]);
  return rows[0].n;
}

/**
 * Validates a cart-shaped list of { productId, quantity } against the live
 * catalog. Used by the frontend to warn before checkout, and by the order
 * route as the final source of truth right before an order is placed.
 */
export async function validateCartItems(items) {
  const ids = items.map((raw) => (typeof raw === "string" ? raw : raw.productId));
  const products = await getProductsByIds(ids);
  const byId = new Map(products.map((p) => [p.id, p]));

  const results = [];
  let allValid = true;

  for (const raw of items) {
    const productId = typeof raw === "string" ? raw : raw.productId;
    const requestedQty = typeof raw === "string" ? 1 : Math.max(1, Number(raw.quantity) || 1);
    const product = byId.get(productId);

    if (!product) {
      allValid = false;
      results.push({ productId, available: false, reason: "Product no longer available", requestedQty });
      continue;
    }

    const available = product.stock >= requestedQty;
    if (!available) allValid = false;

    results.push({
      productId,
      title: product.title,
      available,
      inStock: product.stock,
      requestedQty,
      reason: available ? undefined : (product.stock === 0 ? "Out of stock" : `Only ${product.stock} left in stock`)
    });
  }

  return { valid: allValid, items: results };
}
