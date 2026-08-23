import { pool } from "../pool.js";

function toSettings(row) {
  if (!row) return null;
  return {
    storeName: row.store_name,
    tagline: row.tagline,
    supportEmail: row.support_email,
    supportPhone: row.support_phone,
    currency: row.currency,
    freeShippingThreshold: Number(row.free_shipping_threshold),
    taxPercent: Number(row.tax_percent),
    updatedAt: row.updated_at
  };
}

export async function getSettings() {
  const { rows } = await pool.query("SELECT * FROM store_settings WHERE id = 1");
  return toSettings(rows[0]) || {
    storeName: "VELORA",
    tagline: "Premium Fashion & Lifestyle",
    supportEmail: "support@velora.com",
    supportPhone: "+91 90000 00000",
    currency: "INR",
    freeShippingThreshold: 5000,
    taxPercent: 5
  };
}

export async function updateSettings(input) {
  const current = await getSettings();
  const { rows } = await pool.query(
    `INSERT INTO store_settings (id, store_name, tagline, support_email, support_phone, currency, free_shipping_threshold, tax_percent, updated_at)
     VALUES (1, $1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (id) DO UPDATE SET
       store_name = $1, tagline = $2, support_email = $3, support_phone = $4,
       currency = $5, free_shipping_threshold = $6, tax_percent = $7, updated_at = now()
     RETURNING *`,
    [
      input.storeName ?? current.storeName,
      input.tagline ?? current.tagline,
      input.supportEmail ?? current.supportEmail,
      input.supportPhone ?? current.supportPhone,
      input.currency ?? current.currency,
      input.freeShippingThreshold !== undefined ? Number(input.freeShippingThreshold) : current.freeShippingThreshold,
      input.taxPercent !== undefined ? Number(input.taxPercent) : current.taxPercent
    ]
  );
  return toSettings(rows[0]);
}
