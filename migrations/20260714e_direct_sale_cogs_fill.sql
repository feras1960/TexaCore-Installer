-- ════════════════════════════════════════════════════════════════════════
-- اشتقاق تكلفة بنود البيع المباشر (COGS) — ترقيع direct_post_sale
-- ════════════════════════════════════════════════════════════════════════
-- [نسخة المُثبِّت — مُكيَّفة] الأصل في supabase/migrations كان يفترض نصّ الدالة
-- من هجرة 20260714a (direct_post_sale v3) ويُطلق RAISE EXCEPTION إن غابت علاماته.
-- لكن المُثبِّت يشحن direct_post_sale من 20260626b_full_schema_sync (سلالة مختلفة،
-- رأس القسم C = «الترحيل المحاسبي (إيراد + ضريبة + COGS + ذمم)») ولا يشحن 714a إطلاقاً،
-- فعلامات الترقيع غائبة في كلٍّ من التثبيت الجديد ومسار الترقية. لذا:
--   • إن كانت الدالة غير موجودة  → تخطٍّ آمن.
--   • إن كان الترقيع مطبّقاً مسبقاً (علامة B2 موجودة) → تخطٍّ (idempotent).
--   • إن كانت النسخة v3 (علامات موجودة) → طبّق الترقيع الأصلي حرفياً.
--   • إن كانت أي نسخة أخرى (علامات غائبة) → تخطٍّ آمن بـRAISE NOTICE
--     بدل RAISE EXCEPTION حتى لا يتعطّل مُشغّل الهجرات. لا تغيير سلوكي على دالة المُثبِّت.
-- (المنطق COGS يبقى عبر post_sales_invoice كما في سلالة full-schema-sync.)
-- ════════════════════════════════════════════════════════════════════════

DO $fix$
DECLARE v_def text;
BEGIN
    IF to_regprocedure('public.direct_post_sale(uuid,jsonb)') IS NULL THEN
        RAISE NOTICE '20260714e: direct_post_sale(uuid,jsonb) غير موجودة — تخطٍّ آمن';
        RETURN;
    END IF;

    v_def := pg_get_functiondef('public.direct_post_sale(uuid,jsonb)'::regprocedure);

    -- مطبّق مسبقاً؟ (idempotent)
    IF v_def LIKE '%B2) تعبئة تكلفة البنود%' THEN
        RAISE NOTICE '20260714e: تعبئة COGS مطبّقة مسبقاً — تخطٍّ';
        RETURN;
    END IF;

    -- 1) القسم B: حلّ تكلفة البند من متوسط المخزون عند غيابها (نسخة v3)
    v_def := replace(v_def,
        'COALESCE(sti.cost_price, 0) AS cost_price,',
        'COALESCE(NULLIF(sti.cost_price, 0), (SELECT ist.average_cost FROM inventory_stock ist WHERE ist.material_id = sti.material_id AND ist.warehouse_id = COALESCE(sti.warehouse_id, v_trx.stock_warehouse_id, v_trx.warehouse_id) LIMIT 1), 0) AS cost_price,');

    -- 2) B2: تعبئة تكلفة البنود الصفرية من متوسط تكلفة حركات الفاتورة (قبل الترحيل) — نسخة v3
    v_def := replace(v_def,
        '-- ═══ C) الترحيل المحاسبي — ذرّي ═══',
        '-- ═══ B2) تعبئة تكلفة البنود للـCOGS (البيع المباشر لا يمرّ بتسليم يملؤها) ═══
    UPDATE sales_transaction_items sti
       SET cost_price = sub.avg_cost
      FROM (SELECT material_id, SUM(total_cost) / NULLIF(SUM(quantity), 0) AS avg_cost
              FROM inventory_movements
             WHERE reference_id = p_invoice_id
             GROUP BY material_id) sub
     WHERE sti.transaction_id = p_invoice_id
       AND sub.material_id = sti.material_id
       AND COALESCE(sti.cost_price, 0) = 0
       AND COALESCE(sub.avg_cost, 0) > 0;

    -- ═══ C) الترحيل المحاسبي — ذرّي ═══');

    -- نسخة غير v3 (مثلاً 20260626b full-schema-sync): العلامات غائبة والدالة لم تتغيّر.
    -- تخطٍّ آمن بدل RAISE EXCEPTION الأصلي حتى لا يتعطّل المُشغّل.
    IF v_def NOT LIKE '%B2) تعبئة تكلفة البنود%' THEN
        RAISE NOTICE '20260714e: نسخة direct_post_sale ليست v3 (علامات الترقيع غائبة) — تخطٍّ آمن بلا تعديل';
        RETURN;
    END IF;

    EXECUTE v_def;
    RAISE NOTICE '20260714e: تعبئة COGS مطبّقة على نسخة v3';
END $fix$;
