-- Run this once in the Supabase SQL editor before running generate_return_data.py

CREATE TABLE IF NOT EXISTS return_conversations (
  id               BIGSERIAL PRIMARY KEY,
  order_number     TEXT UNIQUE NOT NULL,
  email            TEXT NOT NULL,
  customer_name    TEXT,
  return_date      DATE,
  ship_date        DATE,
  device_type      TEXT,
  serial           TEXT,
  conversation_id  TEXT,           -- Intercom conversation ID (null if undeliverable)
  reason_summary   TEXT,           -- Claude-generated free-text summary
  is_undeliverable BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on every upsert
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER return_conversations_updated_at
BEFORE UPDATE ON return_conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_return_conversations_email       ON return_conversations(email);
CREATE INDEX IF NOT EXISTS idx_return_conversations_return_date ON return_conversations(return_date DESC);
