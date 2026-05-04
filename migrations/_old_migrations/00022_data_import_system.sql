-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00022: نظام استيراد البيانات
-- Data Import System
-- ═══════════════════════════════════════════════════════════════════════════
-- يحتوي على:
--    1. جدول عمليات الاستيراد (import_jobs)
--    2. جدول تفاصيل الصفوف (import_rows)
--    3. جدول القوالب المخصصة (import_templates)
--    4. جدول تعريفات الكيانات (import_entity_definitions)

-- ═══════════════════════════════════════════════════════════════
-- 1. جدول عمليات الاستيراد
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- نوع البيانات
    entity_type VARCHAR(50) NOT NULL, -- customers, suppliers, products, chart_of_accounts, journal_entries, inventory_movements
    
    -- معلومات الملف
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(20), -- xlsx, xls, csv
    file_size BIGINT,
    storage_path TEXT, -- مسار الملف في Storage (اختياري)
    
    -- إحصائيات
    total_rows INT DEFAULT 0,
    valid_rows INT DEFAULT 0,
    invalid_rows INT DEFAULT 0,
    imported_rows INT DEFAULT 0,
    skipped_rows INT DEFAULT 0,
    failed_rows INT DEFAULT 0,
    
    -- الحالة
    status VARCHAR(30) DEFAULT 'pending', -- pending, parsing, validating, ai_analyzing, ready, importing, completed, failed, cancelled
    progress_percent INT DEFAULT 0,
    current_step VARCHAR(50),
    
    -- الأخطاء والاقتراحات
    validation_summary JSONB DEFAULT '{}',
    ai_analysis_summary JSONB,
    
    -- خيارات الاستيراد
    import_options JSONB DEFAULT '{
        "skip_invalid_rows": true,
        "update_existing": false,
        "use_ai_analysis": false,
        "column_mappings": {}
    }',
    
    -- رسائل الخطأ
    error_message TEXT,
    error_details JSONB,
    
    -- التوقيت
    started_at TIMESTAMPTZ,
    parsing_completed_at TIMESTAMPTZ,
    validation_completed_at TIMESTAMPTZ,
    ai_analysis_completed_at TIMESTAMPTZ,
    import_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. جدول تفاصيل الصفوف
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    
    -- رقم الصف في الملف الأصلي
    row_number INT NOT NULL,
    
    -- البيانات الخام من الملف
    raw_data JSONB NOT NULL,
    
    -- البيانات بعد المطابقة مع الأعمدة
    mapped_data JSONB,
    
    -- البيانات المنظفة/المصححة
    cleaned_data JSONB,
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'pending', -- pending, valid, invalid, imported, skipped, failed
    
    -- الأخطاء
    validation_errors JSONB DEFAULT '[]', -- [{field, error, value}]
    
    -- اقتراحات AI
    ai_suggestions JSONB, -- {corrections: [], warnings: [], duplicates: []}
    
    -- النتيجة
    entity_id UUID, -- ID of created/updated entity
    import_result JSONB, -- نتيجة الاستيراد التفصيلية
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 3. جدول القوالب المخصصة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- نوع الكيان
    entity_type VARCHAR(50) NOT NULL,
    
    -- معلومات القالب
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100),
    description TEXT,
    
    -- مطابقة الأعمدة
    column_mappings JSONB NOT NULL, -- {"file_column": "system_field", ...}
    
    -- الإعدادات الافتراضية
    default_values JSONB DEFAULT '{}', -- قيم افتراضية للحقول
    
    -- هل هو القالب الافتراضي
    is_default BOOLEAN DEFAULT false,
    is_system BOOLEAN DEFAULT false, -- قوالب النظام لا يمكن حذفها
    
    -- الاستخدام
    usage_count INT DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, entity_type, name)
);

