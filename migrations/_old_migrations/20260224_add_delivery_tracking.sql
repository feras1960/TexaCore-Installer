-- ════════════════════════════════════════════════════════════════
-- 📦 تحديث قاعدة البيانات لدعم التسليم
-- تنفيذ في Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- 1. إضافة delivered_qty لتتبع الكميات المسلّمة لكل بند
ALTER TABLE sales_transaction_items 
  ADD COLUMN IF NOT EXISTS delivered_qty NUMERIC(12,3) DEFAULT 0;

-- 2. إضافة delivered_at لتسجيل وقت اكتمال التسليم
ALTER TABLE sales_transactions 
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- 3. إضافة delivery_draft لحفظ مسودة الرولونات المختارة (real-time)
ALTER TABLE sales_transactions 
  ADD COLUMN IF NOT EXISTS delivery_draft JSONB;

-- 4. إضافة delivery_method إذا لم تكن موجودة
ALTER TABLE sales_transactions 
  ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(50) DEFAULT 'pickup';

-- 5. إضافة delivery_notes لملاحظات التسليم
ALTER TABLE sales_transactions 
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- 6. التحقق:
DO $$ 
BEGIN
  RAISE NOTICE '✅ Checking delivery columns...';
END $$;

SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'sales_transaction_items' 
  AND column_name = 'delivered_qty';

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sales_transactions' 
  AND column_name IN ('delivered_at', 'delivery_draft', 'delivery_method', 'delivery_notes')
ORDER BY column_name;
