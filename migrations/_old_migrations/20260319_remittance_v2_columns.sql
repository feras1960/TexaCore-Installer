-- ════════════════════════════════════════════════════════════════
-- 🏦 Remittance V2 — Database Migration
-- ════════════════════════════════════════════════════════════════
-- Date: 2026-03-19
-- Purpose: Add missing columns for Remittance V2 features:
--   - receiver_customer_id (link receiver to customers)
--   - sender_city (sender city info)
--   - tracking_code (unique tracking code)
--   - collection_* columns (payment collection tracking)
--   - confirmed_* columns (confirmation tracking)
--   - delivered_at/delivery_confirmed_by (delivery tracking)
--   - Update delivery_method check constraint
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Receiver Customer Link ────────────────────────────────
ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS receiver_customer_id uuid;

-- Add FK if not exists (safe approach)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'remittances_receiver_customer_id_fkey' 
    AND table_name = 'remittances'
  ) THEN
    ALTER TABLE remittances 
      ADD CONSTRAINT remittances_receiver_customer_id_fkey 
      FOREIGN KEY (receiver_customer_id) REFERENCES customers(id);
  END IF;
END $$;

-- ─── 2. Sender City ──────────────────────────────────────────
ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS sender_city text;

-- ─── 3. Tracking Code (unique per tenant+company) ────────────
ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS tracking_code varchar(50);

-- Unique index for tracking code
CREATE UNIQUE INDEX IF NOT EXISTS idx_remittances_tracking_code 
  ON remittances(tenant_id, company_id, tracking_code) 
  WHERE tracking_code IS NOT NULL;

-- ─── 4. Collection Tracking ──────────────────────────────────
ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS collection_status text DEFAULT 'pending';

ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS collection_method text;

ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS collection_fund_id uuid;

ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS collection_reference text;

-- FK for collection_fund_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'remittances_collection_fund_id_fkey' 
    AND table_name = 'remittances'
  ) THEN
    ALTER TABLE remittances 
      ADD CONSTRAINT remittances_collection_fund_id_fkey 
      FOREIGN KEY (collection_fund_id) REFERENCES funds(id);
  END IF;
END $$;

-- Check constraint for collection_status
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'remittances_collection_status_check'
  ) THEN
    ALTER TABLE remittances 
      ADD CONSTRAINT remittances_collection_status_check 
      CHECK (collection_status IN ('collected', 'pending', 'partial'));
  END IF;
END $$;

-- ─── 5. Confirmation Tracking ────────────────────────────────
ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS confirmed_by uuid;

ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- ─── 6. Delivery Tracking ────────────────────────────────────
ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE remittances 
  ADD COLUMN IF NOT EXISTS delivery_confirmed_by uuid;

-- ─── 7. Update delivery_method constraint ────────────────────
-- Current: branch, agent, bank, wallet
-- New: + internal, delegate
ALTER TABLE remittances DROP CONSTRAINT IF EXISTS remittances_delivery_method_check;
ALTER TABLE remittances 
  ADD CONSTRAINT remittances_delivery_method_check 
  CHECK (delivery_method IN ('branch', 'agent', 'bank', 'wallet', 'internal', 'delegate'));

-- ─── 8. Update status to include all values ──────────────────
-- Current doesn't have a constraint, just default 'pending'
-- We don't add a constraint since there are many statuses

-- ─── 9. Indexes for new columns ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_remittances_collection_status 
  ON remittances(collection_status) WHERE collection_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_remittances_receiver_customer 
  ON remittances(receiver_customer_id) WHERE receiver_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_remittances_partner 
  ON remittances(partner_id) WHERE partner_id IS NOT NULL;

COMMIT;

-- ─── Verify ──────────────────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'remittances' 
  AND column_name IN (
    'receiver_customer_id', 'sender_city', 'tracking_code',
    'collection_status', 'collection_method', 'collection_fund_id', 'collection_reference',
    'confirmed_by', 'confirmed_at', 'delivered_at', 'delivery_confirmed_by'
  )
ORDER BY column_name;
