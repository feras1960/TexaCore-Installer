-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 المرحلة 1B: إضافات ذكية على الجداول الموحدة
-- ═══════════════════════════════════════════════════════════════════════════
-- التاريخ: 2026-02-15
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  1. Optimistic Locking — منع التعديل المتزامن                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- يزداد تلقائياً مع كل UPDATE — يستخدمه الفرونت إند لمنع تضارب التعديلات

ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  2. تتبع الطباعة — للتدقيق والمحاسبة                               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- كم مرة طُبع المستند ومن قام بالطباعة

ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS printed_count INTEGER DEFAULT 0;
ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS last_printed_at TIMESTAMPTZ;
ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS last_printed_by UUID REFERENCES auth.users(id);

ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS printed_count INTEGER DEFAULT 0;
ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS last_printed_at TIMESTAMPTZ;
ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS last_printed_by UUID REFERENCES auth.users(id);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  3. تتبع التذكيرات — إدارة الذمم                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- عدد وتاريخ آخر تذكير لتحصيل المديونية

ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0;
ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;

ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0;
ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  4. ربط المرتجعات بالعملية الأصلية                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ربط المرتجع بفاتورة/أمر الأصل

ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS original_transaction_id UUID REFERENCES purchase_transactions(id);
ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS is_return BOOLEAN DEFAULT false;

ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS original_transaction_id UUID REFERENCES sales_transactions(id);
ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS is_return BOOLEAN DEFAULT false;

-- فهارس المرتجعات
CREATE INDEX IF NOT EXISTS idx_pt_original ON purchase_transactions(original_transaction_id) WHERE original_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_st_original ON sales_transactions(original_transaction_id) WHERE original_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pt_returns ON purchase_transactions(is_return) WHERE is_return = true;
CREATE INDEX IF NOT EXISTS idx_st_returns ON sales_transactions(is_return) WHERE is_return = true;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  5. Trigger: زيادة version تلقائياً عند كل UPDATE                    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pt_increment_version ON purchase_transactions;
CREATE TRIGGER trg_pt_increment_version
    BEFORE UPDATE ON purchase_transactions
    FOR EACH ROW EXECUTE FUNCTION increment_version();

DROP TRIGGER IF EXISTS trg_st_increment_version ON sales_transactions;
CREATE TRIGGER trg_st_increment_version
    BEFORE UPDATE ON sales_transactions
    FOR EACH ROW EXECUTE FUNCTION increment_version();


COMMIT;

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  ✅ الإضافات الذكية مكتملة!                                          ║
-- ║                                                                       ║
-- ║  version          — Optimistic Locking ✓                              ║
-- ║  printed_count    — تتبع الطباعة ✓                                    ║
-- ║  reminder_count   — تتبع التذكيرات ✓                                  ║
-- ║  original_txn_id  — ربط المرتجعات ✓                                   ║
-- ║  increment_version — trigger تلقائي ✓                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
