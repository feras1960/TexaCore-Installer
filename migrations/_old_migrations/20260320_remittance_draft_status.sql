-- ════════════════════════════════════════════════════════════════
-- 📋 Remittance Draft Support — Schema Changes
-- ════════════════════════════════════════════════════════════════
-- Date: 2026-03-20

-- 1. Add 'draft' to status constraint
ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_status_check;
ALTER TABLE public.remittances ADD CONSTRAINT remittances_status_check
  CHECK (status IN ('draft', 'pending', 'processing', 'sent', 'delivered', 'completed', 'cancelled', 'returned'));

-- 2. Expand delivery_method constraint
ALTER TABLE public.remittances DROP CONSTRAINT IF EXISTS remittances_delivery_method_check;
ALTER TABLE public.remittances ADD CONSTRAINT remittances_delivery_method_check
  CHECK (delivery_method IN ('branch', 'agent', 'bank', 'wallet', 'internal', 'delegate'));

-- 3. Make columns nullable for draft support
ALTER TABLE public.remittances ALTER COLUMN receiver_country DROP NOT NULL;
ALTER TABLE public.remittances ALTER COLUMN created_by DROP NOT NULL;

-- 4. Widen country columns (were varchar(3), now varchar(100) for full names)
ALTER TABLE public.remittances ALTER COLUMN sender_country TYPE VARCHAR(100);
ALTER TABLE public.remittances ALTER COLUMN receiver_country TYPE VARCHAR(100);
