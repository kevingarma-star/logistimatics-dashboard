-- ============================================================
-- 001_churn_tables.sql
-- Churn Dashboard — tables, view, indexes, RLS policies
-- Run once against your Supabase project via the SQL editor.
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================


-- ── Table A: subscription_cancellations ─────────────────────
CREATE TABLE IF NOT EXISTS subscription_cancellations (
  -- IDs
  cancellation_id          text PRIMARY KEY,          -- format "13846241-309195"
  subscription_id          text,
  account_id               text,

  -- Outcome
  outcome                  text CHECK (outcome IS NULL OR outcome IN ('Cancelled','Pending','Withdrawn')),
  cancel_mode              text,
  cancel_category          text,                       -- derived from cancel_mode; see mapping below
  cancel_timing            text CHECK (cancel_timing IS NULL OR cancel_timing IN ('Immediate','End of term')),

  -- Who
  initiated_by             text CHECK (initiated_by IS NULL OR initiated_by IN ('Customer','System','GPX admin','Other user')),
  initiated_by_name        text,
  initiated_by_email       text,
  cancelled_by             text,

  -- Dates
  initiated_at             timestamptz,
  effective_at             timestamptz,
  withdrawn_at             timestamptz,
  term_end_at              timestamptz,
  recovered_at             timestamptz,
  sub_started_at           timestamptz,
  customer_since           timestamptz,

  -- Status
  pending_overdue          boolean,
  current_status           text,
  account_fully_churned    boolean,

  -- Win-back
  recovery                 text DEFAULT '',            -- '' | 'Reactivated (new sub)' | 'Restored (same sub)'
  recovered_subscription_id text,

  -- Customer
  account_title            text,
  primary_contact_name     text,
  primary_contact_email    text,

  -- Product
  device_model             text,
  device_serial            text,
  purchase_channel         text,                       -- Shopify | Website | Amazon
  plan_months              integer,
  plan_price_usd           numeric,
  plan_monthly_price_usd   numeric,
  sub_age_months           numeric,
  mrr_at_cancel_usd        numeric,
  cancellation_reason      text,                       -- left empty; filled by cancellation_conversation_insights

  refreshed_at             timestamptz DEFAULT now()
);

-- cancel_mode → cancel_category mapping applied during CSV upsert:
--   'Customer cancellation', 'Other user cancellation'          → 'Voluntary (customer)'
--   'GPX admin cancellation'                                    → 'Voluntary (via GPX staff)'
--   'Non-payment'                                               → 'Involuntary (non-payment)'
--   'Ops bulk update', 'Device unassigned (archived)',
--   'Account data deleted'                                      → 'Operational (GPX staff)'


-- ── Table B: cancellation_conversation_insights ─────────────
CREATE TABLE IF NOT EXISTS cancellation_conversation_insights (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_conversation_id text UNIQUE,
  conversation_url         text,
  conversation_created_at  timestamptz,

  customer_email           text,
  account_id               text,
  subscription_id          text,
  cancellation_id          text REFERENCES subscription_cancellations(cancellation_id),

  initiated_by_staff       boolean,
  staff_member_name        text,
  requested_by_customer    boolean,

  reason_category          text CHECK (reason_category IS NULL OR reason_category IN (
                             'Price / cost',
                             'No longer needed',
                             'Device issue / not working',
                             'Coverage / accuracy',
                             'Switched competitor',
                             'Vehicle / asset sold',
                             'Business closed',
                             'Billing problem',
                             'Moving to different plan/device',
                             'Other'
                           )),
  reason_detail            text,

  save_attempted           boolean,
  save_offer               text,
  saved                    boolean,

  sentiment                text CHECK (sentiment IS NULL OR sentiment IN ('Positive','Neutral','Negative')),

  ai_confidence            numeric CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  processed_at             timestamptz DEFAULT now()
);


-- ── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sc_initiated_at           ON subscription_cancellations(initiated_at);
CREATE INDEX IF NOT EXISTS idx_sc_subscription_id        ON subscription_cancellations(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sc_account_id             ON subscription_cancellations(account_id);
CREATE INDEX IF NOT EXISTS idx_sc_email                  ON subscription_cancellations(primary_contact_email);
CREATE INDEX IF NOT EXISTS idx_sc_outcome                ON subscription_cancellations(outcome);
CREATE INDEX IF NOT EXISTS idx_sc_cancel_category        ON subscription_cancellations(cancel_category);

CREATE INDEX IF NOT EXISTS idx_cci_cancellation_id       ON cancellation_conversation_insights(cancellation_id);
CREATE INDEX IF NOT EXISTS idx_cci_subscription_id       ON cancellation_conversation_insights(subscription_id);
CREATE INDEX IF NOT EXISTS idx_cci_account_id            ON cancellation_conversation_insights(account_id);
CREATE INDEX IF NOT EXISTS idx_cci_customer_email        ON cancellation_conversation_insights(customer_email);


-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE subscription_cancellations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_conversation_insights ENABLE ROW LEVEL SECURITY;

-- Anon (dashboard browser) may read; writes go through service-role only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subscription_cancellations' AND policyname = 'anon read cancellations'
  ) THEN
    CREATE POLICY "anon read cancellations"
      ON subscription_cancellations FOR SELECT TO anon USING (true);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cancellation_conversation_insights' AND policyname = 'anon read insights'
  ) THEN
    CREATE POLICY "anon read insights"
      ON cancellation_conversation_insights FOR SELECT TO anon USING (true);
  END IF;
END$$;

-- Explicit grants (needed even with RLS policies in place)
GRANT SELECT ON subscription_cancellations         TO anon;
GRANT SELECT ON cancellation_conversation_insights TO anon;


-- ── View: v_cancellations_enriched ───────────────────────────
-- Joins each cancellation to its best-matching insight (priority:
--   1. cancellation_id match
--   2. subscription_id match
--   3. account/email match within ±14 days)
-- Also surfaces derived fields: `reason` and `staff_name`.

CREATE OR REPLACE VIEW v_cancellations_enriched AS
SELECT DISTINCT ON (sc.cancellation_id)
  sc.cancellation_id,
  sc.subscription_id,
  sc.account_id,
  sc.outcome,
  sc.cancel_mode,
  sc.cancel_category,
  sc.cancel_timing,
  sc.initiated_by,
  sc.initiated_by_name,
  sc.initiated_by_email,
  sc.cancelled_by,
  sc.initiated_at,
  sc.effective_at,
  sc.withdrawn_at,
  sc.term_end_at,
  sc.recovered_at,
  sc.sub_started_at,
  sc.customer_since,
  sc.pending_overdue,
  sc.current_status,
  sc.account_fully_churned,
  sc.recovery,
  sc.recovered_subscription_id,
  sc.account_title,
  sc.primary_contact_name,
  sc.primary_contact_email,
  sc.device_model,
  sc.device_serial,
  sc.purchase_channel,
  sc.plan_months,
  sc.plan_price_usd,
  sc.plan_monthly_price_usd,
  sc.sub_age_months,
  sc.mrr_at_cancel_usd,
  sc.cancellation_reason,
  sc.refreshed_at,
  -- Insight fields (nullable until automation populates them)
  cci.id                       AS insight_id,
  cci.intercom_conversation_id,
  cci.conversation_url,
  cci.reason_category,
  cci.reason_detail,
  cci.save_attempted,
  cci.save_offer,
  cci.saved,
  cci.sentiment,
  cci.initiated_by_staff       AS insight_initiated_by_staff,
  cci.staff_member_name        AS insight_staff_name,
  cci.requested_by_customer,
  -- Derived: best available reason and staff name
  COALESCE(cci.reason_category, 'Unknown')                                        AS reason,
  COALESCE(sc.initiated_by_name, cci.staff_member_name, 'Unattributed')           AS staff_name
FROM subscription_cancellations sc
LEFT JOIN cancellation_conversation_insights cci ON (
  cci.cancellation_id = sc.cancellation_id
  OR (sc.subscription_id IS NOT NULL AND cci.subscription_id IS NOT NULL
      AND cci.subscription_id = sc.subscription_id)
  OR (
    cci.cancellation_id IS NULL
    AND (cci.subscription_id IS NULL
         OR sc.subscription_id IS NULL
         OR cci.subscription_id <> sc.subscription_id)
    AND (cci.account_id = sc.account_id
         OR cci.customer_email = sc.primary_contact_email)
    AND cci.conversation_created_at
        BETWEEN sc.initiated_at - INTERVAL '14 days'
            AND sc.initiated_at + INTERVAL '14 days'
  )
)
ORDER BY
  sc.cancellation_id,
  CASE
    WHEN cci.cancellation_id = sc.cancellation_id THEN 1
    WHEN sc.subscription_id IS NOT NULL AND cci.subscription_id IS NOT NULL
         AND cci.subscription_id = sc.subscription_id THEN 2
    ELSE 3
  END NULLS LAST;

GRANT SELECT ON v_cancellations_enriched TO anon;
