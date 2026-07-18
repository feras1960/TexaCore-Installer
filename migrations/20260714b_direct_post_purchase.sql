-- ════════════════════════════════════════════════════════════════════════
-- الشراء المباشر الذرّي — direct_post_purchase(p_invoice_id uuid)
-- ════════════════════════════════════════════════════════════════════════
-- نظير جانب المبيعات direct_post_sale (v3، 20260714a): يستلم بنود فاتورة شراء
-- إلى المخزون استلاماً «سائباً/بالكمية» (لا إنشاء رولونات — استلام الرولونات يبقى
-- في مسار GRN بالمستودع) ثم يُرحّلها محاسبياً، في معاملة واحدة ذرّية.
--
-- المبادئ المنقولة من نمط البيت (direct_post_sale v3):
--   ١) الصلاحية أولاً: يجب أن يجتاز المنادي (auth.uid())
--      check_special_permission('can_direct_purchase') — تتجاوز
--      super_admin/tenant_owner/company_owner تلقائياً (نفس منطق rbacService).
--      المفتاح لا يحتاج بذراً في SQL: يُمنح عبر roles.special_permissions (JSONB)
--      من الواجهة، و check_special_permission لا تُقيّد المفاتيح بقائمة بيضاء.
--   ٢) قفل الصف FOR UPDATE + assert_can_access_company (عزل المستأجر) + حارس is_posted.
--   ٣) حركة inventory_movements نوع 'purchase_receipt' (نوع IN مؤكَّد في تريغر
--      20260712a_inventory_atomic_stock: يُشغّل update_inventory_stock upsert
--      + المتوسط المرجّح ثم sync_material_current_stock) عبر to_warehouse_id.
--   ٤) الترحيل الذرّي عبر post_purchase_invoice(p_invoice_id) — يُرجع jsonb
--      {success,error}؛ عند الفشل RAISE يُجهض كل المعاملة (لا حركات معلّقة).
--   ٥) نموذج الخطأ RAISE-through: لا مُعالِج WHEN OTHERS يبتلع الأخطاء؛ أي RAISE
--      (صلاحية/تحقّق/فشل ترحيل) يُجهض المعاملة كاملةً ويصعد للمنادي برسالته.
--
-- الحارسان (منع الازدواج):
--   • is_posted = true ⇒ 'الفاتورة مُرحَّلة مسبقاً'.
--   • وجود حركات 'purchase_receipt' سابقة لنفس الفاتورة ⇒ 'تم استلام هذه الفاتورة مسبقاً'.
--
-- المستودع لكل بند: COALESCE(بند.warehouse_id، الفاتورة.stock_warehouse_id،
--   الفاتورة.warehouse_id) — وإلا RAISE (لا استلام بلا مستودع).
-- الكلفة: COALESCE(NULLIF(بند.cost_price,0)، بند.unit_price، 0) — سعر الشراء
--   هو الكلفة للاستلام (نظير directStockUpdateService الذي يبني حركة الشراء).
-- ════════════════════════════════════════════════════════════════════════