-- ═══════════════════════════════════════════════════════════════
-- 4. جدول تعريفات الكيانات للاستيراد
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_entity_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- نوع الكيان
    entity_type VARCHAR(50) NOT NULL UNIQUE,
    
    -- الجدول المستهدف
    target_table VARCHAR(100) NOT NULL,
    
    -- الاسم المعروض
    display_name_ar VARCHAR(100) NOT NULL,
    display_name_en VARCHAR(100),
    
    -- الأيقونة
    icon VARCHAR(50),
    
    -- تعريف الحقول
    fields JSONB NOT NULL, -- [{name, type, required, label_ar, label_en, format, validation}]
    
    -- الحقول المطلوبة
    required_fields TEXT[] NOT NULL,
    
    -- الحقول الفريدة (للكشف عن التكرارات)
    unique_fields TEXT[],
    
    -- حقل البحث عن التكرارات مع الموجود
    lookup_fields TEXT[],
    
    -- الترتيب في القائمة
    display_order INT DEFAULT 0,
    
    -- هل مفعل
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 5. إدراج تعريفات الكيانات الافتراضية
-- ═══════════════════════════════════════════════════════════════

INSERT INTO import_entity_definitions (entity_type, target_table, display_name_ar, display_name_en, icon, fields, required_fields, unique_fields, lookup_fields, display_order)
VALUES
-- العملاء
('customers', 'customers', 'العملاء', 'Customers', 'Users', 
'[
    {"name": "code", "type": "string", "required": true, "label_ar": "الكود", "label_en": "Code", "max_length": 50},
    {"name": "name", "type": "string", "required": true, "label_ar": "الاسم", "label_en": "Name", "max_length": 200},
    {"name": "name_en", "type": "string", "required": false, "label_ar": "الاسم بالإنجليزية", "label_en": "English Name", "max_length": 200},
    {"name": "phone", "type": "phone", "required": false, "label_ar": "الهاتف", "label_en": "Phone"},
    {"name": "mobile", "type": "phone", "required": false, "label_ar": "الجوال", "label_en": "Mobile"},
    {"name": "email", "type": "email", "required": false, "label_ar": "البريد الإلكتروني", "label_en": "Email"},
    {"name": "address", "type": "string", "required": false, "label_ar": "العنوان", "label_en": "Address"},
    {"name": "city", "type": "string", "required": false, "label_ar": "المدينة", "label_en": "City"},
    {"name": "country", "type": "string", "required": false, "label_ar": "الدولة", "label_en": "Country"},
    {"name": "tax_number", "type": "string", "required": false, "label_ar": "الرقم الضريبي", "label_en": "Tax Number"},
    {"name": "credit_limit", "type": "number", "required": false, "label_ar": "حد الائتمان", "label_en": "Credit Limit", "min": 0},
    {"name": "opening_balance", "type": "number", "required": false, "label_ar": "الرصيد الافتتاحي", "label_en": "Opening Balance"},
    {"name": "notes", "type": "text", "required": false, "label_ar": "ملاحظات", "label_en": "Notes"}
]'::JSONB,
ARRAY['code', 'name'],
ARRAY['code', 'email'],
ARRAY['code', 'name', 'phone', 'email'],
1),

-- الموردين
('suppliers', 'suppliers', 'الموردين', 'Suppliers', 'Truck',
'[
    {"name": "code", "type": "string", "required": true, "label_ar": "الكود", "label_en": "Code", "max_length": 50},
    {"name": "name", "type": "string", "required": true, "label_ar": "الاسم", "label_en": "Name", "max_length": 200},
    {"name": "name_en", "type": "string", "required": false, "label_ar": "الاسم بالإنجليزية", "label_en": "English Name", "max_length": 200},
    {"name": "phone", "type": "phone", "required": false, "label_ar": "الهاتف", "label_en": "Phone"},
    {"name": "mobile", "type": "phone", "required": false, "label_ar": "الجوال", "label_en": "Mobile"},
    {"name": "email", "type": "email", "required": false, "label_ar": "البريد الإلكتروني", "label_en": "Email"},
    {"name": "address", "type": "string", "required": false, "label_ar": "العنوان", "label_en": "Address"},
    {"name": "city", "type": "string", "required": false, "label_ar": "المدينة", "label_en": "City"},
    {"name": "country", "type": "string", "required": false, "label_ar": "الدولة", "label_en": "Country"},
    {"name": "tax_number", "type": "string", "required": false, "label_ar": "الرقم الضريبي", "label_en": "Tax Number"},
    {"name": "payment_terms", "type": "number", "required": false, "label_ar": "شروط الدفع (أيام)", "label_en": "Payment Terms (Days)"},
    {"name": "opening_balance", "type": "number", "required": false, "label_ar": "الرصيد الافتتاحي", "label_en": "Opening Balance"},
    {"name": "notes", "type": "text", "required": false, "label_ar": "ملاحظات", "label_en": "Notes"}
]'::JSONB,
ARRAY['code', 'name'],
ARRAY['code', 'email'],
ARRAY['code', 'name', 'phone', 'email'],
2),

