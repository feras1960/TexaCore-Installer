-- ════════════════════════════════════════════════════════════════
-- 🔄 إضافة أعمدة التسليم لجدول المناقلات
-- تنفيذ في Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- 1. إضافة delivery_draft لحفظ مسودة الرولونات المختارة للتحميل
ALTER TABLE stock_transfers 
  ADD COLUMN IF NOT EXISTS delivery_draft JSONB;

-- 2. إضافة shipped_at لتسجيل وقت الشحن
ALTER TABLE stock_transfers 
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

-- 3. إضافة received_at لتسجيل وقت الاستلام
ALTER TABLE stock_transfers 
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

-- 4. التحقق:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'stock_transfers' 
  AND column_name IN ('delivery_draft', 'shipped_at', 'received_at')
ORDER BY column_name;
