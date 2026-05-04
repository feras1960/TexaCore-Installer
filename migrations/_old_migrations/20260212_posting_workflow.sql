-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Posting Workflow Settings
-- Date: 2026-02-12
-- Description: Add auto-posting settings to company_workflow_settings
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ Add posting settings columns ═══
DO $$ BEGIN
    ALTER TABLE company_workflow_settings 
        ADD COLUMN IF NOT EXISTS auto_post_invoice BOOLEAN DEFAULT false;
    -- true  = الفاتورة تُرحّل تلقائياً عند الحفظ
    -- false = يجب الضغط على زر الترحيل يدوياً (الافتراضي)

    ALTER TABLE company_workflow_settings 
        ADD COLUMN IF NOT EXISTS auto_post_delivery BOOLEAN DEFAULT false;
    -- true  = إذن التسليم يُرحّل تلقائياً عند الحفظ

    ALTER TABLE company_workflow_settings 
        ADD COLUMN IF NOT EXISTS auto_post_receipt BOOLEAN DEFAULT false;
    -- true  = استلام البضاعة يُرحّل تلقائياً عند الحفظ

    ALTER TABLE company_workflow_settings 
        ADD COLUMN IF NOT EXISTS auto_post_return BOOLEAN DEFAULT false;
    -- true  = المرتجع يُرحّل تلقائياً عند الحفظ

    ALTER TABLE company_workflow_settings 
        ADD COLUMN IF NOT EXISTS require_post_confirmation BOOLEAN DEFAULT true;
    -- true  = يسأل "هل تريد الترحيل؟" قبل الترحيل
    -- false = يرحّل مباشرة بدون سؤال

EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ═══ Update helper function to include new settings ═══
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
            'min_payment_percent', 0,
            -- Posting settings
            'auto_post_invoice', false,
            'auto_post_delivery', false,
            'auto_post_receipt', false,
            'auto_post_return', false,
            'require_post_confirmation', true
        );
    END IF;

    RETURN v_settings;
END;
$$;

-- Done!
