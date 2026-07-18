-- ════════════════════════════════════════════════════════════════════════
-- 20260717r_p4_r8a_incremental_refinalize
-- P4 — البند 2 (R8أ): إعادة تثبيت تزايدية لمصاريف الحاوية المضافة بعد التثبيت
-- ────────────────────────────────────────────────────────────────────────
-- المشكلة (R8أ):
--   حارسا is_cost_finalized (في allocate_container_costs/finalize_container_costs)
--   وcosts_applied_to_stock_at (في apply_landed_cost_to_stock) يرفضان أي إعادة
--   توزيع بعد التثبيت → فاتورة تخليص تصل بعد الاستلام تبقى مسجّلة كمصروف
--   بلا رسملة على المخزون، وتكلفة الوحدة النهائية لا تُحدَّث أبداً.
--
-- الحل — إعادة تثبيت تزايدية:
--   1) بصمة تطبيق بدل الحارس الثنائي:
--        container_items.applied_unit_cost   — تكلفة الوحدة المطبَّقة فعلاً على المخزون
--        containers.costs_applied_version    — عدّاد جولات التطبيق
--        containers.costs_last_applied_at    — طابع آخر جولة
--      (costs_applied_to_stock_at يبقى كما هو = طابع أول تطبيق، للتوافق مع
--       الواجهة والدوال القارئة.)
--   2) Backfill أمان (ضد الاحتساب المزدوج): للحاويات المطبَّقة سابقاً
--      (costs_applied_to_stock_at IS NOT NULL) تُثبَّت applied_unit_cost =
--      final_unit_cost — فالجولة التالية تبدأ من المطبَّق لا من المؤقّت.
--   3) apply_landed_cost_to_stock تصبح تزايدية idempotent:
--        delta = final_unit_cost − COALESCE(applied_unit_cost, unit_cost)
--      نفس منطق (final − provisional) القائم مُمدّداً لجولة ثانية وثالثة…
--      وتختم كل بند بـ applied_unit_cost = final_unit_cost ⇒ إعادة الاستدعاء
--      بلا مصاريف جديدة = صفر أثر (لا تعديل متوسط، لا قيد).
--      قيد الرسملة التكميلي نفسه القائم: Dr مخزون / Cr مصروف استيراد (يُعكس
--      إن كانت الدلتا سالبة). حارس already_applied القديم أُزيل (باتت الدالة
--      نفسها idempotent بالبصمة) — لا يُستدعى من الواجهة إلا عبر finalize/refinalize.
--   4) allocate_container_costs: معامل p_force اختياري (DEFAULT false ⇒ سلوك
--      قائم حرفياً) يسمح بإعادة التوزيع بعد التثبيت لصالح refinalize فقط.
--   5) دالة جديدة refinalize_container_costs(p_container_id, p_user_id):
--      تُستدعى بعد إضافة مصاريف متأخرة على حاوية مثبتة — تعيد التوزيع (force)،
--      تحدّث final_goods_cost، ثم تطبّق الدلتا تزايدياً وتَختم البصمة.
--      ترفض إن لم تكن الحاوية مثبتة أصلاً (المسار الأول يبقى finalize).
--
-- الحدود (موثّقة):
--   * الجزء المُباع قبل إعادة التثبيت يبقى مصروفاً (نفس معالجة COGS القائمة
--     في 20260712h — الدلتا تُرسمل فقط على LEAST(المتبقي بالمخزون، المستلَم)).
--   * مزامنة fabric_rolls تُحدَّث بكل جولة إلى final_unit_cost الجديدة.
--
-- idempotent: ADD COLUMN IF NOT EXISTS + backfill شرطي + CREATE OR REPLACE.
-- التطبيق عبر Supabase MCP execute_sql (كل دفعة معاملة ذاتية).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── (1) الأعمدة الجديدة ───────────────────────────────────────────────────
ALTER TABLE public.container_items
    ADD COLUMN IF NOT EXISTS applied_unit_cost numeric;

