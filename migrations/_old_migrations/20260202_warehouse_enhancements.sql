-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 100: Warehouse Enhancements - Delivery Notes & Settings (STANDALONE)
-- تحسينات المستودعات - إذونات التسليم والإعدادات (مستقل)
-- ═══════════════════════════════════════════════════════════════════════════
-- التاريخ: 2 فبراير 2026
-- الوصف: إضافة جداول إذونات التسليم وإعدادات المستودعات
-- ملاحظة: هذا الملف مستقل ولا يعتمد على جداول خارجية
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- PART 1: إذونات التسليم (Delivery Notes) - بدون Foreign Keys خارجية
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS delivery_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    branch_id UUID,
    
    -- رقم الإذن والتاريخ
    note_number VARCHAR(50) NOT NULL,
    note_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- الربط بأمر البيع (UUID فقط، بدون FK)
    sales_order_id UUID,
    
    -- العميل (UUID فقط)
    customer_id UUID NOT NULL,
    customer_name VARCHAR(200),
    customer_phone VARCHAR(50),
    
    -- المستودع (UUID فقط)
    warehouse_id UUID NOT NULL,
    
    -- طريقة التسليم
    delivery_method VARCHAR(30) NOT NULL DEFAULT 'to_store',
    -- to_store: للمحل/الفرع
    -- to_customer_address: لعنوان العميل
    -- direct_from_warehouse: مباشر من المستودع
    
    -- بيانات التسليم
    delivery_address TEXT,
    city VARCHAR(100),
    region VARCHAR(100),
    
    -- السائق
    driver_id UUID,
    driver_name VARCHAR(200),
    vehicle_number VARCHAR(50),
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'draft',
    -- draft: مسودة
    -- pending_approval: بانتظار الموافقة
    -- approved: موافق عليها
    -- preparing: جاري التجهيز
    -- shipped: تم الشحن
    -- delivered: تم التسليم
    -- cancelled: ملغاة
    
    -- نظام الموافقة
    requires_approval BOOLEAN DEFAULT true,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    -- التواريخ
    expected_delivery_date DATE,
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    
    -- التوقيع والاستلام
    receiver_name VARCHAR(200),
    receiver_signature TEXT,
    delivery_confirmation_photo TEXT,
    
    -- المبالغ
    subtotal DECIMAL(15,2) DEFAULT 0,
    shipping_cost DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    
    -- رقم التتبع
    tracking_number VARCHAR(100),
    
    notes TEXT,
    internal_notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    cancel_reason TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, note_number)
);

COMMENT ON TABLE delivery_notes IS 'إذونات التسليم - Delivery Notes for Warehouse Dispatch';

-- ═══════════════════════════════════════════════════════════════
-- PART 2: بنود إذن التسليم (بدون Foreign Keys خارجية)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS delivery_note_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
    
    -- رقم البند
    line_number INT DEFAULT 1,
    
    -- الربط بأمر البيع
    sales_order_item_id UUID,
    
    -- المنتج (UUIDs فقط)
    product_id UUID,
    variant_id UUID,
    
    -- للأقمشة خصيصاً
    material_id UUID,
    color_id UUID,
    roll_id UUID,
    
    -- الوصف
    description TEXT,
    
    -- الكميات
    quantity_ordered DECIMAL(15,3) NOT NULL,
    quantity_to_deliver DECIMAL(15,3) NOT NULL,
    quantity_delivered DECIMAL(15,3) DEFAULT 0,
    
    unit_id UUID,
    
    -- تتبع الدفعات
    batch_id UUID,
    dye_lot VARCHAR(100),
    shade VARCHAR(20),
    
    -- الموقع
    warehouse_id UUID,
    location_id UUID,
    
    -- التكلفة
    unit_cost DECIMAL(15,4) DEFAULT 0,
    line_total DECIMAL(15,2) DEFAULT 0,
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE delivery_note_items IS 'بنود إذن التسليم - Items in Delivery Note';

-- ═══════════════════════════════════════════════════════════════
-- PART 3: إعدادات المستودعات (بدون Foreign Keys خارجية)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS warehouse_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    -- طريقة التكلفة
    costing_method VARCHAR(20) DEFAULT 'fifo',
    
    -- نظام الإخراج
    require_dispatch_approval BOOLEAN DEFAULT true,
    dispatch_approval_roles JSONB DEFAULT '["warehouse_manager"]'::jsonb,
    
    -- إعدادات الحجز
    default_reservation_hours INT DEFAULT 48,
    extended_reservation_hours INT DEFAULT 168,
    deposit_required_for_extended BOOLEAN DEFAULT true,
    min_deposit_percent DECIMAL(5,2) DEFAULT 20,
    auto_cancel_expired_reservations BOOLEAN DEFAULT true,
    
    -- إعدادات Dye Lot
    warn_dye_lot_mismatch BOOLEAN DEFAULT true,
    enforce_same_dye_lot BOOLEAN DEFAULT false,
    
    -- إعدادات المخزون
    allow_negative_stock BOOLEAN DEFAULT false,
    low_stock_threshold_percent DECIMAL(5,2) DEFAULT 20,
    auto_reorder_enabled BOOLEAN DEFAULT false,
    
    -- إعدادات الباركود
    barcode_format VARCHAR(20) DEFAULT 'CODE128',
    auto_generate_roll_barcode BOOLEAN DEFAULT true,
    auto_generate_location_barcode BOOLEAN DEFAULT true,
    
    -- إعدادات الموبايل
    require_location_scan_on_receive BOOLEAN DEFAULT false,
    require_photo_on_receive BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id)
);

COMMENT ON TABLE warehouse_settings IS 'إعدادات المستودعات - Warehouse Configuration';

