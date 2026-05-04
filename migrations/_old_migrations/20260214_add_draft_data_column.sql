-- ═══════════════════════════════════════════════════════════════
-- إضافة عمود draft_data لدعم حفظ مسودات الاستلام
-- يحفظ بيانات البنود (الرولونات) أثناء عملية الاستلام
-- حتى لو انقطع الإنترنت أو الكهرباء يمكن المتابعة لاحقاً
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_receipts') THEN
        EXECUTE 'ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS draft_data JSONB DEFAULT NULL';
        EXECUTE 'COMMENT ON COLUMN purchase_receipts.draft_data IS ''Stores in-progress receipt items as JSON. Cleared when receipt is completed.''';
    END IF;
END $$;
