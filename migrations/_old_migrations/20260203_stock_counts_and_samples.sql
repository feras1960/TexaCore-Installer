-- ═══════════════════════════════════════════════════════════════
-- STOCK COUNTS & SAMPLE REQUESTS - Missing Tables Migration
-- جداول الجرد وطلبات العينات
-- ═══════════════════════════════════════════════════════════════
-- تاريخ: 2 فبراير 2026
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. STOCK COUNTS TABLE (الجرد المخزني)
-- Tracks physical inventory counts and reconciliations
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- رقم الجرد
    count_number VARCHAR(50) NOT NULL,
    
    -- المستودع والموقع
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    location_id UUID REFERENCES warehouse_locations(id),
    
    -- التواريخ
    count_date DATE NOT NULL DEFAULT CURRENT_DATE,
    planned_date DATE,
    completed_date DATE,
    
    -- نوع الجرد
    count_type VARCHAR(30) DEFAULT 'full',
    -- full: جرد كامل
    -- partial: جرد جزئي
    -- cycle: جرد دوري
    -- random: جرد عشوائي
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'planned',
    -- planned: مخطط
    -- in_progress: قيد التنفيذ
    -- completed: مكتمل
    -- cancelled: ملغي
    
    -- الإحصائيات
    total_items INT DEFAULT 0,
    counted_items INT DEFAULT 0,
    match_count INT DEFAULT 0,
    variance_count INT DEFAULT 0,
    
    -- القيم المالية
    total_system_value DECIMAL(18, 4) DEFAULT 0,
    total_actual_value DECIMAL(18, 4) DEFAULT 0,
    variance_value DECIMAL(18, 4) DEFAULT 0,
    
    -- ملاحظات
    notes TEXT,
    
    -- المستخدمين
    created_by UUID REFERENCES auth.users(id),
    completed_by UUID REFERENCES auth.users(id),
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    
    -- التوقيتات
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, count_number)
);

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_stock_counts_tenant ON stock_counts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_company ON stock_counts(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_warehouse ON stock_counts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_status ON stock_counts(status);
CREATE INDEX IF NOT EXISTS idx_stock_counts_date ON stock_counts(count_date);
CREATE INDEX IF NOT EXISTS idx_stock_counts_type ON stock_counts(count_type);

-- RLS Policy
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_counts_tenant_isolation ON stock_counts;
CREATE POLICY stock_counts_tenant_isolation ON stock_counts
    FOR ALL USING (tenant_id = get_current_tenant_id());

COMMENT ON TABLE stock_counts IS 'جداول الجرد المخزني - Stock Counts';

-- ═══════════════════════════════════════════════════════════════
-- 2. STOCK COUNT ITEMS TABLE (بنود الجرد)
-- Individual items being counted in a stock count
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_count_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_count_id UUID NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
    
    -- العنصر المراد جرده (أحدهم مطلوب)
    roll_id UUID REFERENCES fabric_rolls(id),
    product_id UUID REFERENCES products(id),
    material_id UUID REFERENCES fabric_materials(id),
    batch_id UUID REFERENCES inventory_batches(id),
    
    -- الموقع
    location_id UUID REFERENCES warehouse_locations(id),
    
    -- الكميات
    system_quantity DECIMAL(15,3) NOT NULL DEFAULT 0,    -- الكمية في النظام
    actual_quantity DECIMAL(15,3),                        -- الكمية الفعلية (يُدخلها الموظف)
    variance DECIMAL(15,3) GENERATED ALWAYS AS (COALESCE(actual_quantity, 0) - system_quantity) STORED,
    
    -- القيم
    unit_cost DECIMAL(15,4) DEFAULT 0,
    system_value DECIMAL(18,4) GENERATED ALWAYS AS (system_quantity * COALESCE(unit_cost, 0)) STORED,
    actual_value DECIMAL(18,4) GENERATED ALWAYS AS (COALESCE(actual_quantity, 0) * COALESCE(unit_cost, 0)) STORED,
    
    -- حالة العد
    is_counted BOOLEAN DEFAULT FALSE,
    counted_at TIMESTAMPTZ,
    counted_by UUID REFERENCES auth.users(id),
    
    -- ملاحظات
    notes TEXT,
    variance_reason VARCHAR(100), -- damaged, theft, error, found, other
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(stock_count_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_roll ON stock_count_items(roll_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_product ON stock_count_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_material ON stock_count_items(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_counted ON stock_count_items(is_counted);

-- RLS Policy
ALTER TABLE stock_count_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_count_items_tenant_isolation ON stock_count_items;
CREATE POLICY stock_count_items_tenant_isolation ON stock_count_items
    FOR ALL USING (
        stock_count_id IN (
            SELECT id FROM stock_counts 
            WHERE tenant_id = get_current_tenant_id()
        )
    );

COMMENT ON TABLE stock_count_items IS 'بنود الجرد - Stock Count Items';

-- ═══════════════════════════════════════════════════════════════
-- 3. SAMPLE REQUESTS TABLE (طلبات العينات)
-- Requests for fabric samples to be cut
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sample_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- رقم الطلب
    request_number VARCHAR(50) NOT NULL,
    
    -- المصدر
    roll_id UUID REFERENCES fabric_rolls(id),
    material_id UUID REFERENCES fabric_materials(id),
    warehouse_id UUID REFERENCES warehouses(id),
    
    -- التاريخ
    request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- الكميات
    requested_length DECIMAL(10,2) NOT NULL,
    actual_length DECIMAL(10,2),
    
    -- العميل
    requested_by VARCHAR(200),
    customer_id UUID REFERENCES customers(id),
    customer_name VARCHAR(200),
    branch_id UUID REFERENCES branches(id),
    
    -- التفاصيل
    purpose TEXT,
    priority VARCHAR(20) DEFAULT 'normal',
    -- low, normal, high, urgent
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'pending',
    -- pending: قيد الانتظار
    -- approved: معتمد
    -- cutting: قيد القص
    -- ready: جاهز
    -- distributed: تم التوزيع
    -- cancelled: ملغي
    
    -- مراحل المعالجة
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    cut_by UUID REFERENCES auth.users(id),
    cut_at TIMESTAMPTZ,
    distributed_by UUID REFERENCES auth.users(id),
    distributed_at TIMESTAMPTZ,
    
    -- ملاحظات
    notes TEXT,
    
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, request_number)
);

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_sample_requests_tenant ON sample_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sample_requests_company ON sample_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_sample_requests_roll ON sample_requests(roll_id);
CREATE INDEX IF NOT EXISTS idx_sample_requests_material ON sample_requests(material_id);
CREATE INDEX IF NOT EXISTS idx_sample_requests_customer ON sample_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_sample_requests_status ON sample_requests(status);
CREATE INDEX IF NOT EXISTS idx_sample_requests_date ON sample_requests(request_date);
CREATE INDEX IF NOT EXISTS idx_sample_requests_priority ON sample_requests(priority);

-- RLS Policy
ALTER TABLE sample_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sample_requests_tenant_isolation ON sample_requests;
CREATE POLICY sample_requests_tenant_isolation ON sample_requests
    FOR ALL USING (tenant_id = get_current_tenant_id());

COMMENT ON TABLE sample_requests IS 'طلبات العينات - Sample Requests';

-- ═══════════════════════════════════════════════════════════════
-- 4. HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Generate stock count number
CREATE OR REPLACE FUNCTION generate_stock_count_number(
    p_tenant_id UUID,
    p_prefix VARCHAR DEFAULT 'SC'
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INT;
    v_number VARCHAR(50);
BEGIN
    SELECT COUNT(*) + 1 INTO v_count
    FROM stock_counts
    WHERE tenant_id = p_tenant_id
    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE);
    
    v_number := p_prefix || '-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(v_count::TEXT, 5, '0');
    
    RETURN v_number;
END;
$$;

-- Generate sample request number
CREATE OR REPLACE FUNCTION generate_sample_request_number(
    p_tenant_id UUID,
    p_prefix VARCHAR DEFAULT 'SR'
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INT;
    v_number VARCHAR(50);
BEGIN
    SELECT COUNT(*) + 1 INTO v_count
    FROM sample_requests
    WHERE tenant_id = p_tenant_id
    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE);
    
    v_number := p_prefix || '-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(v_count::TEXT, 5, '0');
    
    RETURN v_number;
END;
$$;

-- Complete stock count and adjust inventory
CREATE OR REPLACE FUNCTION complete_stock_count(
    p_stock_count_id UUID,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count_record stock_counts%ROWTYPE;
    v_total_items INT := 0;
    v_counted_items INT := 0;
    v_match_count INT := 0;
    v_variance_count INT := 0;
BEGIN
    -- Get stock count
    SELECT * INTO v_count_record
    FROM stock_counts
    WHERE id = p_stock_count_id;
    
    IF v_count_record IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Stock count not found');
    END IF;
    
    IF v_count_record.status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Stock count already completed');
    END IF;
    
    -- Calculate stats
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE is_counted = true),
        COUNT(*) FILTER (WHERE is_counted = true AND variance = 0),
        COUNT(*) FILTER (WHERE is_counted = true AND variance != 0)
    INTO v_total_items, v_counted_items, v_match_count, v_variance_count
    FROM stock_count_items
    WHERE stock_count_id = p_stock_count_id;
    
    -- Update stock count
    UPDATE stock_counts SET
        status = 'completed',
        completed_date = CURRENT_DATE,
        completed_by = p_user_id,
        total_items = v_total_items,
        counted_items = v_counted_items,
        match_count = v_match_count,
        variance_count = v_variance_count,
        updated_at = NOW()
    WHERE id = p_stock_count_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Stock count completed',
        'stats', jsonb_build_object(
            'total_items', v_total_items,
            'counted_items', v_counted_items,
            'match_count', v_match_count,
            'variance_count', v_variance_count
        )
    );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 5. TRIGGERS
-- ═══════════════════════════════════════════════════════════════

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_stock_counts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_stock_counts_updated ON stock_counts;
CREATE TRIGGER tr_stock_counts_updated
    BEFORE UPDATE ON stock_counts
    FOR EACH ROW
    EXECUTE FUNCTION update_stock_counts_timestamp();

DROP TRIGGER IF EXISTS tr_sample_requests_updated ON sample_requests;
CREATE TRIGGER tr_sample_requests_updated
    BEFORE UPDATE ON sample_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_stock_counts_timestamp();

-- ═══════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════

SELECT 'Stock Counts and Sample Requests tables created successfully!' as status;
