-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Document Confirmation & Approval Workflow
-- Date: 2026-02-11
-- Description: 
--   1. Company workflow settings table
--   2. Confirmation/approval columns on trade documents
--   3. Approval requests table
--   4. Helper function for confirmation logic
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. Company Workflow Settings - إعدادات الوورك فلو للشركة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS company_workflow_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,

    -- ═══ Approval Settings - إعدادات الموافقة ═══
    require_manager_approval_quotation BOOLEAN DEFAULT false,
    require_manager_approval_order BOOLEAN DEFAULT false,
    require_manager_approval_invoice BOOLEAN DEFAULT false,
    require_manager_approval_reservation BOOLEAN DEFAULT false,

    -- Amount threshold — above this, manager approval is mandatory
    approval_amount_threshold NUMERIC(15,2) DEFAULT 0, -- 0 = no threshold

    -- ═══ Confirmation Settings - إعدادات التأكيد ═══
    auto_create_delivery_on_confirm BOOLEAN DEFAULT true,
    allow_edit_after_confirm BOOLEAN DEFAULT false,
    edit_after_confirm_roles TEXT[] DEFAULT ARRAY['company_admin', 'tenant_owner'],

    -- ═══ Notification Settings - إعدادات الإشعارات ═══
    notify_warehouse_on_confirm BOOLEAN DEFAULT true,
    notify_manager_on_save BOOLEAN DEFAULT false,
    notify_channel TEXT DEFAULT 'internal', -- 'internal', 'telegram', 'both'

    -- ═══ Payment Gate ═══
    require_payment_for_confirmation BOOLEAN DEFAULT false,
    min_payment_percent NUMERIC(5,2) DEFAULT 0, -- e.g. 30 = 30% deposit required

    -- ═══ Metadata ═══
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(company_id)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. Add confirmation columns to trade documents
-- ═══════════════════════════════════════════════════════════════

-- Quotations
DO $$ BEGIN
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS confirmation_status TEXT DEFAULT 'draft';
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS confirmed_by UUID;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'none'; -- 'none','pending','approved','rejected'
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_by UUID;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approval_notes TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS delivery_note_id UUID;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Sales Orders
DO $$ BEGIN
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS confirmation_status TEXT DEFAULT 'draft';
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS confirmed_by UUID;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'none';
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS approved_by UUID;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS approval_notes TEXT;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_note_id UUID;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Sales Invoices
DO $$ BEGIN
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS confirmation_status TEXT DEFAULT 'draft';
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS confirmed_by UUID;
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'none';
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS approved_by UUID;
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS approval_notes TEXT;
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS delivery_note_id UUID;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. Document Approval Requests - طلبات الموافقة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS document_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,

    -- Source Document
    doc_type TEXT NOT NULL, -- 'quotation','sales_order','sales_invoice','reservation'
    doc_id UUID NOT NULL,
    doc_number TEXT,

    -- Request Details
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ DEFAULT now(),
    request_notes TEXT,

    -- Approval Details
    status TEXT DEFAULT 'pending', -- 'pending','approved','rejected','cancelled'
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Amount (for threshold checks)
    total_amount NUMERIC(15,2) DEFAULT 0,
    currency TEXT DEFAULT 'USD',

    -- Notification tracking
    notification_sent BOOLEAN DEFAULT false,
    notification_id UUID, -- FK to in_app_notifications

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 4. Indexes
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_company_workflow_settings_company
    ON company_workflow_settings(company_id);

CREATE INDEX IF NOT EXISTS idx_doc_approval_requests_doc
    ON document_approval_requests(doc_type, doc_id);

CREATE INDEX IF NOT EXISTS idx_doc_approval_requests_status
    ON document_approval_requests(company_id, status);

CREATE INDEX IF NOT EXISTS idx_doc_approval_requests_reviewer
    ON document_approval_requests(reviewed_by, status);

-- Indexes on trade tables for confirmation queries
DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_quotations_confirmation_status 
        ON quotations(company_id, confirmation_status);
    CREATE INDEX IF NOT EXISTS idx_sales_orders_confirmation_status 
        ON sales_orders(company_id, confirmation_status);
    CREATE INDEX IF NOT EXISTS idx_sales_invoices_confirmation_status 
        ON sales_invoices(company_id, confirmation_status);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS Policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE company_workflow_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_approval_requests ENABLE ROW LEVEL SECURITY;

-- company_workflow_settings
DO $$ BEGIN
    DROP POLICY IF EXISTS "cws_select" ON company_workflow_settings;
    CREATE POLICY "cws_select" ON company_workflow_settings
        FOR SELECT USING (auth.uid() IS NOT NULL);
    
    DROP POLICY IF EXISTS "cws_insert" ON company_workflow_settings;
    CREATE POLICY "cws_insert" ON company_workflow_settings
        FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

    DROP POLICY IF EXISTS "cws_update" ON company_workflow_settings;
    CREATE POLICY "cws_update" ON company_workflow_settings
        FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- document_approval_requests
DO $$ BEGIN
    DROP POLICY IF EXISTS "dar_select" ON document_approval_requests;
    CREATE POLICY "dar_select" ON document_approval_requests
        FOR SELECT USING (auth.uid() IS NOT NULL);
    
    DROP POLICY IF EXISTS "dar_insert" ON document_approval_requests;
    CREATE POLICY "dar_insert" ON document_approval_requests
        FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

    DROP POLICY IF EXISTS "dar_update" ON document_approval_requests;
    CREATE POLICY "dar_update" ON document_approval_requests
        FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 6. Trigger: Update updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER trg_cws_updated
        BEFORE UPDATE ON company_workflow_settings
        FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_dar_updated
        BEFORE UPDATE ON document_approval_requests
        FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 7. Helper: Get workflow settings or defaults
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_workflow_settings(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
    v_settings JSONB;
BEGIN
    SELECT to_jsonb(cws.*) INTO v_settings
    FROM company_workflow_settings cws
    WHERE cws.company_id = p_company_id
    LIMIT 1;

    -- Return defaults if no settings exist
    IF v_settings IS NULL THEN
        v_settings := jsonb_build_object(
            'require_manager_approval_quotation', false,
            'require_manager_approval_order', false,
            'require_manager_approval_invoice', false,
            'require_manager_approval_reservation', false,
            'approval_amount_threshold', 0,
            'auto_create_delivery_on_confirm', true,
            'allow_edit_after_confirm', false,
            'edit_after_confirm_roles', ARRAY['company_admin', 'tenant_owner'],
            'notify_warehouse_on_confirm', true,
            'notify_manager_on_save', false,
            'notify_channel', 'internal',
            'require_payment_for_confirmation', false,
            'min_payment_percent', 0
        );
    END IF;

    RETURN v_settings;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Done!
-- ═══════════════════════════════════════════════════════════════
