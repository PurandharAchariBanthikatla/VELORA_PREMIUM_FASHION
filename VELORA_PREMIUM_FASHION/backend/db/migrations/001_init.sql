-- Initial schema: users, products, orders, audit log.
-- IDs are generated in application code (crypto.randomUUID()) rather than
-- via a Postgres extension, so this migration doesn't depend on pgcrypto
-- or uuid-ossp being installed/enabled.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  phone TEXT NOT NULL DEFAULT '',
  addresses JSONB NOT NULL DEFAULT '[]',
  wishlist JSONB NOT NULL DEFAULT '[]',
  cart JSONB NOT NULL DEFAULT '[]',
  refresh_token_hash TEXT,
  reset_token_hash TEXT,
  reset_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Product ids in the original dataset are human-readable slugs
-- (e.g. "gouns-gouns-js-8"), not UUIDs, so this stays TEXT.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  mrp NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  rating NUMERIC(2, 1) NOT NULL DEFAULT 4.0,
  stock INTEGER NOT NULL DEFAULT 25,
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_gender ON products (gender);
CREATE INDEX IF NOT EXISTS idx_products_title_trgm ON products USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  customer JSONB NOT NULL,
  items JSONB NOT NULL,
  shipping_address TEXT NOT NULL DEFAULT '',
  payment JSONB NOT NULL,
  summary JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  status_history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT,
  admin_id UUID,
  admin_name TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at DESC);
