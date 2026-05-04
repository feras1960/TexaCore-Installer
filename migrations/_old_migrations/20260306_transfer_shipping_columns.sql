-- ════════════════════════════════════════════════════════════════
-- 🚛 إضافة أعمدة الشحن والسائق لجدول المناقلات
-- تنفيذ في Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- 1. طريقة الشحن
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS shipping_method TEXT DEFAULT 'company_driver'
    CHECK (shipping_method IN ('company_driver', 'external_truck', 'shipping_company'));

-- 2. بيانات السائق (سائق الشركة أو خارجي)
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL;

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS driver_name TEXT;

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS driver_phone TEXT;

-- 3. بيانات السيارة
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS vehicle_number TEXT;

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT;

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS vehicle_model TEXT;

-- 4. بيانات شركة الشحن
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS shipping_carrier TEXT;

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS tracking_number TEXT;

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(12,2) DEFAULT 0;

-- 5. بيانات إضافية
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS estimated_delivery DATE;

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS shipping_notes TEXT;

-- 6. فهرس للبحث بالسائق ورقم التتبع
CREATE INDEX IF NOT EXISTS idx_stock_transfers_driver ON stock_transfers(driver_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_tracking ON stock_transfers(tracking_number) WHERE tracking_number IS NOT NULL;

-- 7. التحقق:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'stock_transfers'
  AND column_name IN (
    'shipping_method', 'driver_id', 'driver_name', 'driver_phone',
    'vehicle_number', 'vehicle_type', 'vehicle_model',
    'shipping_carrier', 'tracking_number', 'shipping_cost',
    'estimated_delivery', 'shipping_notes'
  )
ORDER BY column_name;
