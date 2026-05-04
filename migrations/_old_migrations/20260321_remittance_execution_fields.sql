-- ═══════════════════════════════════════════════════════════════════
-- 🔧 Add Execution Fields to Remittances
-- TexaCore ERP — Migration: 2026-03-21
-- 
-- Adds execution_channel, execution_payment_method, our_commission,
-- agent_commission, receiver_customer_id to remittances table
-- ═══════════════════════════════════════════════════════════════════

-- Add execution channel (agent_partner, branch, direct_bank, wallet)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'remittances' AND column_name = 'execution_channel'
  ) THEN
    ALTER TABLE public.remittances 
      ADD COLUMN execution_channel TEXT 
        CHECK (execution_channel IN ('agent_partner', 'branch', 'direct_bank', 'wallet'));
  END IF;
END $$;

-- Add execution payment method
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'remittances' AND column_name = 'execution_payment_method'
  ) THEN
    ALTER TABLE public.remittances 
      ADD COLUMN execution_payment_method TEXT DEFAULT 'cash';
  END IF;
END $$;

-- Add our_commission (breakdown field)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'remittances' AND column_name = 'our_commission'
  ) THEN
    ALTER TABLE public.remittances 
      ADD COLUMN our_commission NUMERIC(18,4) DEFAULT 0;
  END IF;
END $$;

-- Add agent_commission (breakdown field)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'remittances' AND column_name = 'agent_commission'
  ) THEN
    ALTER TABLE public.remittances 
      ADD COLUMN agent_commission NUMERIC(18,4) DEFAULT 0;
  END IF;
END $$;

-- Add receiver_customer_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'remittances' AND column_name = 'receiver_customer_id'
  ) THEN
    ALTER TABLE public.remittances 
      ADD COLUMN receiver_customer_id UUID REFERENCES public.customers(id);
  END IF;
END $$;

-- Index for execution_channel
CREATE INDEX IF NOT EXISTS idx_remittances_exec_channel ON public.remittances(execution_channel);

-- ✅ Verification
DO $$
DECLARE
  col_count INT;
BEGIN
  SELECT COUNT(*) INTO col_count 
  FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'remittances' 
    AND column_name IN ('execution_channel', 'execution_payment_method', 'our_commission', 'agent_commission', 'receiver_customer_id');
  RAISE NOTICE '✅ remittances execution fields: % / 5 columns present', col_count;
END $$;