-- ═══════════════════════════════════════════════════════════════
-- PART 4: الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_delivery_notes_tenant ON delivery_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_company ON delivery_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_customer ON delivery_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_order ON delivery_notes(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_warehouse ON delivery_notes(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_status ON delivery_notes(status);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_date ON delivery_notes(note_date DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_pending ON delivery_notes(tenant_id, status) 
    WHERE status = 'pending_approval';

CREATE INDEX IF NOT EXISTS idx_delivery_items_note ON delivery_note_items(delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_product ON delivery_note_items(product_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_roll ON delivery_note_items(roll_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_batch ON delivery_note_items(batch_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_settings_tenant ON warehouse_settings(tenant_id);

-- ═══════════════════════════════════════════════════════════════
-- PART 5: RLS Policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_note_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_settings ENABLE ROW LEVEL SECURITY;

-- سياسة مفتوحة للمستخدمين المعتمدين
DROP POLICY IF EXISTS allow_authenticated ON delivery_notes;
CREATE POLICY allow_authenticated ON delivery_notes FOR ALL 
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS allow_authenticated ON delivery_note_items;
CREATE POLICY allow_authenticated ON delivery_note_items FOR ALL 
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS allow_authenticated ON warehouse_settings;
CREATE POLICY allow_authenticated ON warehouse_settings FOR ALL 
    TO authenticated
    USING (true);

-- ═══════════════════════════════════════════════════════════════
-- PART 6: Trigger للتحديث التلقائي
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_delivery_notes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delivery_notes_updated_at ON delivery_notes;
CREATE TRIGGER trg_delivery_notes_updated_at
    BEFORE UPDATE ON delivery_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_delivery_notes_timestamp();

CREATE OR REPLACE FUNCTION update_warehouse_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_warehouse_settings_updated_at ON warehouse_settings;
CREATE TRIGGER trg_warehouse_settings_updated_at
    BEFORE UPDATE ON warehouse_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_warehouse_settings_timestamp();

-- ═══════════════════════════════════════════════════════════════
-- PART 7: دوال مساعدة
-- ═══════════════════════════════════════════════════════════════

-- دالة إنشاء رقم إذن تسليم تلقائي
CREATE OR REPLACE FUNCTION generate_delivery_note_number(
    p_tenant_id UUID,
    p_company_id UUID
)
RETURNS VARCHAR(50) AS $$
DECLARE
    v_prefix VARCHAR(10) := 'DN';
    v_year VARCHAR(4) := TO_CHAR(CURRENT_DATE, 'YYYY');
    v_sequence INT;
    v_number VARCHAR(50);
BEGIN
    SELECT COALESCE(MAX(
        CAST(NULLIF(REGEXP_REPLACE(note_number, '[^0-9]', '', 'g'), '') AS INT)
    ), 0) + 1 INTO v_sequence
    FROM delivery_notes
    WHERE tenant_id = p_tenant_id
    AND EXTRACT(YEAR FROM note_date) = EXTRACT(YEAR FROM CURRENT_DATE);
    
    v_number := v_prefix || '-' || v_year || '-' || LPAD(v_sequence::TEXT, 6, '0');
    
    RETURN v_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة الموافقة على إذن التسليم
CREATE OR REPLACE FUNCTION approve_delivery_note(
    p_note_id UUID,
    p_approved_by UUID
)
RETURNS JSONB AS $$
DECLARE
    v_note RECORD;
BEGIN
    SELECT * INTO v_note FROM delivery_notes WHERE id = p_note_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery note not found');
    END IF;
    
    IF v_note.status != 'pending_approval' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Note is not pending approval');
    END IF;
    
    UPDATE delivery_notes
    SET 
        status = 'approved',
        approved_by = p_approved_by,
        approved_at = NOW()
    WHERE id = p_note_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'note_id', p_note_id,
        'status', 'approved'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة تأكيد التسليم
CREATE OR REPLACE FUNCTION confirm_delivery(
    p_note_id UUID,
    p_receiver_name VARCHAR DEFAULT NULL,
    p_signature TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    UPDATE delivery_notes
    SET 
        status = 'delivered',
        delivered_at = NOW(),
        receiver_name = COALESCE(p_receiver_name, receiver_name),
        receiver_signature = COALESCE(p_signature, receiver_signature)
    WHERE id = p_note_id;
    
    UPDATE delivery_note_items
    SET quantity_delivered = quantity_to_deliver
    WHERE delivery_note_id = p_note_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'note_id', p_note_id,
        'status', 'delivered'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة الحصول على إعدادات المستودع
CREATE OR REPLACE FUNCTION get_warehouse_settings(
    p_tenant_id UUID,
    p_company_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_settings RECORD;
BEGIN
    SELECT * INTO v_settings
    FROM warehouse_settings
    WHERE tenant_id = p_tenant_id
    AND company_id = p_company_id
    LIMIT 1;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'costing_method', 'fifo',
            'require_dispatch_approval', true,
            'default_reservation_hours', 48,
            'allow_negative_stock', false,
            'warn_dye_lot_mismatch', true
        );
    END IF;
    
    RETURN to_jsonb(v_settings);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════
-- PART 8: التحقق النهائي
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_table TEXT;
    v_exists BOOLEAN;
    v_tables TEXT[] := ARRAY[
        'delivery_notes',
        'delivery_note_items',
        'warehouse_settings'
    ];
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ Warehouse Enhancements - تحسينات المستودعات';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    
    FOREACH v_table IN ARRAY v_tables
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = v_table
        ) INTO v_exists;
        
        IF v_exists THEN
            RAISE NOTICE '  ✅ %', v_table;
        ELSE
            RAISE NOTICE '  ❌ % - غير موجود', v_table;
        END IF;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;