-- المنتجات
('products', 'products', 'المنتجات', 'Products', 'Package',
'[
    {"name": "code", "type": "string", "required": true, "label_ar": "الكود", "label_en": "Code", "max_length": 50},
    {"name": "name", "type": "string", "required": true, "label_ar": "الاسم", "label_en": "Name", "max_length": 200},
    {"name": "name_en", "type": "string", "required": false, "label_ar": "الاسم بالإنجليزية", "label_en": "English Name", "max_length": 200},
    {"name": "barcode", "type": "string", "required": false, "label_ar": "الباركود", "label_en": "Barcode"},
    {"name": "category", "type": "string", "required": false, "label_ar": "التصنيف", "label_en": "Category"},
    {"name": "unit", "type": "string", "required": false, "label_ar": "الوحدة", "label_en": "Unit"},
    {"name": "sale_price", "type": "number", "required": true, "label_ar": "سعر البيع", "label_en": "Sale Price", "min": 0},
    {"name": "cost_price", "type": "number", "required": false, "label_ar": "سعر التكلفة", "label_en": "Cost Price", "min": 0},
    {"name": "min_price", "type": "number", "required": false, "label_ar": "الحد الأدنى للسعر", "label_en": "Minimum Price", "min": 0},
    {"name": "opening_qty", "type": "number", "required": false, "label_ar": "الكمية الافتتاحية", "label_en": "Opening Quantity"},
    {"name": "min_qty", "type": "number", "required": false, "label_ar": "الحد الأدنى للكمية", "label_en": "Minimum Quantity"},
    {"name": "max_qty", "type": "number", "required": false, "label_ar": "الحد الأقصى للكمية", "label_en": "Maximum Quantity"},
    {"name": "description", "type": "text", "required": false, "label_ar": "الوصف", "label_en": "Description"},
    {"name": "notes", "type": "text", "required": false, "label_ar": "ملاحظات", "label_en": "Notes"}
]'::JSONB,
ARRAY['code', 'name', 'sale_price'],
ARRAY['code', 'barcode'],
ARRAY['code', 'name', 'barcode'],
3),

-- دليل الحسابات
('chart_of_accounts', 'chart_of_accounts', 'دليل الحسابات', 'Chart of Accounts', 'FileText',
'[
    {"name": "account_code", "type": "string", "required": true, "label_ar": "رقم الحساب", "label_en": "Account Code", "max_length": 20},
    {"name": "name_ar", "type": "string", "required": true, "label_ar": "اسم الحساب", "label_en": "Account Name (AR)", "max_length": 200},
    {"name": "name_en", "type": "string", "required": false, "label_ar": "اسم الحساب بالإنجليزية", "label_en": "Account Name (EN)", "max_length": 200},
    {"name": "account_type", "type": "select", "required": true, "label_ar": "نوع الحساب", "label_en": "Account Type", "options": ["asset", "liability", "equity", "revenue", "expense"]},
    {"name": "parent_code", "type": "string", "required": false, "label_ar": "رقم الحساب الأب", "label_en": "Parent Account Code"},
    {"name": "opening_balance", "type": "number", "required": false, "label_ar": "الرصيد الافتتاحي", "label_en": "Opening Balance"},
    {"name": "opening_balance_type", "type": "select", "required": false, "label_ar": "نوع الرصيد", "label_en": "Balance Type", "options": ["debit", "credit"]},
    {"name": "description", "type": "text", "required": false, "label_ar": "الوصف", "label_en": "Description"}
]'::JSONB,
ARRAY['account_code', 'name_ar', 'account_type'],
ARRAY['account_code'],
ARRAY['account_code', 'name_ar'],
4),

