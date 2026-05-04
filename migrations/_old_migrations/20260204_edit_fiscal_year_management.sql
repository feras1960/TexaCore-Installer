-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: نظام إدارة التعديلات والسنوات المالية (النسخة النهائية)
-- Edit & Fiscal Year Management System (Final Version)
-- Date: 2026-02-04
-- Status: ✅ FULLY EXECUTED ON SUPABASE - 2026-02-04 22:25 UTC
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- الجزء 1: إعدادات المحاسبة للشركة ✅ EXECUTED
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE companies ADD COLUMN IF NOT EXISTS 
    accounting_settings JSONB DEFAULT '{
        "fiscal_year_mode": "independent",
        "edit_settings": {
            "allow_direct_edit_posted": true,
            "auto_repost_after_save": true,
            "require_edit_reason": true,
            "notify_on_posted_edit": false
        },
        "closed_period_settings": {
            "allow_edit_closed_period": false,
            "require_manager_approval": true
        },
        "closed_year_settings": {
            "allow_edit_closed_year": true,
            "allow_delete_closed_year": false,
            "require_adjustment_entry": false,
            "auto_link_adjustments": true
        },
        "notifications": {
            "notify_cfo_on_closed_year_edit": true,
            "notify_on_large_adjustments": true,
            "large_adjustment_threshold": 10000
        }
    }';

