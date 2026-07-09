-- ════════════════════════════════════════════════════════════════════════
-- 20260702r — إصلاح النجاح الكاذب لتعديل أسعار الـERP بشبكة المتجر
-- ════════════════════════════════════════════════════════════════════════
-- العلّة: وضع تعديل الأسعار في تبويب المنتجات يكتب erp_wholesale/half/special/
--   cost إلى ecommerce_products.update(...) — وهي أعمدة **غير موجودة** هناك
--   (مصدرها الحقيقي fabric_materials.custom_fields). PostgREST يرجع خطأً،
--   لكن Promise.all لا يرمي فيظهر «تم الحفظ» كاذباً وتُهمل القيم بصمت.
-- الحل: RPC مُحصَّنة تكتب القيم لمصدرها (مادة الـERP) بدمج JSONB ذرّي.
--   الواجهة تعيد التوجيه إليها وتتحقق من الأخطاء فعلياً (لا نجاح كاذب).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.ecommerce_set_material_price_overrides(
    p_material_id uuid,
    p_custom_patch jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_company uuid;
BEGIN
    SELECT company_id INTO v_company FROM fabric_materials WHERE id = p_material_id;
    IF NOT FOUND OR v_company IS NULL THEN
        RAISE EXCEPTION 'material % not found or has no company', p_material_id;
    END IF;

    -- عزل المستأجر (يتجاوز service_role/الأدمن ويحظر العابر للشركات)
    PERFORM assert_can_access_company(v_company);

    -- دمج ذرّي: يحافظ على بقية مفاتيح custom_fields
    UPDATE fabric_materials
    SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || COALESCE(p_custom_patch, '{}'::jsonb)
    WHERE id = p_material_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ecommerce_set_material_price_overrides(uuid, jsonb) TO authenticated;

COMMIT;
