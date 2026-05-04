-- ═══════════════════════════════════════════════════════════════════
-- 🏦 Exchange & Remittance Module — Sync Schema
-- TexaCore ERP — Migration: 2026-03-19 (Fix Overlap with 00010)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.remittances 
ADD COLUMN IF NOT EXISTS remittance_date TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(18,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS commission_bearer TEXT DEFAULT 'sender' CHECK (commission_bearer IN ('sender', 'receiver', 'split')),
ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT 'branch' CHECK (delivery_method IN ('branch', 'agent', 'bank', 'wallet')),
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'vip')),
ADD COLUMN IF NOT EXISTS purpose TEXT,
ADD COLUMN IF NOT EXISTS sender_customer_id UUID REFERENCES public.customers(id),
ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.exchange_partners(id),
ADD COLUMN IF NOT EXISTS receiver_id_type TEXT,
ADD COLUMN IF NOT EXISTS receiver_id_number TEXT,
ADD COLUMN IF NOT EXISTS receiver_wallet TEXT,
ADD COLUMN IF NOT EXISTS total_paid NUMERIC(18,4),
ADD COLUMN IF NOT EXISTS last_reconciliation_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_reconciled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Update existing records to have a remittance_date if it was missing (using created_at)
UPDATE public.remittances SET remittance_date = created_at WHERE remittance_date IS NULL;