-- is_pos: نظير sales_transactions.is_pos — تخزّن الواجهة اختيار «المباشر» لكل مستند.
-- (sales_transactions يملكه أصلاً؛ purchase_transactions يفتقده — نضيفه بأمان.)
ALTER TABLE public.purchase_transactions
    ADD COLUMN IF NOT EXISTS is_pos boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.direct_post_purchase(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_trx          purchase_transactions%ROWTYPE;
    v_item         RECORD;
    v_wh           uuid;
    v_cost         numeric;
    v_post         jsonb;
    v_idx          int := 0;
    v_movement_ids uuid[] := '{}';
    v_mv_id        uuid;
    v_ref_no       text;
BEGIN
    -- ═══ 0) الصلاحية أولاً ═══
    -- check_special_permission تُرجع true لـ super_admin/tenant_owner/company_owner
    -- تلقائياً، وإلا تفحص special_permissions->>'can_direct_purchase'.
    IF auth.uid() IS NULL
       OR NOT public.check_special_permission(auth.uid(), 'can_direct_purchase') THEN
        RAISE EXCEPTION 'ليس لديك صلاحية الشراء المباشر';
    END IF;

    -- ═══ 1) قفل الفاتورة + الفحوص ═══
    SELECT * INTO v_trx FROM purchase_transactions WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الفاتورة غير موجودة';
    END IF;

    PERFORM assert_can_access_company(v_trx.company_id);

    IF v_trx.is_posted = true THEN
        RAISE EXCEPTION 'الفاتورة مُرحَّلة مسبقاً';
    END IF;

    -- ═══ 2) حارس الاستلام المزدوج ═══
    -- إن سبق أن أُنشئت حركات استلام لهذه الفاتورة، امنع تكرار زيادة المخزون.
    IF EXISTS (
        SELECT 1 FROM inventory_movements
        WHERE reference_id = p_invoice_id
          AND reference_type = 'purchase_invoice'
          AND movement_type = 'purchase_receipt'
    ) THEN
        RAISE EXCEPTION 'تم استلام هذه الفاتورة مسبقاً';
    END IF;

    v_ref_no := COALESCE(v_trx.invoice_no, v_trx.receipt_no, v_trx.draft_no,
                         LEFT(p_invoice_id::text, 8));

    -- ═══ 3) استلام سائب: حركة 'purchase_receipt' لكل بند بمادة وكمية موجبة ═══
    FOR v_item IN
        SELECT pti.id, pti.material_id, pti.line_number,
               COALESCE(pti.quantity, 0) AS quantity,
               COALESCE(NULLIF(pti.cost_price, 0), pti.unit_price, 0) AS cost,
               COALESCE(pti.warehouse_id, v_trx.stock_warehouse_id, v_trx.warehouse_id) AS wh
        FROM purchase_transaction_items pti
        WHERE pti.transaction_id = p_invoice_id
          AND pti.material_id IS NOT NULL
          AND COALESCE(pti.quantity, 0) > 0
        ORDER BY pti.line_number, pti.id
    LOOP
        v_wh := v_item.wh;
        IF v_wh IS NULL THEN
            RAISE EXCEPTION 'لا يوجد مستودع للبند (مادة %)', v_item.material_id;
        END IF;

        v_cost := v_item.cost;
        v_idx  := v_idx + 1;

        INSERT INTO inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            material_id, to_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by
        ) VALUES (
            v_trx.tenant_id, v_trx.company_id,
            'PIN-' || LEFT(p_invoice_id::text, 8) || '-' || v_idx,
            CURRENT_DATE, 'purchase_receipt',
            v_item.material_id, v_wh, v_item.quantity, v_cost, v_cost * v_item.quantity,
            'purchase_invoice', p_invoice_id, v_ref_no,
            'شراء مباشر — استلام سائب', auth.uid()
        ) RETURNING id INTO v_mv_id;
        v_movement_ids := array_append(v_movement_ids, v_mv_id);
    END LOOP;

    -- ═══ 4) الترحيل المحاسبي (مشتريات + ضريبة مدخلات + ذمم دائنة) — ذرّي ═══
    v_post := post_purchase_invoice(p_invoice_id);
    IF NOT COALESCE((v_post->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'فشل الترحيل المحاسبي: %', COALESCE(v_post->>'error', 'غير معروف');
    END IF;

    -- ═══ 5) وسم الاستلام + ربط الحركة ═══
    -- (post_purchase_invoice تولّى stage/is_posted/posted_*؛ هنا حقول الاستلام فقط.)
    UPDATE purchase_transactions
       SET received_at      = NOW(),
           received_by      = auth.uid(),
           receipt_date     = CURRENT_DATE,
           stock_movement_id = COALESCE(v_movement_ids[1], stock_movement_id)
     WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'movement_ids', to_jsonb(v_movement_ids),
        'received_lines', COALESCE(array_length(v_movement_ids, 1), 0),
        'posting', v_post
    );
END;
$function$;

COMMENT ON FUNCTION public.direct_post_purchase(uuid) IS
    'شراء مباشر ذرّي: صلاحية can_direct_purchase + استلام سائب (حركات purchase_receipt، لا رولونات) + post_purchase_invoice في معاملة واحدة، مع حارسي is_posted والاستلام المزدوج';

GRANT EXECUTE ON FUNCTION public.direct_post_purchase(uuid) TO authenticated, service_role;
