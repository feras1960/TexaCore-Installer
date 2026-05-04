-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00015: القيود المتكررة
-- Recurring Journal Entries
-- ═══════════════════════════════════════════════════════════════════════════
-- المحتويات:
-- 1. جدول قوالب القيود المتكررة
-- 2. جدول بنود القيد المتكرر
-- 3. جدول سجل التنفيذ
-- 4. دالة توليد القيود المتكررة
-- 5. دالة حساب تاريخ التنفيذ التالي
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. جدول قوالب القيود المتكررة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS recurring_entry_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- معلومات القالب
    template_code VARCHAR(50) NOT NULL,
    template_name VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- جدولة التكرار
    frequency VARCHAR(20) NOT NULL,  -- daily, weekly, monthly, quarterly, yearly
    day_of_week INT,                  -- 0-6 (الأحد=0) للأسبوعي
    day_of_month INT,                 -- 1-31 للشهري
    month_of_year INT,                -- 1-12 للسنوي
    
    -- فترة التطبيق
    start_date DATE NOT NULL,
    end_date DATE,                    -- NULL = بدون نهاية
    
    -- تتبع التنفيذ
    next_execution_date DATE,
    last_execution_date DATE,
    execution_count INT DEFAULT 0,
    max_executions INT,               -- NULL = بدون حد
    
    -- معلومات القيد
    total_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'SAR',
    
    -- الإعدادات
    is_active BOOLEAN DEFAULT true,
    auto_post BOOLEAN DEFAULT false,  -- ترحيل تلقائي أم مسودة
    notify_on_creation BOOLEAN DEFAULT true,
    
    -- تصنيف
    category VARCHAR(50),             -- salaries, rent, loan, depreciation, subscription, other
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, template_code)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_recurring_templates_company ON recurring_entry_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_next_date ON recurring_entry_templates(next_execution_date) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_recurring_templates_category ON recurring_entry_templates(category);

-- RLS
ALTER TABLE recurring_entry_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users - recurring_entry_templates" ON recurring_entry_templates
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE recurring_entry_templates IS 'قوالب القيود المتكررة - رواتب، إيجارات، أقساط، إهلاك، اشتراكات';

-- ═══════════════════════════════════════════════════════════════
-- 2. جدول بنود القيد المتكرر
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS recurring_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES recurring_entry_templates(id) ON DELETE CASCADE,
    
    line_number INT DEFAULT 1,
    
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    
    debit DECIMAL(15,2) DEFAULT 0,
    credit DECIMAL(15,2) DEFAULT 0,
    
    -- يمكن استخدام نسبة بدل مبلغ ثابت
    is_percentage BOOLEAN DEFAULT false,
    percentage DECIMAL(5,2),          -- نسبة من إجمالي القيد
    
    description TEXT,
    
    cost_center_id UUID,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT chk_recurring_line_debit_or_credit CHECK (
        (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0) OR (debit = 0 AND credit = 0)
    )
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_recurring_lines_template ON recurring_entry_lines(template_id);
CREATE INDEX IF NOT EXISTS idx_recurring_lines_account ON recurring_entry_lines(account_id);

-- RLS
ALTER TABLE recurring_entry_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users - recurring_entry_lines" ON recurring_entry_lines
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE recurring_entry_lines IS 'بنود القيد المتكرر - الحسابات والمبالغ';

-- ═══════════════════════════════════════════════════════════════
-- 3. جدول سجل التنفيذ
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS recurring_entry_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES recurring_entry_templates(id) ON DELETE CASCADE,
    
    -- القيد المُنشأ
    journal_entry_id UUID REFERENCES journal_entries(id),
    
    -- معلومات التنفيذ
    execution_date DATE NOT NULL,
    scheduled_date DATE NOT NULL,     -- التاريخ المجدول
    
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending, success, failed, skipped, cancelled
    
    error_message TEXT,
    
    executed_by UUID,                 -- NULL = تلقائي
    executed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_recurring_executions_template ON recurring_entry_executions(template_id);
