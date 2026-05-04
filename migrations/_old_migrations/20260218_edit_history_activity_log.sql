-- ═══════════════════════════════════════════════════════════════
-- 📋 In-Place Edit & Activity Log Infrastructure
-- تاريخ: 2026-02-18
-- الوصف: إضافة حقول سجل التعديلات وسجل النشاط للجداول الرئيسية
-- ═══════════════════════════════════════════════════════════════

-- ═══ 1. Purchase Transactions ═══
ALTER TABLE purchase_transactions
  ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS activity_log JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by UUID,
  ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;

-- ═══ 2. Sales Transactions ═══
ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS activity_log JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by UUID,
  ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;

-- ═══ 3. Journal Entries ═══
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS edit_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS activity_log JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by UUID,
  ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;

-- ═══ 4. Verification ═══
DO $$
DECLARE
  tbl TEXT;
  col TEXT;
  missing TEXT := '';
BEGIN
  FOR tbl IN VALUES ('purchase_transactions'), ('sales_transactions'), ('journal_entries')
  LOOP
    FOR col IN VALUES ('edit_history'), ('activity_log'), ('last_edited_at'), ('last_edited_by'), ('edit_count')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = tbl AND column_name = col
      ) THEN
        missing := missing || tbl || '.' || col || ', ';
      END IF;
    END LOOP;
  END LOOP;

  IF missing = '' THEN
    RAISE NOTICE '✅ All edit_history + activity_log columns verified successfully!';
  ELSE
    RAISE WARNING '❌ Missing columns: %', missing;
  END IF;
END $$;
