// Loads backend/data/products.json into the products table.
// Safe to re-run: it upserts by id, so it won't create duplicates, and it
// won't stomp on stock/price changes you've made in the DB unless the
// product's source id is the same as one in the JSON file.
//
// Usage: npm run db:seed

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool } from "./pool.js";
import { runMigrations } from "./migrate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productsFile = process.env.VELORA_PRODUCTS_FILE || path.join(__dirname, "..", "data", "products.json");

export async function seedProducts() {
  const raw = await readFile(productsFile, "utf8");
  const products = JSON.parse(raw);

  console.log(`Seeding ${products.length} products from ${productsFile}...`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of products) {
      await client.query(
        `INSERT INTO products
           (id, title, brand, image, color, selling_price, mrp, discount_percent, category, gender, section, description, rating, stock, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           brand = EXCLUDED.brand,
           image = EXCLUDED.image,
           color = EXCLUDED.color,
           selling_price = EXCLUDED.selling_price,
           mrp = EXCLUDED.mrp,
           discount_percent = EXCLUDED.discount_percent,
           category = EXCLUDED.category,
           gender = EXCLUDED.gender,
           section = EXCLUDED.section,
           description = EXCLUDED.description,
           rating = EXCLUDED.rating,
           source = EXCLUDED.source`,
        [
          p.id, p.title || "Untitled product", p.brand || "", p.image || "", p.color || "",
          Number(p.sellingPrice) || 0, Number(p.mrp) || 0, Number(p.discountPercent) || 0,
          p.category || "", p.gender || "", p.section || "", p.description || "",
          Number(p.rating) || 4.0, Number.isFinite(Number(p.stock)) ? Number(p.stock) : 25,
          p.source || "seed"
        ]
      );
    }
    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then(seedProducts)
    .then(() => pool.end())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