ALTER TABLE public.containers
    ADD COLUMN IF NOT EXISTS costs_applied_version integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS costs_last_applied_at timestamptz;

COMMENT ON COLUMN public.container_items.applied_unit_cost IS
'تكلفة الوحدة المطبَّقة فعلاً على تقييم المخزون (بصمة الجولة الأخيرة). الدلتا التالية = final_unit_cost − COALESCE(applied_unit_cost, unit_cost). P4/R8أ.';
COMMENT ON COLUMN public.containers.costs_applied_version IS
'عدّاد جولات تطبيق تكلفة الإنزال على المخزون (0 = لم تُطبَّق). P4/R8أ.';

-- ── (2) Backfill أمان: الحاويات المطبَّقة سابقاً تبدأ من المطبَّق ─────────
UPDATE public.container_items ci
SET applied_unit_cost = ci.final_unit_cost
FROM public.containers c
WHERE ci.container_id = c.id
  AND c.costs_applied_to_stock_at IS NOT NULL
  AND ci.final_unit_cost IS NOT NULL
  AND ci.applied_unit_cost IS NULL;

UPDATE public.containers
SET costs_applied_version = 1,
    costs_last_applied_at = costs_applied_to_stock_at
WHERE costs_applied_to_stock_at IS NOT NULL
  AND costs_applied_version = 0;

