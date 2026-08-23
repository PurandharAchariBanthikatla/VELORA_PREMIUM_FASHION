-- VELORA upgrade: coupons + store settings.
-- users.addresses stays JSONB (already flexible enough to hold structured
-- address objects instead of plain strings — no column change needed).

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'percent' CHECK (type IN ('percent', 'fixed')),
  value NUMERIC(10, 2) NOT NULL DEFAULT 0,
  min_order NUMERIC(10, 2) NOT NULL DEFAULT 0,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons (code);

-- Single-row settings table (id is always 1) for the admin Settings tab.
CREATE TABLE IF NOT EXISTS store_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'VELORA',
  tagline TEXT NOT NULL DEFAULT 'Premium Fashion & Lifestyle',
  support_email TEXT NOT NULL DEFAULT 'support@velora.com',
  support_phone TEXT NOT NULL DEFAULT '+91 90000 00000',
  currency TEXT NOT NULL DEFAULT 'INR',
  free_shipping_threshold NUMERIC(10, 2) NOT NULL DEFAULT 5000,
  tax_percent NUMERIC(5, 2) NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Order discount tracking (coupon applied at checkout).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