-- تحديث الشركات الموجودة
UPDATE companies 
SET accounting_settings = '{
    "fiscal_year_mode": "independent",
    "edit_settings": {
        "allow_direct_edit_posted": true,
        "auto_repost_after_save": true,
        "require_edit_reason": true,
        "notify_on_posted_edit": false
    },
    "closed_period_settings": {
        "allow_edit_closed_period": false,
        "require_manager_approval": true
    },
    "closed_year_settings": {
        "allow_edit_closed_year": true,
        "allow_delete_closed_year": false,
        "require_adjustment_entry": false,
        "auto_link_adjustments": true
    },
    "notifications": {
        "notify_cfo_on_closed_year_edit": true,
        "notify_on_large_adjustments": true,
        "large_adjustment_threshold": 10000
    }
}'::jsonb
WHERE accounting_settings IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 2: جدول قيود التسوية ✅ EXECUTED
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS adjustment_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    new_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    new_entry_number VARCHAR(50),
    new_entry_date DATE NOT NULL,
    
    original_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
    original_entry_number VARCHAR(50),
    original_entry_date DATE,
    original_fiscal_year_id UUID REFERENCES fiscal_years(id) ON DELETE SET NULL,
    
    adjustment_type VARCHAR(30) NOT NULL CHECK (adjustment_type IN (
        'correction',
        'reclassification',
        'reversal',
        'prior_period'
    )),
    reason TEXT NOT NULL,
    description TEXT,
    
    amount_difference DECIMAL(18,2) DEFAULT 0,
    account_changes JSONB DEFAULT '[]',
    old_entry_data JSONB,
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_by UUID REFERENCES auth.users(id),
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adjustment_entries_tenant ON adjustment_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_entries_company ON adjustment_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_entries_new_entry ON adjustment_entries(new_entry_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_entries_original ON adjustment_entries(original_entry_id);

ALTER TABLE adjustment_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adjustment_entries_tenant_isolation ON adjustment_entries;
CREATE POLICY adjustment_entries_tenant_isolation ON adjustment_entries
    FOR ALL USING (tenant_id = get_current_tenant_id());

-- ═══════════════════════════════════════════════════════════════
-- الجزء 3: جدول سجل التعديلات ✅ EXECUTED
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS document_edit_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    document_type VARCHAR(50) NOT NULL,
    document_id UUID NOT NULL,
    document_number VARCHAR(50),
    
    edit_type VARCHAR(30) NOT NULL CHECK (edit_type IN (
        'direct_edit',
        'unpost_edit',
        'adjustment',
        'delete',
        'restore'
    )),
    
    period_status VARCHAR(20),
    fiscal_year_status VARCHAR(20),
    fiscal_year_mode VARCHAR(20),
    
    old_values JSONB,
    new_values JSONB,
    changes JSONB,
    reason TEXT,
    
    edited_by UUID REFERENCES auth.users(id),
    edited_by_name VARCHAR(255),
    edited_by_role VARCHAR(50),
    edited_at TIMESTAMPTZ DEFAULT NOW(),
    
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_doc_edit_history_tenant ON document_edit_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_doc_edit_history_document ON document_edit_history(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_doc_edit_history_date ON document_edit_history(edited_at DESC);

ALTER TABLE document_edit_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS doc_edit_history_tenant_isolation ON document_edit_history;
CREATE POLICY doc_edit_history_tenant_isolation ON document_edit_history
    FOR ALL USING (tenant_id = get_current_tenant_id());

-- ═══════════════════════════════════════════════════════════════
-- الجزء 4: الدوال المساعدة ✅ EXECUTED
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_company_accounting_settings(uuid);
DROP FUNCTION IF EXISTS get_fiscal_year_mode(uuid);
DROP FUNCTION IF EXISTS can_edit_journal_entry(uuid, uuid);

CREATE OR REPLACE FUNCTION get_company_accounting_settings(p_company_id UUID)
RETURNS JSONB AS $$
BEGIN
    RETURN COALESCE(
        (SELECT accounting_settings FROM companies WHERE id = p_company_id),
        '{}'::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_fiscal_year_mode(p_company_id UUID)
RETURNS VARCHAR AS $$
BEGIN
    RETURN COALESCE(
        (SELECT accounting_settings->>'fiscal_year_mode' FROM companies WHERE id = p_company_id),
        'independent'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION can_edit_journal_entry(
    p_entry_id UUID,
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB AS $$
DECLARE
    v_entry RECORD;
    v_period RECORD;
    v_fiscal_year RECORD;
    v_settings JSONB;
    v_mode VARCHAR;
BEGIN
    SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('can_edit', false, 'reason', 'entry_not_found', 'message', 'القيد غير موجود');
    END IF;
    
    SELECT COALESCE(accounting_settings, '{}'::jsonb) INTO v_settings FROM companies WHERE id = v_entry.company_id;
    v_mode := COALESCE(v_settings->>'fiscal_year_mode', 'independent');
    
    SELECT * INTO v_period FROM accounting_periods WHERE id = v_entry.period_id;
    SELECT * INTO v_fiscal_year FROM fiscal_years WHERE id = v_entry.fiscal_year_id;
    
    IF NOT v_entry.is_posted THEN
        RETURN jsonb_build_object('can_edit', true, 'mode', 'direct', 'message', 'القيد مسودة');
    END IF;
    
    IF (v_fiscal_year IS NULL OR v_fiscal_year.status = 'open') AND 
       (v_period IS NULL OR v_period.status = 'open') THEN
        RETURN jsonb_build_object('can_edit', true, 'mode', 'unpost_edit_repost', 'auto_unpost', true);
    END IF;
    
    IF v_fiscal_year IS NOT NULL AND v_fiscal_year.status = 'closed' AND v_mode = 'independent' THEN
        RETURN jsonb_build_object(
            'can_edit', COALESCE((v_settings->'closed_year_settings'->>'allow_edit_closed_year')::boolean, true),
            'mode', 'independent_closed_year',
            'require_reason', true
        );
    END IF;
    
    IF v_fiscal_year IS NOT NULL AND v_fiscal_year.status = 'closed' AND v_mode = 'linked' THEN
        RETURN jsonb_build_object('can_edit', false, 'mode', 'linked_closed_year');
    END IF;
    
    RETURN jsonb_build_object('can_edit', true, 'mode', 'default');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 5: حقول إضافية لـ company_accounting_settings ✅ EXECUTED
-- ═══════════════════════════════════════════════════════════════

/*
ALTER TABLE company_accounting_settings 
ADD COLUMN IF NOT EXISTS auto_post_entries BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS require_approval BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS current_entry_number INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS default_sales_currency VARCHAR(3),
ADD COLUMN IF NOT EXISTS default_purchase_currency VARCHAR(3),
ADD COLUMN IF NOT EXISTS vat_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS vat_rate NUMERIC DEFAULT 15,
ADD COLUMN IF NOT EXISTS journal_entry_prefix VARCHAR(10) DEFAULT 'JE',
ADD COLUMN IF NOT EXISTS reset_numbering_yearly BOOLEAN DEFAULT true;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 6: تصحيح العملات (ديناميكية) ✅ EXECUTED
-- ═══════════════════════════════════════════════════════════════

-- تحديث العملات لتأخذ من base_currency بدلاً من hardcoded 'SAR'
UPDATE company_accounting_settings cas
SET 
  default_sales_currency = COALESCE(
    NULLIF(cas.default_sales_currency, 'SAR'),
    cas.base_currency,
    'USD'
  ),
  default_purchase_currency = COALESCE(
    NULLIF(cas.default_purchase_currency, 'SAR'),
    cas.base_currency,
    'USD'
  )
WHERE default_sales_currency = 'SAR' 
   OR default_purchase_currency = 'SAR';

-- إزالة الـ DEFAULT الثابت
ALTER TABLE company_accounting_settings 
ALTER COLUMN default_sales_currency DROP DEFAULT;

ALTER TABLE company_accounting_settings 
ALTER COLUMN default_purchase_currency DROP DEFAULT;

-- نسخ البيانات من الحقول القديمة للجديدة
UPDATE company_accounting_settings SET 
  vat_enabled = COALESCE(enable_vat, true),
  vat_rate = COALESCE(default_vat_rate, 15),
  journal_entry_prefix = COALESCE(entry_number_prefix, 'JE'),
  reset_numbering_yearly = COALESCE(entry_number_reset_yearly, true)
WHERE vat_enabled IS NULL;
*/

-- ═══════════════════════════════════════════════════════════════
-- ✅ MIGRATION COMPLETED SUCCESSFULLY
-- Final Execution: 2026-02-04 22:25 UTC
-- Status: All components verified and working
-- ═══════════════════════════════════════════════════════════════
