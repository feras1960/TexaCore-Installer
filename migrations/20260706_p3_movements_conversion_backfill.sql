-- ════════════════════════════════════════════════════════════════
-- المرحلة 3 — backfill آمن لأعمدة التحويل في حركات المخزون
-- ════════════════════════════════════════════════════════════════
-- الهدف: ضمان أن كل صفوف inventory_movements تحمل قيماً معنوية في
-- عمودَي التحويل قبل أن يعتمد عليها منطق خصم المخزون في المرحلة 4:
--   • conversion_factor IS NULL  → 1   (تحويل محايد: وحدة الأساس)
--   • base_quantity     IS NULL  → quantity  (الكمية بوحدة الأساس = الكمية الخام)
--
-- idempotent: يُقصر التحديث على الصفوف NULL فقط، فإعادة التشغيل لا تغيّر شيئاً.
-- معاملة واحدة مع NOTICE بعدد الصفوف المتأثّرة (قبل/بعد).
-- ⚠️ pg_catalog فقط عند الحاجة للعدّ — لا information_schema.
-- ════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
    v_cf_null_before  bigint;
    v_bq_null_before  bigint;
    v_cf_updated      bigint;
    v_bq_updated      bigint;
    v_cf_null_after   bigint;
    v_bq_null_after   bigint;
BEGIN
    -- قياس قبل
    SELECT count(*) FILTER (WHERE conversion_factor IS NULL),
           count(*) FILTER (WHERE base_quantity     IS NULL)
      INTO v_cf_null_before, v_bq_null_before
      FROM public.inventory_movements;

    RAISE NOTICE 'قبل: conversion_factor NULL = %, base_quantity NULL = %',
                 v_cf_null_before, v_bq_null_before;

    -- 1) conversion_factor NULL → 1
    UPDATE public.inventory_movements
       SET conversion_factor = 1
     WHERE conversion_factor IS NULL;
    GET DIAGNOSTICS v_cf_updated = ROW_COUNT;

    -- 2) base_quantity NULL → quantity
    UPDATE public.inventory_movements
       SET base_quantity = quantity
     WHERE base_quantity IS NULL;
    GET DIAGNOSTICS v_bq_updated = ROW_COUNT;

    -- قياس بعد
    SELECT count(*) FILTER (WHERE conversion_factor IS NULL),
           count(*) FILTER (WHERE base_quantity     IS NULL)
      INTO v_cf_null_after, v_bq_null_after
      FROM public.inventory_movements;

    RAISE NOTICE 'حُدِّث: conversion_factor = % صف، base_quantity = % صف',
                 v_cf_updated, v_bq_updated;
    RAISE NOTICE 'بعد: conversion_factor NULL = %, base_quantity NULL = %',
                 v_cf_null_after, v_bq_null_after;

    IF v_cf_null_after <> 0 OR v_bq_null_after <> 0 THEN
        RAISE EXCEPTION 'backfill غير مكتمل — بقيت صفوف NULL (cf=%, bq=%)',
                        v_cf_null_after, v_bq_null_after;
    END IF;
END $$;

COMMIT;
