-- ═══════════════════════════════════════════════════════════════════════════
-- 🏗️ المرحلة 1C: إعدادات الاستلام المختلف + حقول قيود التسوية
-- ═══════════════════════════════════════════════════════════════════════════
-- التاريخ: 2026-02-15
-- المهام: S.1 (إعدادات المشتريات) + S.2 (حقول التسوية في journal_entries)
-- ═══════════════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  S.1 — إعدادات المشتريات والاستلام في company_accounting_settings    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS company_accounting_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID NOT NULL REFERENCES companies(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_company_accounting_settings UNIQUE (tenant_id, company_id)
);

-- ── سياسة فروقات الاستلام ──
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    receipt_variance_policy TEXT DEFAULT 'bill_on_receipt'
    CHECK (receipt_variance_policy IN (
        'bill_on_receipt',       -- تعديل الفاتورة بالمُستلم (الافتراضي)
        'cost_redistribution',   -- توزيع التكلفة على المُستلم
        'debit_note',            -- إشعار مدين بالفرق
        'variance_account',      -- ترحيل لحساب فروقات
        'manual'                 -- يدوي (اختيار كل مرة)
    ));

-- ── طريقة تقييم المخزون ──
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    inventory_valuation_method TEXT DEFAULT 'moving_average'
    CHECK (inventory_valuation_method IN (
        'moving_average',   -- متوسط مرجح (الافتراضي)
        'fifo',             -- الأول دخولاً أول خروجاً
        'standard_cost',    -- تكلفة معيارية ثابتة
        'latest_price'      -- آخر سعر شراء
    ));

-- ── حدود التسامح ──
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    receipt_qty_tolerance_percent DECIMAL(5,2) DEFAULT 5.00;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    receipt_price_tolerance_percent DECIMAL(5,2) DEFAULT 2.00;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    allow_over_receipt BOOLEAN DEFAULT true;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    over_receipt_tolerance_percent DECIMAL(5,2) DEFAULT 0.00;

-- ── حسابات محاسبية إضافية ──
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    default_purchase_variance_account_id UUID REFERENCES chart_of_accounts(id);

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    default_gr_ir_clearing_account_id UUID REFERENCES chart_of_accounts(id);

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    default_git_account_id UUID REFERENCES chart_of_accounts(id);

-- ── إعدادات المستندات ──
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    auto_create_receipt_on_confirm BOOLEAN DEFAULT true;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    require_receipt_before_post BOOLEAN DEFAULT true;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    allow_partial_receipt BOOLEAN DEFAULT true;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    auto_close_remaining_qty BOOLEAN DEFAULT false;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    default_receipt_mode TEXT DEFAULT 'direct'
    CHECK (default_receipt_mode IN ('direct', 'international'));

-- ── إعدادات الإشعارات ──
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    notify_warehouse_on_confirm BOOLEAN DEFAULT true;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    notify_accountant_on_receipt BOOLEAN DEFAULT true;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    notify_manager_on_variance BOOLEAN DEFAULT true;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    payment_due_reminder_days INTEGER DEFAULT 7;

-- ── إعدادات الموافقات ──
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    require_approval_for_orders BOOLEAN DEFAULT true;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    approval_threshold_amount DECIMAL(18,2) DEFAULT 10000;

ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS
    require_double_approval_above DECIMAL(18,2) DEFAULT 50000;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  S.2 — حقول قيود التسوية في journal_entries                         ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- القاعدة الذهبية: القيد المُرحّل لا يُعدّل — يُنشأ قيد تسوية منفصل

-- parent_entry_id: ربط قيد التسوية بالقيد الأصلي
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS
    parent_entry_id UUID REFERENCES journal_entries(id);

-- adjustment_reason: سبب التسوية (للتقارير والتدقيق)
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS
    adjustment_reason TEXT;

-- فهرس للبحث السريع عن قيود التسوية
CREATE INDEX IF NOT EXISTS idx_je_parent_entry
    ON journal_entries(parent_entry_id)
    WHERE parent_entry_id IS NOT NULL;

-- فهرس للبحث حسب نوع القيد
CREATE INDEX IF NOT EXISTS idx_je_entry_type
    ON journal_entries(entry_type)
    WHERE entry_type != 'manual';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  تعليق: القيد المُرحّل = مُقفل                                      ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

COMMENT ON COLUMN journal_entries.parent_entry_id IS
    'القيد الأصلي المرجعي — يُستخدم لربط قيود التسوية والعكس بالقيد الأصلي. القيد المُرحّل لا يُعدّل أبداً.';

COMMENT ON COLUMN journal_entries.adjustment_reason IS
    'سبب قيد التسوية — مثال: فرق كمية استلام، فرق سعر، إلخ. يظهر في التقارير والتدقيق.';

COMMENT ON COLUMN company_accounting_settings.receipt_variance_policy IS
    'سياسة معالجة فروقات الاستلام: bill_on_receipt (افتراضي), cost_redistribution, debit_note, variance_account, manual';
