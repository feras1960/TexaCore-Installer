-- ═══════════════════════════════════════════════════════════════
-- Migration: تنظيف الشجرات المحاسبية القديمة
-- التاريخ: 2026-03-11
-- الوصف: حذف Functions V2/V3 القديمة + جداول coa غير المستخدمة
--         + إعادة توجيه apply_chart_template_to_company لاستخدام V5
-- ═══════════════════════════════════════════════════════════════

-- ═══ 1. إعادة توجيه apply_chart_template_to_company ═══
CREATE OR REPLACE FUNCTION public.apply_chart_template_to_company(
    p_company_id uuid, 
    p_template_code character varying
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    IF p_template_code IN ('extended', 'EXTENDED') THEN
        PERFORM create_extended_chart(p_company_id);
        RAISE NOTICE 'V6 — تم تطبيق الشجرة الموسعة V5.2 على الشركة %', p_company_id;
    ELSE
        PERFORM create_simple_chart(p_company_id);
        RAISE NOTICE 'V6 — تم تطبيق الشجرة القياسية V5.1 على الشركة %', p_company_id;
    END IF;
END;
$function$;
COMMENT ON FUNCTION apply_chart_template_to_company IS 'V6: يستدعي create_simple_chart V5.1 أو create_extended_chart V5.2';

-- ═══ 2. حذف Functions القديمة ═══
DROP FUNCTION IF EXISTS create_simple_chart_of_accounts(uuid);
DROP FUNCTION IF EXISTS create_extended_chart_of_accounts(uuid);
DROP FUNCTION IF EXISTS clone_chart_from_template(uuid, uuid);
DROP FUNCTION IF EXISTS apply_coa_template(uuid, character varying);

-- ═══ 3. حذف الجداول غير المستخدمة ═══
DROP TABLE IF EXISTS coa_template_cash_accounts;
DROP TABLE IF EXISTS coa_template_items;
DROP TABLE IF EXISTS coa_templates;

-- ═══ 4. حذف EXTENDED_FABRIC ═══
DELETE FROM chart_templates WHERE template_code IN ('fabric_extended', 'fabric_extended_demo');
