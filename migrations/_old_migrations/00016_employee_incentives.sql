-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00016: نظام الحوافز والعمولات
-- Employee Incentives and Commissions System
-- ═══════════════════════════════════════════════════════════════════════════
-- المحتويات:
-- 1. جدول خطط الحوافز
-- 2. جدول تعيينات الموظفين للخطط
-- 3. جدول عمولات الموظفين
-- 4. جدول أهداف الموظفين
-- 5. جدول سجل تحقيق الأهداف
-- 6. Triggers لحساب العمولات تلقائياً
-- 7. Functions للتقارير والإحصائيات
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. جدول خطط الحوافز
-- Incentive Plans Table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS incentive_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- معلومات الخطة
    plan_code VARCHAR(50) NOT NULL,
    plan_name VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- نوع الخطة
    plan_type VARCHAR(30) NOT NULL DEFAULT 'commission',
    -- commission (عمولة على المبيعات)
    -- bonus (مكافأة على تحقيق هدف)
    -- tiered (درجات متصاعدة)
    -- mixed (مختلط)
    
    -- الفئة المستهدفة
    target_type VARCHAR(30) DEFAULT 'sales',
    -- sales (مبيعات)
    -- collections (تحصيلات)
    -- new_customers (عملاء جدد)
    -- profit (أرباح)
    -- mixed (مختلط)
    
    -- طريقة الحساب
    calculation_method VARCHAR(30) NOT NULL DEFAULT 'percentage',
    -- percentage (نسبة مئوية)
    -- fixed_per_unit (مبلغ ثابت لكل وحدة)
    -- tiered (حسب الدرجات)
    -- slab (شرائح)
    
    -- قيم الحساب
    base_rate DECIMAL(10,4) DEFAULT 0,        -- النسبة الأساسية أو المبلغ
    min_threshold DECIMAL(15,2) DEFAULT 0,     -- الحد الأدنى للتطبيق
    max_cap DECIMAL(15,2),                     -- الحد الأقصى للعمولة
    
    -- الفترة
    period_type VARCHAR(20) DEFAULT 'monthly',
    -- daily, weekly, monthly, quarterly, yearly
    
    -- تواريخ السريان
    effective_from DATE NOT NULL,
    effective_to DATE,
    
    -- الحالة
    is_active BOOLEAN DEFAULT true,
    
    -- إعدادات إضافية
    include_returns BOOLEAN DEFAULT false,     -- هل يشمل المرتجعات؟
    include_discounts BOOLEAN DEFAULT true,    -- هل يشمل الخصومات؟
    min_collection_percent DECIMAL(5,2),       -- الحد الأدنى للتحصيل
    
    -- ملاحظات
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, plan_code)
);

-- الدرجات المتصاعدة للخطط من نوع tiered أو slab
CREATE TABLE IF NOT EXISTS incentive_plan_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES incentive_plans(id) ON DELETE CASCADE,
    
    tier_number INT NOT NULL,
    
    -- نطاق الدرجة
    from_amount DECIMAL(15,2) NOT NULL,
    to_amount DECIMAL(15,2),                   -- NULL = بدون حد
    
    -- معدل الدرجة
    rate DECIMAL(10,4) NOT NULL,               -- نسبة أو مبلغ
    rate_type VARCHAR(20) DEFAULT 'percentage', -- percentage, fixed
    
    -- مكافأة إضافية عند تجاوز الدرجة
    bonus_amount DECIMAL(15,2) DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(plan_id, tier_number)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_incentive_plans_company ON incentive_plans(company_id);