-- ── (3) apply_landed_cost_to_stock — تزايدية idempotent بالبصمة ──────────
CREATE OR REPLACE FUNCTION public.apply_landed_cost_to_stock(p_container_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_container      RECORD;
    v_item           RECORD;
    v_delta          NUMERIC;
    v_received_qty   NUMERIC;
    v_target         uuid;
    v_items_revalued INTEGER := 0;
    v_rolls_updated  INTEGER := 0;
    v_row_count      INTEGER;
    v_cap_item       NUMERIC;
    v_capitalized    NUMERIC := 0;
    v_amount         NUMERIC;
    v_user_id        uuid := auth.uid();
    v_inv_acct       uuid;
    v_exp_acct       uuid;
    v_je_id          uuid;
    v_je_skipped     text := NULL;
BEGIN
    SELECT * INTO v_container FROM containers WHERE id = p_container_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'container_not_found');
    END IF;

    PERFORM assert_can_access_company(v_container.company_id);

    IF COALESCE(v_container.is_cost_finalized, false) <> true THEN
        RETURN jsonb_build_object('success', false, 'error', 'costs_not_finalized');
    END IF;

    -- R8أ: لا حارس already_applied ثنائياً بعد اليوم — الدالة تزايدية idempotent:
    -- الدلتا تُحسب من آخر تكلفة مطبَّقة (applied_unit_cost)، فإعادة الاستدعاء
    -- بلا تغيير في التكاليف النهائية = صفر بنود ⇒ صفر أثر.

    FOR v_item IN
        SELECT ci.id, ci.material_id, ci.product_id, ci.unit_cost, ci.final_unit_cost,
               ci.applied_unit_cost,
               ci.received_quantity, ci.expected_quantity,
               COALESCE(ci.warehouse_id, v_container.receiving_warehouse_id) AS wh
        FROM container_items ci
        WHERE ci.container_id = p_container_id
          AND ci.final_unit_cost IS NOT NULL
          AND ci.final_unit_cost <> COALESCE(ci.applied_unit_cost, ci.unit_cost)
    LOOP
        -- الأساس = آخر مطبَّق؛ وإلا المؤقّت (سلوك الجولة الأولى القائم حرفياً)
        v_delta        := v_item.final_unit_cost - COALESCE(v_item.applied_unit_cost, v_item.unit_cost);
        v_received_qty := COALESCE(v_item.received_quantity, v_item.expected_quantity, 0);
        v_target       := COALESCE(v_item.material_id, v_item.product_id);

        IF v_item.wh IS NULL OR v_target IS NULL OR v_received_qty <= 0 THEN
            CONTINUE;
        END IF;

        WITH updated AS (
            UPDATE inventory_stock
            SET average_cost = average_cost
                    + (LEAST(quantity_on_hand, v_received_qty) * v_delta) / NULLIF(quantity_on_hand, 0),
                updated_at = NOW()
            WHERE warehouse_id = v_item.wh
              AND COALESCE(material_id, product_id) = v_target
              AND quantity_on_hand > 0
            RETURNING quantity_on_hand
        )
        SELECT COUNT(*), COALESCE(SUM(LEAST(quantity_on_hand, v_received_qty) * v_delta), 0)
          INTO v_row_count, v_cap_item FROM updated;

        IF v_row_count > 0 THEN
            v_items_revalued := v_items_revalued + 1;
            v_capitalized := v_capitalized + ROUND(v_cap_item, 2);
        END IF;

        UPDATE fabric_rolls
        SET cost_per_meter = v_item.final_unit_cost, final_landed_cost = v_item.final_unit_cost,
            cost_status = 'final', updated_at = NOW()
        WHERE container_item_id = v_item.id;
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        v_rolls_updated := v_rolls_updated + v_row_count;

        -- R8أ: ختم بصمة البند — الجولة القادمة تبدأ من هنا.
        UPDATE container_items
        SET applied_unit_cost = v_item.final_unit_cost, updated_at = NOW()
        WHERE id = v_item.id;
    END LOOP;

    v_amount := ABS(ROUND(v_capitalized, 2));

    IF v_amount <> 0 THEN
        v_inv_acct := resolve_posting_account(v_container.company_id, 'receipt_inventory');
        v_exp_acct := resolve_posting_account(v_container.company_id, 'purchase_expense');

        IF v_inv_acct IS NULL OR v_exp_acct IS NULL THEN
            v_je_skipped := 'missing_accounts';
        ELSE
            INSERT INTO journal_entries (
                tenant_id, company_id, branch_id, entry_date, entry_type, description,
                reference_type, reference_id, reference_number, status, is_posted, created_by
            ) VALUES (
                v_container.tenant_id, v_container.company_id, v_container.branch_id,
                CURRENT_DATE, 'auto',
                'رسملة تكلفة الشحن للمخزون القائم — ' || COALESCE(v_container.container_number, ''),
                'landed_cost_capitalization', p_container_id, v_container.container_number,
                'draft', false, v_user_id
            ) RETURNING id INTO v_je_id;

            INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit)
            VALUES (v_container.tenant_id, v_je_id, 1, v_inv_acct, 'رسملة تكلفة شحن للمخزون القائم',
                    CASE WHEN v_capitalized > 0 THEN v_amount ELSE 0 END,
                    CASE WHEN v_capitalized < 0 THEN v_amount ELSE 0 END);

            INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit)
            VALUES (v_container.tenant_id, v_je_id, 2, v_exp_acct, 'عكس مصروف استيراد مُرسمَل للمخزون',
                    CASE WHEN v_capitalized < 0 THEN v_amount ELSE 0 END,
                    CASE WHEN v_capitalized > 0 THEN v_amount ELSE 0 END);

            UPDATE journal_entries
            SET status = 'posted', is_posted = true, posted_at = NOW(), posted_by = v_user_id
            WHERE id = v_je_id;
        END IF;
    END IF;

    -- R8أ: بصمة التطبيق — العدّاد يزيد فقط حين حدث أثر فعلي؛
    -- costs_applied_to_stock_at يبقى طابع أول تطبيق (توافق خلفي).
    UPDATE containers
    SET costs_applied_to_stock_at = COALESCE(costs_applied_to_stock_at, NOW()),
        costs_applied_version     = costs_applied_version + CASE WHEN v_items_revalued > 0 THEN 1 ELSE 0 END,
        costs_last_applied_at     = CASE WHEN v_items_revalued > 0 THEN NOW() ELSE costs_last_applied_at END,
        updated_at                = NOW()
    WHERE id = p_container_id;

    RETURN jsonb_build_object(
        'success', true, 'items_revalued', v_items_revalued, 'rolls_updated', v_rolls_updated,
        'capitalized', ROUND(v_capitalized, 2), 'journal_entry_id', v_je_id, 'je_skipped', v_je_skipped
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_landed_cost_to_stock(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_landed_cost_to_stock(uuid) TO authenticated;

-- ── (4) allocate_container_costs — معامل p_force لإعادة التوزيع ───────────
-- ملاحظة: تغيير التوقيع بإضافة معامل DEFAULT يبقي الاستدعاءات القائمة
-- (p_container_id, p_allocation_method) صالحة حرفياً — سلوك مطابق عند p_force=false.
DROP FUNCTION IF EXISTS public.allocate_container_costs(uuid, character varying);
CREATE OR REPLACE FUNCTION public.allocate_container_costs(
    p_container_id uuid,
    p_allocation_method character varying DEFAULT NULL::character varying,
    p_force boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_container RECORD;
    v_item RECORD;
    v_total_goods_value NUMERIC := 0;
    v_total_expenses NUMERIC := 0;
    v_total_quantity NUMERIC := 0;
    v_allocation_method VARCHAR;
    v_ratio NUMERIC;
    v_allocated_cost NUMERIC;
    v_final_unit_cost NUMERIC;
    v_items_updated INTEGER := 0;
BEGIN
    SELECT c.*, comp.tenant_id AS comp_tenant_id
    INTO v_container
    FROM containers c
    JOIN companies comp ON c.company_id = comp.id
    WHERE c.id = p_container_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Container not found',
            'error_ar', 'الكونتينر غير موجود'
        );
    END IF;

    -- P0: tenant isolation
    PERFORM assert_can_access_company(v_container.company_id);

    -- R8أ: p_force=true (من refinalize فقط) يسمح بإعادة التوزيع بعد التثبيت.
    IF v_container.is_cost_finalized = true AND NOT COALESCE(p_force, false) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Container costs already finalized',
            'error_ar', 'تكاليف الكونتينر مثبتة بالفعل'
        );
    END IF;

    v_allocation_method := COALESCE(p_allocation_method, v_container.cost_allocation_method, 'by_value');

    SELECT COALESCE(SUM(unit_cost * expected_quantity), 0)
    INTO v_total_goods_value
    FROM container_items
    WHERE container_id = p_container_id;

    SELECT COALESCE(SUM(COALESCE(actual_amount, expected_amount, amount, 0)), 0)
    INTO v_total_expenses
    FROM container_expenses
    WHERE container_id = p_container_id;

    SELECT COALESCE(SUM(expected_quantity), 0)
    INTO v_total_quantity
    FROM container_items
    WHERE container_id = p_container_id;

    FOR v_item IN
        SELECT * FROM container_items WHERE container_id = p_container_id
    LOOP
        CASE v_allocation_method
            WHEN 'by_value' THEN
                IF v_total_goods_value > 0 THEN
                    v_ratio := (v_item.unit_cost * v_item.expected_quantity) / v_total_goods_value;
                ELSE
                    v_ratio := 1.0 / NULLIF((SELECT COUNT(*) FROM container_items WHERE container_id = p_container_id), 0);
                END IF;

            WHEN 'by_quantity' THEN
                IF v_total_quantity > 0 THEN
                    v_ratio := v_item.expected_quantity / v_total_quantity;
                ELSE
                    v_ratio := 1.0 / NULLIF((SELECT COUNT(*) FROM container_items WHERE container_id = p_container_id), 0);
                END IF;

            WHEN 'by_weight' THEN
                SELECT COALESCE(SUM(weight_kg), SUM(expected_quantity)) INTO v_total_quantity
                FROM container_items WHERE container_id = p_container_id;

                IF v_total_quantity > 0 THEN
                    v_ratio := COALESCE(v_item.weight_kg, v_item.expected_quantity) / v_total_quantity;
                ELSE
                    v_ratio := 1.0 / NULLIF((SELECT COUNT(*) FROM container_items WHERE container_id = p_container_id), 0);
                END IF;

            ELSE
                v_ratio := 0;
        END CASE;

        v_allocated_cost := v_total_expenses * COALESCE(v_ratio, 0);

        IF v_item.expected_quantity > 0 THEN
            v_final_unit_cost := (v_item.unit_cost * v_item.expected_quantity + v_allocated_cost) / v_item.expected_quantity;
        ELSE
            v_final_unit_cost := v_item.unit_cost;
        END IF;

        IF v_allocation_method != 'manual' THEN
            UPDATE container_items
            SET
                allocated_costs = v_allocated_cost,
                cost_per_unit_allocated = CASE WHEN expected_quantity > 0 THEN v_allocated_cost / expected_quantity ELSE 0 END,
                provisional_unit_cost = v_item.unit_cost,
                final_unit_cost = v_final_unit_cost,
                total_provisional_cost = v_item.unit_cost * expected_quantity,
                total_final_cost = v_final_unit_cost * expected_quantity,
                updated_at = NOW()
            WHERE id = v_item.id;

            v_items_updated := v_items_updated + 1;
        END IF;
    END LOOP;

    UPDATE containers
    SET
        provisional_goods_cost = v_total_goods_value,
        total_expected_costs = (SELECT COALESCE(SUM(expected_amount), 0) FROM container_expenses WHERE container_id = p_container_id),
        total_actual_costs = v_total_expenses,
        total_landed_cost = v_total_goods_value + v_total_expenses,
        cost_allocation_method = v_allocation_method,
        updated_at = NOW()
    WHERE id = p_container_id;

    RETURN jsonb_build_object(
        'success', true,
        'container_id', p_container_id,
        'allocation_method', v_allocation_method,
        'total_goods_value', v_total_goods_value,
        'total_expenses', v_total_expenses,
        'total_landed_cost', v_total_goods_value + v_total_expenses,
        'items_updated', v_items_updated
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.allocate_container_costs(uuid, character varying, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_container_costs(uuid, character varying, boolean) TO authenticated;

-- ── (5) refinalize_container_costs — إعادة التثبيت التزايدية ──────────────
CREATE OR REPLACE FUNCTION public.refinalize_container_costs(p_container_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_container RECORD;
    v_allocation_result JSONB;
    v_apply_result JSONB;
BEGIN
    SELECT * INTO v_container
    FROM containers
    WHERE id = p_container_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Container not found',
            'error_ar', 'الكونتينر غير موجود'
        );
    END IF;

    PERFORM assert_can_access_company(v_container.company_id);

    -- إعادة التثبيت لا تصلح إلا لحاوية مثبتة أصلاً — المسار الأول finalize.
    IF COALESCE(v_container.is_cost_finalized, false) <> true THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Container costs not finalized yet — use finalize_container_costs',
            'error_ar', 'تكاليف الكونتينر غير مثبتة بعد — استخدم التثبيت الأول'
        );
    END IF;

    -- إعادة التوزيع بالتكاليف الحالية (تشمل المصاريف المتأخرة) — force.
    v_allocation_result := allocate_container_costs(p_container_id, v_container.cost_allocation_method, true);

    IF NOT (v_allocation_result->>'success')::BOOLEAN THEN
        RETURN v_allocation_result;
    END IF;

    UPDATE containers
    SET final_goods_cost = (v_allocation_result->>'total_goods_value')::NUMERIC,
        finalized_at = NOW(),
        finalized_by = p_user_id,
        updated_at = NOW()
    WHERE id = p_container_id;

    -- التطبيق التزايدي: دلتا (النهائي الجديد − المطبَّق سابقاً) فقط.
    v_apply_result := apply_landed_cost_to_stock(p_container_id);

    RETURN jsonb_build_object(
        'success', true,
        'container_id', p_container_id,
        'refinalized_at', NOW(),
        'refinalized_by', p_user_id,
        'allocation', v_allocation_result,
        'stock_application', v_apply_result
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.refinalize_container_costs(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.refinalize_container_costs(uuid, uuid) TO authenticated;

COMMIT;
