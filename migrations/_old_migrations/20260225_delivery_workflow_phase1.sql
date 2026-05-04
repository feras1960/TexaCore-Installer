-- ════════════════════════════════════════════════════════════════
-- 📦 Delivery Workflow Enhancement — Phase 1 + 2
-- تحديث حقول التسليم في فاتورة المبيعات
-- تنفيذ في Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- 1. حقول التسليم المباشر (direct_pickup) — بيانات العميل والسيارة
ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS pickup_person_name TEXT,
  ADD COLUMN IF NOT EXISTS pickup_person_id_number TEXT,
  ADD COLUMN IF NOT EXISTS pickup_vehicle_number TEXT,
  ADD COLUMN IF NOT EXISTS pickup_vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS pickup_driver_name TEXT,
  ADD COLUMN IF NOT EXISTS pickup_driver_phone TEXT;

-- 2. حقول السائق (لسيناريوهات الفرع والتوصيل)
ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS driver_id UUID,
  ADD COLUMN IF NOT EXISTS driver_name TEXT,
  ADD COLUMN IF NOT EXISTS driver_phone TEXT;

-- 3. حقول الفرع المستلم (لسيناريو الفرع)
ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS receiving_branch_id UUID,
  ADD COLUMN IF NOT EXISTS receiving_branch_name TEXT;

-- 4. حقول تأكيد التسليم
ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_by UUID;

-- 5. عنوان العميل (نسخة مسطحة للتسليم)
ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS customer_address TEXT;

-- 6. التحقق من الحقول
DO $$ 
BEGIN
  RAISE NOTICE '✅ Delivery workflow columns added successfully';
END $$;

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sales_transactions' 
  AND column_name IN (
    'pickup_person_name', 'pickup_vehicle_number', 
    'driver_id', 'driver_name', 'driver_phone',
    'receiving_branch_id', 'receiving_branch_name',
    'delivery_confirmed_at', 'delivery_confirmed_by',
    'customer_address'
  )
ORDER BY column_name;