CREATE INDEX IF NOT EXISTS idx_recurring_executions_date ON recurring_entry_executions(execution_date);
CREATE INDEX IF NOT EXISTS idx_recurring_executions_status ON recurring_entry_executions(status);

-- RLS
ALTER TABLE recurring_entry_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users - recurring_entry_executions" ON recurring_entry_executions
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE recurring_entry_executions IS 'سجل تنفيذ القيود المتكررة';

-- ═══════════════════════════════════════════════════════════════
-- 4. دالة حساب تاريخ التنفيذ التالي
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION calculate_next_execution_date(
    p_frequency VARCHAR(20),
    p_current_date DATE,
    p_day_of_week INT DEFAULT NULL,
    p_day_of_month INT DEFAULT NULL,
    p_month_of_year INT DEFAULT NULL
)
RETURNS DATE
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_date DATE;
    v_temp_date DATE;
BEGIN
    CASE p_frequency
        WHEN 'daily' THEN
            v_next_date := p_current_date + INTERVAL '1 day';
            
        WHEN 'weekly' THEN
            -- الأسبوع القادم في نفس اليوم
            v_next_date := p_current_date + INTERVAL '7 days';
            -- إذا تم تحديد يوم معين
            IF p_day_of_week IS NOT NULL THEN
                v_next_date := p_current_date + ((7 + p_day_of_week - EXTRACT(DOW FROM p_current_date)::INT) % 7 + 7)::INT;
            END IF;
            
        WHEN 'monthly' THEN
            -- الشهر القادم
            v_temp_date := p_current_date + INTERVAL '1 month';
            IF p_day_of_month IS NOT NULL THEN
                -- تحديد اليوم المطلوب
                v_next_date := DATE_TRUNC('month', v_temp_date) + (LEAST(p_day_of_month, 
                    EXTRACT(DAY FROM (DATE_TRUNC('month', v_temp_date) + INTERVAL '1 month' - INTERVAL '1 day'))::INT) - 1) * INTERVAL '1 day';
            ELSE
                v_next_date := v_temp_date;
            END IF;
            
        WHEN 'quarterly' THEN
            -- الربع القادم
            v_temp_date := p_current_date + INTERVAL '3 months';
            IF p_day_of_month IS NOT NULL THEN
                v_next_date := DATE_TRUNC('month', v_temp_date) + (LEAST(p_day_of_month, 28) - 1) * INTERVAL '1 day';
            ELSE
                v_next_date := v_temp_date;
            END IF;
            
        WHEN 'yearly' THEN
            -- السنة القادمة
            v_temp_date := p_current_date + INTERVAL '1 year';
            IF p_month_of_year IS NOT NULL AND p_day_of_month IS NOT NULL THEN
                v_next_date := MAKE_DATE(
                    EXTRACT(YEAR FROM v_temp_date)::INT,
                    p_month_of_year,
                    LEAST(p_day_of_month, 28)
                );
            ELSE
                v_next_date := v_temp_date;
            END IF;
            
        ELSE
            v_next_date := p_current_date + INTERVAL '1 month';
    END CASE;
    
    RETURN v_next_date;
END;
$$;

COMMENT ON FUNCTION calculate_next_execution_date(VARCHAR, DATE, INT, INT, INT) IS 'حساب تاريخ التنفيذ التالي للقيد المتكرر';