-- القيود المحاسبية
('journal_entries', 'journal_entries', 'القيود المحاسبية', 'Journal Entries', 'BookOpen',
'[
    {"name": "entry_date", "type": "date", "required": true, "label_ar": "التاريخ", "label_en": "Date"},
    {"name": "reference", "type": "string", "required": false, "label_ar": "المرجع", "label_en": "Reference"},
    {"name": "description", "type": "string", "required": true, "label_ar": "البيان", "label_en": "Description"},
    {"name": "account_code", "type": "string", "required": true, "label_ar": "رقم الحساب", "label_en": "Account Code"},
    {"name": "debit", "type": "number", "required": false, "label_ar": "مدين", "label_en": "Debit", "min": 0},
    {"name": "credit", "type": "number", "required": false, "label_ar": "دائن", "label_en": "Credit", "min": 0},
    {"name": "cost_center", "type": "string", "required": false, "label_ar": "مركز التكلفة", "label_en": "Cost Center"},
    {"name": "notes", "type": "text", "required": false, "label_ar": "ملاحظات", "label_en": "Notes"}
]'::JSONB,
ARRAY['entry_date', 'description', 'account_code'],
NULL,
ARRAY['reference'],
5),

-- حركات المخزون
('inventory_movements', 'inventory_movements', 'حركات المخزون', 'Inventory Movements', 'ArrowLeftRight',
'[
    {"name": "movement_date", "type": "date", "required": true, "label_ar": "التاريخ", "label_en": "Date"},
    {"name": "product_code", "type": "string", "required": true, "label_ar": "كود المنتج", "label_en": "Product Code"},
    {"name": "warehouse_code", "type": "string", "required": true, "label_ar": "كود المستودع", "label_en": "Warehouse Code"},
    {"name": "movement_type", "type": "select", "required": true, "label_ar": "نوع الحركة", "label_en": "Movement Type", "options": ["in", "out", "transfer", "adjustment"]},
    {"name": "quantity", "type": "number", "required": true, "label_ar": "الكمية", "label_en": "Quantity"},
    {"name": "unit_cost", "type": "number", "required": false, "label_ar": "تكلفة الوحدة", "label_en": "Unit Cost", "min": 0},
    {"name": "reference", "type": "string", "required": false, "label_ar": "المرجع", "label_en": "Reference"},
    {"name": "notes", "type": "text", "required": false, "label_ar": "ملاحظات", "label_en": "Notes"}
]'::JSONB,
ARRAY['movement_date', 'product_code', 'warehouse_code', 'movement_type', 'quantity'],
NULL,
ARRAY['reference'],
6)

ON CONFLICT (entity_type) DO UPDATE SET
    fields = EXCLUDED.fields,
    required_fields = EXCLUDED.required_fields,
    unique_fields = EXCLUDED.unique_fields,
    lookup_fields = EXCLUDED.lookup_fields;

