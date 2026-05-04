-- ═══════════════════════════════════════════════════════════════════
-- 🏦 Exchange & Remittance Module — Enhance Remittance Fields
-- TexaCore ERP — Migration: 2026-03-19
-- 
-- Adds explicit fields for the complex remittance scenarios:
-- - Detailed Commissions (Our, Agent, Network)
-- - Specific routing details (SWIFT, Crypto)
-- - Payment method used by sender
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add specific columns to public.remittances
ALTER TABLE public.remittances 
ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'wallet', 'internal')),
ADD COLUMN IF NOT EXISTS our_commission NUMERIC(18,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS agent_commission NUMERIC(18,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS network_fee NUMERIC(18,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS crypto_network TEXT,
ADD COLUMN IF NOT EXISTS delivery_country TEXT,
ADD COLUMN IF NOT EXISTS delivery_city TEXT,
ADD COLUMN IF NOT EXISTS delivery_delegate_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS receiver_swift_code TEXT,
ADD COLUMN IF NOT EXISTS receiver_routing_number TEXT;

-- We don't need to rebuild RLS because these are just extra columns on an existing table that already has RLS.

-- The end of this migration adds all the missing required data fields for complex routing.