CREATE INDEX IF NOT EXISTS idx_incentive_plans_type ON incentive_plans(plan_type);
CREATE INDEX IF NOT EXISTS idx_incentive_plans_active ON incentive_plans(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_incentive_plan_tiers_plan ON incentive_plan_tiers(plan_id);

-- RLS
ALTER TABLE incentive_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_plan_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated users - incentive_plans" ON incentive_plans
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for authenticated users - incentive_plan_tiers" ON incentive_plan_tiers
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE incentive_plans IS 'خطط الحوافز والعمولات - تحدد قواعد حساب العمولات';
COMMENT ON TABLE incentive_plan_tiers IS 'درجات خطط الحوافز - للخطط المتدرجة';

-- ═══════════════════════════════════════════════════════════════
-- 2. جدول تعيينات الموظفين للخطط
-- Employee Plan Assignments
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_incentive_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    employee_id UUID NOT NULL,                  -- ربط مع جدول الموظفين
    plan_id UUID NOT NULL REFERENCES incentive_plans(id) ON DELETE CASCADE,
    
    -- تعديلات خاصة بالموظف
    custom_rate DECIMAL(10,4),                  -- معدل مخصص (يتجاوز معدل الخطة)
    custom_cap DECIMAL(15,2),                   -- حد أقصى مخصص
    
    -- الأهداف الفردية
    target_amount DECIMAL(15,2),               -- هدف المبلغ
    target_units INT,                          -- هدف الوحدات
    
    -- فترة التعيين
    start_date DATE NOT NULL,
    end_date DATE,
    
    -- الحالة
    is_active BOOLEAN DEFAULT true,
    
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- منع التكرار
    UNIQUE(tenant_id, employee_id, plan_id, start_date)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_employee_assignments_employee ON employee_incentive_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_plan ON employee_incentive_assignments(plan_id);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_active ON employee_incentive_assignments(is_active, start_date, end_date);

-- RLS
ALTER TABLE employee_incentive_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users - employee_incentive_assignments" ON employee_incentive_assignments
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE employee_incentive_assignments IS 'تعيين الموظفين لخطط الحوافز';

-- ═══════════════════════════════════════════════════════════════
-- 3. جدول عمولات الموظفين
-- Employee Commissions Table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    employee_id UUID NOT NULL,
    assignment_id UUID REFERENCES employee_incentive_assignments(id),
    plan_id UUID REFERENCES incentive_plans(id),
    
    -- فترة العمولة
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- المصدر
    source_type VARCHAR(50) NOT NULL,
    -- sales_invoice, payment_receipt, target_achievement, bonus, manual
    source_id UUID,
    source_number VARCHAR(100),
    
    -- المبالغ
    base_amount DECIMAL(15,2) NOT NULL,        -- المبلغ الأساسي (قيمة المبيعات مثلاً)
    rate_applied DECIMAL(10,4),                 -- المعدل المطبق
    commission_amount DECIMAL(15,2) NOT NULL,   -- مبلغ العمولة
    
    -- التفاصيل
    tier_number INT,                            -- الدرجة المطبقة إن وجدت
    bonus_amount DECIMAL(15,2) DEFAULT 0,       -- مكافأة إضافية
    
    -- التعديلات
    adjustment_amount DECIMAL(15,2) DEFAULT 0,  -- تعديلات يدوية
    adjustment_reason TEXT,
    
    -- المبلغ النهائي
    net_amount DECIMAL(15,2) NOT NULL,
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'calculated',
    -- calculated, approved, paid, cancelled
    
    -- الموافقة
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    
    -- الصرف
    paid_at TIMESTAMPTZ,
    payment_reference VARCHAR(100),
    journal_entry_id UUID REFERENCES journal_entries(id),
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_employee_commissions_employee ON employee_commissions(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_commissions_period ON employee_commissions(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_employee_commissions_status ON employee_commissions(status);
CREATE INDEX IF NOT EXISTS idx_employee_commissions_source ON employee_commissions(source_type, source_id);

-- RLS
ALTER TABLE employee_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users - employee_commissions" ON employee_commissions
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE employee_commissions IS 'سجل عمولات الموظفين - تفاصيل كل عمولة';

-- ═══════════════════════════════════════════════════════════════
-- 4. جدول أهداف الموظفين
-- Employee Targets Table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    employee_id UUID NOT NULL,
    
    -- نوع الهدف
    target_type VARCHAR(30) NOT NULL,
    -- sales_amount, sales_units, new_customers, collections, profit
    
    -- فترة الهدف
    period_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
    period_year INT NOT NULL,
    period_month INT,                          -- للأهداف الشهرية
    period_quarter INT,                        -- للأهداف الربعية
    
    -- قيم الهدف
    target_amount DECIMAL(15,2),
    target_units INT,
    target_count INT,                          -- للعدد (عملاء جدد مثلاً)
    
    -- الإنجاز الفعلي
    achieved_amount DECIMAL(15,2) DEFAULT 0,
    achieved_units INT DEFAULT 0,
    achieved_count INT DEFAULT 0,
    
    -- نسبة الإنجاز
    achievement_percentage DECIMAL(5,2) DEFAULT 0,
    
    -- المكافأة عند تحقيق الهدف
    bonus_on_achievement DECIMAL(15,2) DEFAULT 0,
    bonus_on_exceed DECIMAL(10,4) DEFAULT 0,   -- نسبة إضافية عند التجاوز
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'active',
    -- active, achieved, partial, failed, cancelled
    
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, employee_id, target_type, period_year, period_month, period_quarter)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_employee_targets_employee ON employee_targets(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_targets_period ON employee_targets(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_employee_targets_type ON employee_targets(target_type);
CREATE INDEX IF NOT EXISTS idx_employee_targets_status ON employee_targets(status);

-- RLS
ALTER TABLE employee_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users - employee_targets" ON employee_targets
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE employee_targets IS 'أهداف الموظفين - المبيعات والتحصيلات وغيرها';

-- ═══════════════════════════════════════════════════════════════
-- 5. جدول سجل تحقيق الأهداف
-- Target Achievement Log
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS target_achievement_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    target_id UUID NOT NULL REFERENCES employee_targets(id) ON DELETE CASCADE,
    
    -- المصدر
    source_type VARCHAR(50) NOT NULL,
    source_id UUID,
    source_number VARCHAR(100),
    source_date DATE NOT NULL,
    
    -- القيم
    amount DECIMAL(15,2) DEFAULT 0,
    units INT DEFAULT 0,
    count_value INT DEFAULT 0,
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_target_achievement_target ON target_achievement_log(target_id);
CREATE INDEX IF NOT EXISTS idx_target_achievement_source ON target_achievement_log(source_type, source_id);

-- RLS
ALTER TABLE target_achievement_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users - target_achievement_log" ON target_achievement_log
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE target_achievement_log IS 'سجل تفصيلي لتحقيق الأهداف';

-- ═══════════════════════════════════════════════════════════════
-- 6. دالة حساب العمولة من فاتورة مبيعات
-- Calculate Commission from Sales Invoice
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calculate_sales_commission(
    p_invoice_id UUID,
    p_employee_id UUID DEFAULT NULL
)
RETURNS TABLE(
    employee_id UUID,
    plan_id UUID,
    commission_amount DECIMAL(15,2),
    tier_applied INT,
    base_amount DECIMAL(15,2),
    rate_applied DECIMAL(10,4)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice RECORD;
    v_assignment RECORD;
    v_plan RECORD;
    v_tier RECORD;
    v_base_amount DECIMAL(15,2);
    v_commission DECIMAL(15,2);
    v_rate DECIMAL(10,4);
    v_tier_num INT;
BEGIN
    -- الحصول على معلومات الفاتورة
    SELECT i.*, 
           i.total_amount as invoice_total,
           i.salesperson_id,
           i.company_id,
           i.tenant_id
    INTO v_invoice
    FROM invoices i
    WHERE i.id = p_invoice_id;
    
    IF v_invoice IS NULL THEN
        RETURN;
    END IF;
    
    -- تحديد الموظف (من الفاتورة أو المُمرر)
    IF p_employee_id IS NULL THEN
        p_employee_id := v_invoice.salesperson_id;
    END IF;
    
    IF p_employee_id IS NULL THEN
        RETURN;
    END IF;
    
    -- البحث عن خطط الحوافز المفعلة للموظف
    FOR v_assignment IN 
        SELECT ea.*, ip.*,
               COALESCE(ea.custom_rate, ip.base_rate) as effective_rate,
               COALESCE(ea.custom_cap, ip.max_cap) as effective_cap
        FROM employee_incentive_assignments ea
        JOIN incentive_plans ip ON ip.id = ea.plan_id
        WHERE ea.employee_id = p_employee_id
          AND ea.is_active = true
          AND ea.company_id = v_invoice.company_id
          AND ip.is_active = true
          AND ip.target_type IN ('sales', 'mixed')
          AND v_invoice.invoice_date BETWEEN ea.start_date AND COALESCE(ea.end_date, '9999-12-31')
          AND v_invoice.invoice_date BETWEEN ip.effective_from AND COALESCE(ip.effective_to, '9999-12-31')
    LOOP
        -- حساب المبلغ الأساسي
        v_base_amount := v_invoice.invoice_total;
        
        -- خصم الضريبة إذا لم تكن مشمولة
        IF NOT v_assignment.include_discounts THEN
            v_base_amount := v_base_amount - COALESCE(v_invoice.discount_amount, 0);
        END IF;
        
        -- التحقق من الحد الأدنى
        IF v_base_amount < v_assignment.min_threshold THEN
            CONTINUE;
        END IF;
        
        v_commission := 0;
        v_tier_num := NULL;
        v_rate := v_assignment.effective_rate;
        
        -- حساب العمولة حسب طريقة الحساب
        CASE v_assignment.calculation_method
            WHEN 'percentage' THEN
                v_commission := v_base_amount * v_rate / 100;
                
            WHEN 'fixed_per_unit' THEN
                -- يحتاج عدد الوحدات من الفاتورة
                SELECT COALESCE(SUM(quantity), 0) INTO v_commission
                FROM invoice_items WHERE invoice_id = p_invoice_id;
                v_commission := v_commission * v_rate;
                
            WHEN 'tiered', 'slab' THEN
                -- البحث عن الدرجة المناسبة
                SELECT * INTO v_tier
                FROM incentive_plan_tiers
                WHERE plan_id = v_assignment.plan_id
                  AND from_amount <= v_base_amount
                  AND (to_amount IS NULL OR to_amount >= v_base_amount)
                ORDER BY tier_number DESC
                LIMIT 1;
                
                IF v_tier IS NOT NULL THEN
                    v_tier_num := v_tier.tier_number;
                    IF v_tier.rate_type = 'percentage' THEN
                        v_commission := v_base_amount * v_tier.rate / 100;
                    ELSE
                        v_commission := v_tier.rate;
                    END IF;
                    v_commission := v_commission + v_tier.bonus_amount;
                    v_rate := v_tier.rate;
                END IF;
                
            ELSE
                v_commission := v_base_amount * v_rate / 100;
        END CASE;
        
        -- تطبيق الحد الأقصى
        IF v_assignment.effective_cap IS NOT NULL AND v_commission > v_assignment.effective_cap THEN
            v_commission := v_assignment.effective_cap;
        END IF;
        
        -- إرجاع النتيجة
        employee_id := p_employee_id;
        plan_id := v_assignment.plan_id;
        commission_amount := v_commission;
        tier_applied := v_tier_num;
        base_amount := v_base_amount;
        rate_applied := v_rate;
        
        RETURN NEXT;
    END LOOP;
    
    RETURN;
END;
$$;

COMMENT ON FUNCTION calculate_sales_commission(UUID, UUID) IS 'حساب عمولة الموظف من فاتورة مبيعات';

-- ═══════════════════════════════════════════════════════════════
-- 7. Trigger لإنشاء عمولة تلقائية عند ترحيل فاتورة
-- Auto-create Commission on Invoice Post
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_calculate_invoice_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_commission RECORD;
    v_period_start DATE;
    v_period_end DATE;
BEGIN
    -- فقط عند ترحيل الفاتورة
    IF NEW.status = 'posted' AND (OLD.status IS NULL OR OLD.status != 'posted') THEN
        -- تحديد فترة العمولة (الشهر الحالي)
        v_period_start := DATE_TRUNC('month', NEW.invoice_date)::DATE;
        v_period_end := (DATE_TRUNC('month', NEW.invoice_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
        
        -- حساب وإنشاء العمولات
        FOR v_commission IN 
            SELECT * FROM calculate_sales_commission(NEW.id, NEW.salesperson_id)
        LOOP
            INSERT INTO employee_commissions (
                tenant_id, company_id,
                employee_id, plan_id,
                period_start, period_end,
                source_type, source_id, source_number,
                base_amount, rate_applied, commission_amount,
                tier_number, net_amount,
                status
            )
            VALUES (
                NEW.tenant_id, NEW.company_id,
                v_commission.employee_id, v_commission.plan_id,
                v_period_start, v_period_end,
                'sales_invoice', NEW.id, NEW.invoice_number,
                v_commission.base_amount, v_commission.rate_applied, v_commission.commission_amount,
                v_commission.tier_applied, v_commission.commission_amount,
                'calculated'
            );
        END LOOP;
    END IF;
    
    RETURN NEW;
END;
$$;

-- تفعيل الـ Trigger (معلق - يُفعل حسب الحاجة)
-- DROP TRIGGER IF EXISTS trg_auto_calculate_invoice_commission ON invoices;
-- CREATE TRIGGER trg_auto_calculate_invoice_commission
--     AFTER UPDATE ON invoices
--     FOR EACH ROW
--     EXECUTE FUNCTION auto_calculate_invoice_commission();

COMMENT ON FUNCTION auto_calculate_invoice_commission() IS 'حساب العمولة تلقائياً عند ترحيل الفاتورة';

-- ═══════════════════════════════════════════════════════════════
-- 8. دالة تحديث إنجاز الأهداف
-- Update Target Achievement
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_employee_target_achievement(
    p_employee_id UUID,
    p_target_type VARCHAR(30),
    p_amount DECIMAL(15,2) DEFAULT 0,
    p_units INT DEFAULT 0,
    p_count INT DEFAULT 0,
    p_source_type VARCHAR(50) DEFAULT NULL,
    p_source_id UUID DEFAULT NULL,
    p_source_number VARCHAR(100) DEFAULT NULL,
    p_source_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_target_id UUID;
    v_target RECORD;
    v_new_achieved_amount DECIMAL(15,2);
    v_new_achieved_units INT;
    v_new_achieved_count INT;
    v_achievement_pct DECIMAL(5,2);
BEGIN
    -- البحث عن الهدف الحالي
    SELECT * INTO v_target
    FROM employee_targets
    WHERE employee_id = p_employee_id
      AND target_type = p_target_type
      AND status = 'active'
      AND period_year = EXTRACT(YEAR FROM p_source_date)
      AND (
          (period_type = 'monthly' AND period_month = EXTRACT(MONTH FROM p_source_date))
          OR (period_type = 'quarterly' AND period_quarter = CEIL(EXTRACT(MONTH FROM p_source_date) / 3.0))
          OR (period_type = 'yearly' AND period_month IS NULL AND period_quarter IS NULL)
      )
    LIMIT 1;
    
    IF v_target IS NULL THEN
        RETURN NULL;
    END IF;
    
    v_target_id := v_target.id;
    
    -- تسجيل في سجل الإنجاز
    INSERT INTO target_achievement_log (
        tenant_id, target_id,
        source_type, source_id, source_number, source_date,
        amount, units, count_value
    )
    VALUES (
        v_target.tenant_id, v_target_id,
        p_source_type, p_source_id, p_source_number, p_source_date,
        p_amount, p_units, p_count
    );
    
    -- حساب الإنجاز الجديد
    v_new_achieved_amount := COALESCE(v_target.achieved_amount, 0) + p_amount;
    v_new_achieved_units := COALESCE(v_target.achieved_units, 0) + p_units;
    v_new_achieved_count := COALESCE(v_target.achieved_count, 0) + p_count;
    
    -- حساب نسبة الإنجاز
    IF v_target.target_amount > 0 THEN
        v_achievement_pct := (v_new_achieved_amount / v_target.target_amount) * 100;
    ELSIF v_target.target_units > 0 THEN
        v_achievement_pct := (v_new_achieved_units::DECIMAL / v_target.target_units) * 100;
    ELSIF v_target.target_count > 0 THEN
        v_achievement_pct := (v_new_achieved_count::DECIMAL / v_target.target_count) * 100;
    ELSE
        v_achievement_pct := 0;
    END IF;
    
    -- تحديث الهدف
    UPDATE employee_targets
    SET achieved_amount = v_new_achieved_amount,
        achieved_units = v_new_achieved_units,
        achieved_count = v_new_achieved_count,
        achievement_percentage = LEAST(v_achievement_pct, 999.99),
        status = CASE 
            WHEN v_achievement_pct >= 100 THEN 'achieved'
            WHEN v_achievement_pct > 0 THEN 'partial'
            ELSE 'active'
        END,
        updated_at = NOW()
    WHERE id = v_target_id;
    
    RETURN v_target_id;
END;
$$;

COMMENT ON FUNCTION update_employee_target_achievement IS 'تحديث إنجاز هدف الموظف';

-- ═══════════════════════════════════════════════════════════════
-- 9. دالة تقرير عمولات الموظف
-- Employee Commission Report
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_employee_commission_report(
    p_company_id UUID,
    p_from_date DATE,
    p_to_date DATE,
    p_employee_id UUID DEFAULT NULL
)
RETURNS TABLE(
    employee_id UUID,
    employee_name VARCHAR,
    total_sales DECIMAL(15,2),
    total_commission DECIMAL(15,2),
    total_bonus DECIMAL(15,2),
    net_commission DECIMAL(15,2),
    invoice_count INT,
    avg_commission_rate DECIMAL(10,4),
    status_summary JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ec.employee_id,
        'موظف'::VARCHAR as employee_name, -- يمكن ربطه بجدول الموظفين
        COALESCE(SUM(ec.base_amount), 0)::DECIMAL(15,2) as total_sales,
        COALESCE(SUM(ec.commission_amount), 0)::DECIMAL(15,2) as total_commission,
        COALESCE(SUM(ec.bonus_amount), 0)::DECIMAL(15,2) as total_bonus,
        COALESCE(SUM(ec.net_amount), 0)::DECIMAL(15,2) as net_commission,
        COUNT(DISTINCT ec.source_id)::INT as invoice_count,
        CASE 
            WHEN SUM(ec.base_amount) > 0 
            THEN (SUM(ec.commission_amount) / SUM(ec.base_amount) * 100)::DECIMAL(10,4)
            ELSE 0 
        END as avg_commission_rate,
        jsonb_build_object(
            'calculated', COUNT(*) FILTER (WHERE ec.status = 'calculated'),
            'approved', COUNT(*) FILTER (WHERE ec.status = 'approved'),
            'paid', COUNT(*) FILTER (WHERE ec.status = 'paid'),
            'cancelled', COUNT(*) FILTER (WHERE ec.status = 'cancelled')
        ) as status_summary
    FROM employee_commissions ec
    WHERE ec.company_id = p_company_id
      AND ec.period_start >= p_from_date
      AND ec.period_end <= p_to_date
      AND (p_employee_id IS NULL OR ec.employee_id = p_employee_id)
    GROUP BY ec.employee_id
    ORDER BY net_commission DESC;
END;
$$;

COMMENT ON FUNCTION get_employee_commission_report IS 'تقرير عمولات الموظفين';

-- ═══════════════════════════════════════════════════════════════
-- 10. دالة تقرير تحقيق الأهداف
-- Target Achievement Report
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_target_achievement_report(
    p_company_id UUID,
    p_period_year INT,
    p_period_month INT DEFAULT NULL,
    p_employee_id UUID DEFAULT NULL
)
RETURNS TABLE(
    employee_id UUID,
    target_type VARCHAR(30),
    target_amount DECIMAL(15,2),
    achieved_amount DECIMAL(15,2),
    achievement_percentage DECIMAL(5,2),
    remaining_amount DECIMAL(15,2),
    bonus_earned DECIMAL(15,2),
    status VARCHAR(20)
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        et.employee_id,
        et.target_type,
        et.target_amount,
        et.achieved_amount,
        et.achievement_percentage,
        GREATEST(et.target_amount - et.achieved_amount, 0)::DECIMAL(15,2) as remaining_amount,
        CASE 
            WHEN et.achievement_percentage >= 100 THEN et.bonus_on_achievement
            ELSE 0
        END + 
        CASE 
            WHEN et.achievement_percentage > 100 
            THEN (et.achieved_amount - et.target_amount) * et.bonus_on_exceed / 100
            ELSE 0
        END as bonus_earned,
        et.status
    FROM employee_targets et
    WHERE et.company_id = p_company_id
      AND et.period_year = p_period_year
      AND (p_period_month IS NULL OR et.period_month = p_period_month)
      AND (p_employee_id IS NULL OR et.employee_id = p_employee_id)
    ORDER BY et.employee_id, et.target_type;
END;
$$;

COMMENT ON FUNCTION get_target_achievement_report IS 'تقرير تحقيق الأهداف';

-- ═══════════════════════════════════════════════════════════════
-- 11. دالة إنشاء أهداف شهرية للموظفين
-- Create Monthly Targets for Employees
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_monthly_targets(
    p_company_id UUID,
    p_year INT,
    p_month INT,
    p_copy_from_previous BOOLEAN DEFAULT true
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_assignment RECORD;
    v_prev_target RECORD;
    v_created INT := 0;
    v_tenant_id UUID;
BEGIN
    -- الحصول على tenant_id
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    
    -- لكل موظف لديه تعيين نشط
    FOR v_assignment IN 
        SELECT DISTINCT ea.employee_id, ea.tenant_id, ea.target_amount
        FROM employee_incentive_assignments ea
        WHERE ea.company_id = p_company_id
          AND ea.is_active = true
          AND MAKE_DATE(p_year, p_month, 1) BETWEEN ea.start_date AND COALESCE(ea.end_date, '9999-12-31')
    LOOP
        -- التحقق من عدم وجود هدف مسبق
        IF NOT EXISTS (
            SELECT 1 FROM employee_targets
            WHERE employee_id = v_assignment.employee_id
              AND period_year = p_year
              AND period_month = p_month
              AND target_type = 'sales_amount'
        ) THEN
            -- محاولة نسخ من الشهر السابق
            IF p_copy_from_previous THEN
                SELECT * INTO v_prev_target
                FROM employee_targets
                WHERE employee_id = v_assignment.employee_id
                  AND target_type = 'sales_amount'
                  AND (
                      (period_year = p_year AND period_month = p_month - 1)
                      OR (p_month = 1 AND period_year = p_year - 1 AND period_month = 12)
                  )
                LIMIT 1;
            END IF;
            
            -- إنشاء الهدف
            INSERT INTO employee_targets (
                tenant_id, company_id, employee_id,
                target_type, period_type, period_year, period_month,
                target_amount,
                bonus_on_achievement, bonus_on_exceed,
                status
            )
            VALUES (
                v_tenant_id, p_company_id, v_assignment.employee_id,
                'sales_amount', 'monthly', p_year, p_month,
                COALESCE(v_prev_target.target_amount, v_assignment.target_amount, 0),
                COALESCE(v_prev_target.bonus_on_achievement, 0),
                COALESCE(v_prev_target.bonus_on_exceed, 0),
                'active'
            );
            
            v_created := v_created + 1;
        END IF;
    END LOOP;
    
    RETURN v_created;
END;
$$;

COMMENT ON FUNCTION create_monthly_targets IS 'إنشاء أهداف شهرية للموظفين';

-- ═══════════════════════════════════════════════════════════════
-- نهاية المرحلة 5: نظام الحوافز والعمولات
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'تم إنشاء المرحلة 5: نظام الحوافز والعمولات بنجاح';
    RAISE NOTICE '- جدول incentive_plans (خطط الحوافز)';
    RAISE NOTICE '- جدول incentive_plan_tiers (درجات الخطط)';
    RAISE NOTICE '- جدول employee_incentive_assignments (تعيينات الموظفين)';
    RAISE NOTICE '- جدول employee_commissions (عمولات الموظفين)';
    RAISE NOTICE '- جدول employee_targets (أهداف الموظفين)';
    RAISE NOTICE '- جدول target_achievement_log (سجل الإنجاز)';
    RAISE NOTICE '- دالة calculate_sales_commission';
    RAISE NOTICE '- دالة update_employee_target_achievement';
    RAISE NOTICE '- دالة get_employee_commission_report';
    RAISE NOTICE '- دالة get_target_achievement_report';
    RAISE NOTICE '- دالة create_monthly_targets';
    RAISE NOTICE '';
    RAISE NOTICE 'للاستخدام:';
    RAISE NOTICE '1. إنشاء خطة حوافز في incentive_plans';
    RAISE NOTICE '2. تعيين الموظفين في employee_incentive_assignments';
    RAISE NOTICE '3. إنشاء أهداف: SELECT create_monthly_targets(company_id, year, month)';
    RAISE NOTICE '4. حساب العمولة: SELECT * FROM calculate_sales_commission(invoice_id)';
    RAISE NOTICE '5. تقرير العمولات: SELECT * FROM get_employee_commission_report(...)';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