-- ═══════════════════════════════════════════════════════════════
-- 6. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON import_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_entity ON import_jobs(entity_type);
CREATE INDEX IF NOT EXISTS idx_import_jobs_created ON import_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_user ON import_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_import_rows_job ON import_rows(job_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_status ON import_rows(status);
CREATE INDEX IF NOT EXISTS idx_import_rows_number ON import_rows(job_id, row_number);

CREATE INDEX IF NOT EXISTS idx_import_templates_tenant ON import_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_templates_entity ON import_templates(entity_type);

-- ═══════════════════════════════════════════════════════════════
-- 7. تفعيل RLS
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS import_jobs_tenant_policy ON import_jobs;
CREATE POLICY import_jobs_tenant_policy ON import_jobs
    FOR ALL USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS import_rows_tenant_policy ON import_rows;
CREATE POLICY import_rows_tenant_policy ON import_rows
    FOR ALL USING (
        job_id IN (SELECT id FROM import_jobs WHERE tenant_id = get_current_tenant_id())
    );

DROP POLICY IF EXISTS import_templates_tenant_policy ON import_templates;
CREATE POLICY import_templates_tenant_policy ON import_templates
    FOR ALL USING (
        tenant_id = get_current_tenant_id() 
        OR tenant_id IS NULL -- قوالب النظام العامة
    );

-- ═══════════════════════════════════════════════════════════════
-- 8. دوال مساعدة
-- ═══════════════════════════════════════════════════════════════

-- دالة لتحديث حالة عملية الاستيراد
CREATE OR REPLACE FUNCTION update_import_job_status(
    p_job_id UUID,
    p_status VARCHAR(30),
    p_error_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    UPDATE import_jobs
    SET 
        status = p_status,
        error_message = COALESCE(p_error_message, error_message),
        updated_at = NOW(),
        completed_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END
    WHERE id = p_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة لحساب إحصائيات عملية الاستيراد
CREATE OR REPLACE FUNCTION calculate_import_job_stats(p_job_id UUID)
RETURNS VOID AS $$
DECLARE
    v_stats RECORD;
BEGIN
    SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'valid') as valid,
        COUNT(*) FILTER (WHERE status = 'invalid') as invalid,
        COUNT(*) FILTER (WHERE status = 'imported') as imported,
        COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
    INTO v_stats
    FROM import_rows
    WHERE job_id = p_job_id;
    
    UPDATE import_jobs
    SET 
        total_rows = v_stats.total,
        valid_rows = v_stats.valid,
        invalid_rows = v_stats.invalid,
        imported_rows = v_stats.imported,
        skipped_rows = v_stats.skipped,
        failed_rows = v_stats.failed,
        updated_at = NOW()
    WHERE id = p_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة للحصول على تعريف كيان
CREATE OR REPLACE FUNCTION get_import_entity_definition(p_entity_type VARCHAR(50))
RETURNS JSONB AS $$
DECLARE
    v_definition JSONB;
BEGIN
    SELECT jsonb_build_object(
        'entity_type', entity_type,
        'target_table', target_table,
        'display_name_ar', display_name_ar,
        'display_name_en', display_name_en,
        'icon', icon,
        'fields', fields,
        'required_fields', required_fields,
        'unique_fields', unique_fields,
        'lookup_fields', lookup_fields
    ) INTO v_definition
    FROM import_entity_definitions
    WHERE entity_type = p_entity_type AND is_active = true;
    
    RETURN v_definition;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- دالة للحصول على كل تعريفات الكيانات
CREATE OR REPLACE FUNCTION get_all_import_entity_definitions()
RETURNS JSONB AS $$
DECLARE
    v_definitions JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'entity_type', entity_type,
            'target_table', target_table,
            'display_name_ar', display_name_ar,
            'display_name_en', display_name_en,
            'icon', icon,
            'fields', fields,
            'required_fields', required_fields,
            'unique_fields', unique_fields,
            'lookup_fields', lookup_fields
        ) ORDER BY display_order
    ) INTO v_definitions
    FROM import_entity_definitions
    WHERE is_active = true;
    
    RETURN COALESCE(v_definitions, '[]'::JSONB);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════
-- 9. التحقق
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ تم إنشاء نظام استيراد البيانات';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'الجداول:';
    RAISE NOTICE '  • import_jobs - سجل عمليات الاستيراد';
    RAISE NOTICE '  • import_rows - تفاصيل الصفوف';
    RAISE NOTICE '  • import_templates - القوالب المخصصة';
    RAISE NOTICE '  • import_entity_definitions - تعريفات الكيانات';
    RAISE NOTICE '';
    RAISE NOTICE 'الكيانات المدعومة:';
    RAISE NOTICE '  • customers - العملاء';
    RAISE NOTICE '  • suppliers - الموردين';
    RAISE NOTICE '  • products - المنتجات';
    RAISE NOTICE '  • chart_of_accounts - دليل الحسابات';
    RAISE NOTICE '  • journal_entries - القيود المحاسبية';
    RAISE NOTICE '  • inventory_movements - حركات المخزون';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;