-- ═══════════════════════════════════════════════════════════════
-- 5. دالة توليد القيود المتكررة
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION generate_recurring_entries(
    p_company_id UUID DEFAULT NULL,
    p_as_of_date DATE DEFAULT CURRENT_DATE,
    p_user_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_template RECORD;
    v_line RECORD;
    v_entry_id UUID;
    v_entry_number VARCHAR(50);
    v_execution_id UUID;
    v_entries_created INT := 0;
    v_fiscal_year_id UUID;
    v_line_number INT;
BEGIN
    -- معالجة كل قالب مستحق التنفيذ
    FOR v_template IN 
        SELECT * FROM recurring_entry_templates
        WHERE is_active = true
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND next_execution_date <= p_as_of_date
          AND (end_date IS NULL OR next_execution_date <= end_date)
          AND (max_executions IS NULL OR execution_count < max_executions)
        ORDER BY next_execution_date
    LOOP
        BEGIN
            -- الحصول على السنة المالية
            SELECT id INTO v_fiscal_year_id
            FROM fiscal_years
            WHERE company_id = v_template.company_id
              AND is_current = true
            LIMIT 1;
            
            -- توليد رقم القيد
            v_entry_number := 'JE-RC-' || v_template.template_code || '-' || TO_CHAR(v_template.next_execution_date, 'YYYYMMDD');
            
            -- إنشاء القيد اليومي
            INSERT INTO journal_entries (
                tenant_id, company_id,
                entry_number, entry_date,
                fiscal_year_id,
                entry_type,
                reference_type, reference_id, reference_number,
                description,
                currency,
                total_debit, total_credit,
                status, is_posted, posted_at,
                created_by, created_at
            )
            VALUES (
                v_template.tenant_id, v_template.company_id,
                v_entry_number, v_template.next_execution_date,
                v_fiscal_year_id,
                'recurring',
                'recurring_template', v_template.id, v_template.template_code,
                v_template.template_name || ' - ' || TO_CHAR(v_template.next_execution_date, 'YYYY-MM-DD'),
                v_template.currency,
                v_template.total_amount, v_template.total_amount,
                CASE WHEN v_template.auto_post THEN 'posted' ELSE 'draft' END,
                v_template.auto_post,
                CASE WHEN v_template.auto_post THEN NOW() ELSE NULL END,
                p_user_id, NOW()
            )
            RETURNING id INTO v_entry_id;
            
            -- إضافة بنود القيد
            v_line_number := 1;
            FOR v_line IN 
                SELECT * FROM recurring_entry_lines
                WHERE template_id = v_template.id
                ORDER BY line_number
            LOOP
                INSERT INTO journal_entry_lines (
                    tenant_id, entry_id, line_number,
                    account_id,
                    debit, credit,
                    description,
                    cost_center_id
                )
                VALUES (
                    v_template.tenant_id, v_entry_id, v_line_number,
                    v_line.account_id,
                    CASE 
                        WHEN v_line.is_percentage THEN v_template.total_amount * v_line.percentage / 100
                        ELSE v_line.debit 
                    END,
                    CASE 
                        WHEN v_line.is_percentage THEN v_template.total_amount * v_line.percentage / 100
                        ELSE v_line.credit 
                    END,
                    COALESCE(v_line.description, v_template.template_name),
                    v_line.cost_center_id
                );
                v_line_number := v_line_number + 1;
            END LOOP;
            
            -- تسجيل التنفيذ
            INSERT INTO recurring_entry_executions (
                tenant_id, template_id,
                journal_entry_id,
                execution_date, scheduled_date,
                status,
                executed_by, executed_at
            )
            VALUES (
                v_template.tenant_id, v_template.id,
                v_entry_id,
                p_as_of_date, v_template.next_execution_date,
                'success',
                p_user_id, NOW()
            );
            
            -- تحديث القالب
            UPDATE recurring_entry_templates
            SET last_execution_date = v_template.next_execution_date,
                next_execution_date = calculate_next_execution_date(
                    v_template.frequency,
                    v_template.next_execution_date,
                    v_template.day_of_week,
                    v_template.day_of_month,
                    v_template.month_of_year
                ),
                execution_count = execution_count + 1,
                updated_at = NOW()
            WHERE id = v_template.id;
            
            v_entries_created := v_entries_created + 1;
            
            RAISE NOTICE 'تم إنشاء قيد متكرر: % - التاريخ: %', v_template.template_name, v_template.next_execution_date;
            
        EXCEPTION WHEN OTHERS THEN
            -- تسجيل الخطأ
            INSERT INTO recurring_entry_executions (
                tenant_id, template_id,
                execution_date, scheduled_date,
                status, error_message,
                executed_at
            )
            VALUES (
                v_template.tenant_id, v_template.id,
                p_as_of_date, v_template.next_execution_date,
                'failed', SQLERRM,
                NOW()
            );
            
            RAISE NOTICE 'فشل إنشاء قيد متكرر: % - الخطأ: %', v_template.template_name, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE 'تم إنشاء % قيد متكرر', v_entries_created;
    
    RETURN v_entries_created;
END;
$$;

COMMENT ON FUNCTION generate_recurring_entries(UUID, DATE, UUID) IS 'توليد القيود المتكررة المستحقة حتى تاريخ معين';

-- ═══════════════════════════════════════════════════════════════
-- 6. دالة إنشاء قالب قيد متكرر
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_recurring_template(
    p_tenant_id UUID,
    p_company_id UUID,
    p_template_code VARCHAR(50),
    p_template_name VARCHAR(200),
    p_frequency VARCHAR(20),
    p_start_date DATE,
    p_total_amount DECIMAL(15,2),
    p_debit_account_id UUID,
    p_credit_account_id UUID,
    p_day_of_month INT DEFAULT NULL,
    p_category VARCHAR(50) DEFAULT 'other',
    p_description TEXT DEFAULT NULL,
    p_auto_post BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_template_id UUID;
BEGIN
    -- إنشاء القالب
    INSERT INTO recurring_entry_templates (
        tenant_id, company_id,
        template_code, template_name, description,
        frequency, day_of_month,
        start_date, next_execution_date,
        total_amount,
        category,
        auto_post, is_active
    )
    VALUES (
        p_tenant_id, p_company_id,
        p_template_code, p_template_name, p_description,
        p_frequency, p_day_of_month,
        p_start_date, p_start_date,
        p_total_amount,
        p_category,
        p_auto_post, true
    )
    RETURNING id INTO v_template_id;
    
    -- إضافة بند المدين
    INSERT INTO recurring_entry_lines (
        tenant_id, template_id, line_number,
        account_id, debit, credit,
        description
    )
    VALUES (
        p_tenant_id, v_template_id, 1,
        p_debit_account_id, p_total_amount, 0,
        p_template_name || ' - مدين'
    );
    
    -- إضافة بند الدائن
    INSERT INTO recurring_entry_lines (
        tenant_id, template_id, line_number,
        account_id, debit, credit,
        description
    )
    VALUES (
        p_tenant_id, v_template_id, 2,
        p_credit_account_id, 0, p_total_amount,
        p_template_name || ' - دائن'
    );
    
    RAISE NOTICE 'تم إنشاء قالب القيد المتكرر: %', p_template_name;
    
    RETURN v_template_id;
END;
$$;

COMMENT ON FUNCTION create_recurring_template IS 'إنشاء قالب قيد متكرر بسيط (مدين/دائن)';

-- ═══════════════════════════════════════════════════════════════
-- 7. Trigger لحساب تاريخ التنفيذ التالي عند الإنشاء
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_initial_next_execution_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.next_execution_date IS NULL THEN
        NEW.next_execution_date := NEW.start_date;
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_initial_next_execution_date ON recurring_entry_templates;
CREATE TRIGGER trg_set_initial_next_execution_date
    BEFORE INSERT ON recurring_entry_templates
    FOR EACH ROW
    EXECUTE FUNCTION set_initial_next_execution_date();

-- ═══════════════════════════════════════════════════════════════
-- نهاية المرحلة 4: القيود المتكررة
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'تم إنشاء المرحلة 4: القيود المتكررة بنجاح';
    RAISE NOTICE '- جدول recurring_entry_templates (قوالب القيود)';
    RAISE NOTICE '- جدول recurring_entry_lines (بنود القيود)';
    RAISE NOTICE '- جدول recurring_entry_executions (سجل التنفيذ)';
    RAISE NOTICE '- دالة calculate_next_execution_date';
    RAISE NOTICE '- دالة generate_recurring_entries';
    RAISE NOTICE '- دالة create_recurring_template';
    RAISE NOTICE '';
    RAISE NOTICE 'للاستخدام:';
    RAISE NOTICE '1. إنشاء قالب: SELECT create_recurring_template(...)';
    RAISE NOTICE '2. توليد القيود: SELECT generate_recurring_entries(company_id, date)';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
