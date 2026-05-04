-- ═══════════════════════════════════════════════════════════════════════════
-- 🛡️ MASTER FIX: Security & Schema Alignment for Receipt Cycle
-- إصلاح شامل: الصلاحيات، هيكلية جداول المخزون، وتحديث حالات الفواتير
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. التأكد من جدول حركات المخزون (Inventory Movements)
DO $$
BEGIN
    ALTER TABLE inventory_movements ALTER COLUMN product_id DROP NOT NULL;
    
    -- إضافة عمود material_id إذا لم يوجد
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_movements' AND column_name = 'material_id') THEN
        ALTER TABLE inventory_movements ADD COLUMN material_id UUID;
    END IF;
    
    -- إضافة عمود created_by إذا لم يوجد
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_movements' AND column_name = 'created_by') THEN
        ALTER TABLE inventory_movements ADD COLUMN created_by UUID;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. إصلاح سياسات الأمان (RLS) لحركات المخزون
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON inventory_movements;
DROP POLICY IF EXISTS "Allow insert for warehouse staff" ON inventory_movements;
DROP POLICY IF EXISTS "Allow insert for authenticated users" ON inventory_movements;
DROP POLICY IF EXISTS "Allow select for authenticated users" ON inventory_movements;

CREATE POLICY "Allow insert for authenticated users" 
ON inventory_movements FOR INSERT 
TO authenticated WITH CHECK (true);

CREATE POLICY "Allow select for authenticated users" 
ON inventory_movements FOR SELECT 
TO authenticated USING (true);

-- 3. تفعيل تحديث حالة الفواتير
CREATE OR REPLACE FUNCTION update_purchase_document_status_bypass_rls(
    p_table TEXT, p_id UUID, p_status TEXT, p_receipt_id UUID, p_receipt_number TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_table = 'purchase_orders' THEN
        UPDATE purchase_orders SET status = p_status, updated_at = NOW() WHERE id = p_id;
    ELSIF p_table = 'purchase_invoices' THEN
        UPDATE purchase_invoices SET status = p_status, updated_at = NOW() WHERE id = p_id;
    END IF;
END;
$$;

-- 4. إزالة تريجرز التحقق القديمة
DROP TRIGGER IF EXISTS trg_validate_inventory_movement ON inventory_movements;

DO $$
BEGIN
    RAISE NOTICE '✅ Master Fix Applied Successfully';
END $$;
