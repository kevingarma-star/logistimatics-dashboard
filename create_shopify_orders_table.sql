-- shopify_orders table
-- One row per device (serial is the natural unique key).
-- Mirrors the "Shipped Shopify Orders and Devices" Google Sheet.
-- Run once in Supabase SQL Editor to create the table.

CREATE TABLE IF NOT EXISTS shopify_orders (
    serial                   TEXT        PRIMARY KEY,
    order_number             TEXT,
    customer_email           TEXT        NOT NULL,
    billing_name             TEXT,
    ship_date                DATE,
    device_type              TEXT,
    user_id                  TEXT,
    internal_notes           TEXT,
    return_processed_at      TEXT,        -- raw value from sheet, e.g. "2026-03-15 14:22:00"
    subscription_id          TEXT,
    subscription_assigned_at TEXT,        -- raw value from sheet, e.g. "2026-03-09 22:21:21"
    subscription_term_months INTEGER,
    created_at               TIMESTAMPTZ DEFAULT NOW(),
    updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- Index for the two most common lookups in generate_data.py
CREATE INDEX IF NOT EXISTS shopify_orders_email_idx  ON shopify_orders (customer_email);
CREATE INDEX IF NOT EXISTS shopify_orders_sub_id_idx ON shopify_orders (subscription_id);

-- Auto-update updated_at on every upsert
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shopify_orders_updated_at ON shopify_orders;
CREATE TRIGGER shopify_orders_updated_at
  BEFORE UPDATE ON shopify_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
