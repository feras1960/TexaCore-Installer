-- ═══════════════════════════════════════════════════════════════════════════
-- P0 — سدّ ثغرات العزل في دورة المشتريات (2026-07-17)
-- ═══════════════════════════════════════════════════════════════════════════
-- ثلاث دوال SECURITY DEFINER كانت بلا فحص عضوية الشركة (assert_can_access_company)
-- ما يسمح بعبور المستأجرين (تحريك مراحل/ترحيل/توزيع تكاليف لمستندات شركة أخرى).
-- نُضيف الحارس القياسي في أول جسم كل دالة بعد اشتقاق company_id من السجل المستهدف.
--
-- idempotent: CREATE OR REPLACE فقط، بلا DDL هدّام، بلا لمس بيانات.
-- نمط الحارس مطابق لِـ post_purchase_invoice (20260708b).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) advance_transaction_stage — عزل بعد اشتقاق company_id من السجل المقفول
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_transaction_stage(
    p_type text, p_transaction_id uuid, p_new_stage text, p_user_id uuid,
    p_user_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text,
    p_cancellation_reason text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text,
    p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_current_stage TEXT;
    v_company_id UUID;
    v_tenant_id UUID;
    v_generated_no TEXT;
    v_number_field TEXT;
    v_date_field TEXT;
    v_user_field TEXT;
    v_user_name_field TEXT;
    v_at_field TEXT;
    v_sql TEXT;
BEGIN
    -- 1. قفل السجل وقراءة المرحلة الحالية
    IF p_type = 'purchase' THEN
        SELECT stage, company_id, tenant_id
        INTO v_current_stage, v_company_id, v_tenant_id
        FROM purchase_transactions
        WHERE id = p_transaction_id
        FOR UPDATE;
    ELSE
        SELECT stage, company_id, tenant_id
        INTO v_current_stage, v_company_id, v_tenant_id
        FROM sales_transactions
        WHERE id = p_transaction_id
        FOR UPDATE;
    END IF;

    IF v_current_stage IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'المعاملة غير موجودة');
    END IF;

    -- 🔒 P0: عزل المستأجر — امنع تحريك مراحل مستندات شركة أخرى
    PERFORM assert_can_access_company(v_company_id);

    -- 2. التحقق من صلاحية التحويل
    IF NOT is_valid_stage_transition(p_type, v_current_stage, p_new_stage) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('تحويل غير مسموح: %s → %s', v_current_stage, p_new_stage)
        );
    END IF;

    -- 3. تحديد حقول المستخدم لهذه المرحلة
    v_user_field := CASE p_new_stage
        WHEN 'quotation' THEN 'quoted_by'
        WHEN 'reservation' THEN 'reserved_by'
        WHEN 'order' THEN 'ordered_by'
        WHEN 'approved' THEN 'approved_by'
        WHEN 'receipt' THEN 'received_by'
        WHEN 'delivery' THEN 'delivered_by'
        WHEN 'invoice' THEN 'invoiced_by'
        WHEN 'posted' THEN 'posted_by'
        WHEN 'cancelled' THEN 'cancelled_by'
        ELSE NULL
    END;

    v_user_name_field := CASE WHEN v_user_field IS NOT NULL THEN v_user_field || '_name' ELSE NULL END;

    v_at_field := CASE p_new_stage
        WHEN 'quotation' THEN 'quoted_at'
        WHEN 'reservation' THEN 'reserved_at'
        WHEN 'order' THEN 'ordered_at'
        WHEN 'approved' THEN 'approved_at'
        WHEN 'receipt' THEN 'received_at'
        WHEN 'delivery' THEN 'delivered_at'
        WHEN 'invoice' THEN 'invoiced_at'
        WHEN 'posted' THEN 'posted_at'
        WHEN 'cancelled' THEN 'cancelled_at'
        ELSE NULL
    END;

    -- 4. توليد رقم
    IF p_new_stage IN ('quotation', 'reservation', 'order', 'receipt', 'delivery', 'invoice') THEN
        v_generated_no := generate_stage_number(v_tenant_id, v_company_id, p_type, p_new_stage);
        v_number_field := p_new_stage || '_no';
        v_date_field := p_new_stage || '_date';
    END IF;

    -- 5. تحديث السجل
    IF p_type = 'purchase' THEN
        v_sql := 'UPDATE purchase_transactions SET stage = $1, updated_at = NOW(), updated_by = $2';
    ELSE
        v_sql := 'UPDATE sales_transactions SET stage = $1, updated_at = NOW(), updated_by = $2';
    END IF;

    IF v_number_field IS NOT NULL AND v_generated_no IS NOT NULL THEN
        v_sql := v_sql || format(', %I = %L', v_number_field, v_generated_no);
        v_sql := v_sql || format(', %I = CURRENT_DATE', v_date_field);
    END IF;

    IF v_user_field IS NOT NULL THEN
        v_sql := v_sql || format(', %I = %L', v_user_field, p_user_id);
        IF p_user_name IS NOT NULL AND v_user_name_field IS NOT NULL THEN
            v_sql := v_sql || format(', %I = %L', v_user_name_field, p_user_name);
        END IF;
        IF v_at_field IS NOT NULL THEN
            v_sql := v_sql || format(', %I = NOW()', v_at_field);
        END IF;
    END IF;

    IF p_new_stage = 'posted' THEN
        v_sql := v_sql || ', is_posted = true';
    END IF;

    IF p_new_stage = 'cancelled' AND p_cancellation_reason IS NOT NULL THEN
        v_sql := v_sql || format(', cancellation_reason = %L', p_cancellation_reason);
    END IF;

    IF p_new_stage = 'approved' AND p_notes IS NOT NULL THEN
        v_sql := v_sql || format(', approval_notes = %L', p_notes);
    END IF;

    v_sql := v_sql || ' WHERE id = $3';

    EXECUTE v_sql USING p_new_stage, p_user_id, p_transaction_id;

    -- 6. تسجيل في سجل المراحل
    INSERT INTO transaction_stage_log (
        transaction_type, transaction_id,
        from_stage, to_stage,
        generated_number, notes,
        performed_by, performed_by_name, ip_address, user_agent
    ) VALUES (
        p_type, p_transaction_id,
        v_current_stage, p_new_stage,
        v_generated_no, COALESCE(p_notes, p_cancellation_reason),
        p_user_id, p_user_name, p_ip_address, p_user_agent
    );

    -- 7. النتيجة
    RETURN jsonb_build_object(
        'success', true,
        'from_stage', v_current_stage,
        'to_stage', p_new_stage,
        'generated_number', v_generated_no,
        'performed_by', p_user_id,
        'performed_by_name', p_user_name
    );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) post_purchase_return — عزل بعد اشتقاق company_id من المرتجع
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_purchase_return(p_return_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_return       RECORD;
    v_item         RECORD;
    v_je_id        UUID;
    v_user_id      UUID;
    v_total        NUMERIC(15,4) := 0;
    v_movement_count INT := 0;
    v_account_inventory UUID;
    v_account_ap   UUID;
    v_movement_number VARCHAR(50);
    v_wh_id        UUID;
BEGIN
    v_user_id := auth.uid();

    SELECT * INTO v_return FROM purchase_returns WHERE id = p_return_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'مرتجع المشتريات غير موجود');
    END IF;

    -- 🔒 P0: عزل المستأجر — امنع ترحيل مرتجع مشتريات لشركة أخرى
    PERFORM assert_can_access_company(v_return.company_id);

    IF v_return.status = 'posted' THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرتجع مُرحَّل مسبقاً');
    END IF;

    v_wh_id := COALESCE(p_warehouse_id, v_return.warehouse_id);

    UPDATE purchase_returns SET status = 'posted', updated_at = NOW() WHERE id = p_return_id;

    FOR v_item IN SELECT * FROM purchase_return_items WHERE return_id = p_return_id
    LOOP
        v_movement_count := v_movement_count + 1;
        v_total := v_total + COALESCE(v_item.total, v_item.quantity_returned * COALESCE(v_item.unit_price, 0));

        v_movement_number := 'PR-' || COALESCE(v_return.return_number, '') || '-' || v_movement_count;

        INSERT INTO inventory_movements (
            tenant_id, company_id,
            movement_number, movement_date,
            movement_type,
            product_id, material_id, variant_id,
            from_warehouse_id,
            quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number,
            notes, created_by
        ) VALUES (
            v_return.tenant_id, v_return.company_id,
            v_movement_number, CURRENT_DATE,
            'return_out',
            v_item.product_id, v_item.material_id, v_item.variant_id,
            v_wh_id,
            v_item.quantity_returned, COALESCE(v_item.unit_price, 0),
            COALESCE(v_item.total, v_item.quantity_returned * COALESCE(v_item.unit_price, 0)),
            'purchase_return', p_return_id, v_return.return_number,
            'مرتجع مشتريات', v_user_id
        );
    END LOOP;

    -- ── الحسابات (عبر المحلّل الموحّد) ──
    v_account_inventory := resolve_posting_account(v_return.company_id, 'preturn_inventory');
    v_account_ap        := resolve_posting_account(v_return.company_id, 'preturn_payable');

    IF v_account_inventory IS NOT NULL AND v_account_ap IS NOT NULL AND v_total > 0 THEN
        INSERT INTO journal_entries (
            tenant_id, company_id, branch_id,
            entry_date, entry_type,
            description,
            reference_type, reference_id, reference_number,
            status, is_posted, posted_at, posted_by,
            created_by
        ) VALUES (
            v_return.tenant_id, v_return.company_id, v_return.branch_id,
            CURRENT_DATE, 'auto',
            'مرتجع مشتريات — ' || COALESCE(v_return.return_number, ''),
            'purchase_return', p_return_id, v_return.return_number,
            'draft', false, NULL, NULL,
            v_user_id
        ) RETURNING id INTO v_je_id;

        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, party_type, party_id)
        VALUES (v_return.tenant_id, v_je_id, 1, v_account_ap, 'تخفيض ذمم دائنة — مرتجع', v_total, 0, 'supplier', v_return.supplier_id);

        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit)
        VALUES (v_return.tenant_id, v_je_id, 2, v_account_inventory, 'إرجاع مخزون — مرتجع مشتريات', 0, v_total);

        UPDATE journal_entries SET status = 'posted', is_posted = true, posted_at = NOW(), posted_by = v_user_id WHERE id = v_je_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'return_id', p_return_id,
        'movements_created', v_movement_count,
        'total_amount', v_total,
        'journal_entry_id', v_je_id,
        'message', 'تم ترحيل مرتجع المشتريات بنجاح'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) allocate_container_costs — عزل بعد اشتقاق company_id من الحاوية
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allocate_container_costs(p_container_id uuid, p_allocation_method character varying DEFAULT NULL::character varying)
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
    v_result JSONB;
BEGIN
    -- جلب بيانات الكونتينر
    SELECT c.*, comp.tenant_id
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

    -- 🔒 P0: عزل المستأجر — امنع توزيع تكاليف حاوية شركة أخرى
    PERFORM assert_can_access_company(v_container.company_id);

    -- التحقق من أن التكاليف غير مثبتة
    IF v_container.is_cost_finalized = true THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Container costs already finalized',
            'error_ar', 'تكاليف الكونتينر مثبتة بالفعل'
        );
    END IF;

    -- تحديد طريقة التوزيع
    v_allocation_method := COALESCE(p_allocation_method, v_container.cost_allocation_method, 'by_value');

    -- حساب إجمالي قيمة البضاعة
    SELECT COALESCE(SUM(unit_cost * expected_quantity), 0)
    INTO v_total_goods_value
    FROM container_items
    WHERE container_id = p_container_id;

    -- حساب إجمالي المصاريف
    SELECT COALESCE(SUM(COALESCE(actual_amount, expected_amount, amount, 0)), 0)
    INTO v_total_expenses
    FROM container_expenses
    WHERE container_id = p_container_id;

    -- حساب إجمالي الكمية (لطريقة by_quantity)
    SELECT COALESCE(SUM(expected_quantity), 0)
    INTO v_total_quantity
    FROM container_items
    WHERE container_id = p_container_id;

    -- توزيع المصاريف على البنود
    FOR v_item IN
        SELECT * FROM container_items WHERE container_id = p_container_id
    LOOP
        -- حساب النسبة حسب طريقة التوزيع
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
                -- توزيع حسب الوزن
                SELECT COALESCE(SUM(weight_kg), SUM(expected_quantity)) INTO v_total_quantity
                FROM container_items WHERE container_id = p_container_id;

                IF v_total_quantity > 0 THEN
                    v_ratio := COALESCE(v_item.weight_kg, v_item.expected_quantity) / v_total_quantity;
                ELSE
                    v_ratio := 1.0 / NULLIF((SELECT COUNT(*) FROM container_items WHERE container_id = p_container_id), 0);
                END IF;

            ELSE -- manual or unknown
                v_ratio := 0; -- keep existing values
        END CASE;

        -- حساب التكلفة الموزعة
        v_allocated_cost := v_total_expenses * COALESCE(v_ratio, 0);

        -- حساب تكلفة الوحدة النهائية
        IF v_item.expected_quantity > 0 THEN
            v_final_unit_cost := (v_item.unit_cost * v_item.expected_quantity + v_allocated_cost) / v_item.expected_quantity;
        ELSE
            v_final_unit_cost := v_item.unit_cost;
        END IF;

        -- تحديث البند
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

    -- تحديث الكونتينر
    UPDATE containers
    SET
        provisional_goods_cost = v_total_goods_value,
        total_expected_costs = (SELECT COALESCE(SUM(expected_amount), 0) FROM container_expenses WHERE container_id = p_container_id),
        total_actual_costs = v_total_expenses,
        total_landed_cost = v_total_goods_value + v_total_expenses,
        cost_allocation_method = v_allocation_method,
        updated_at = NOW()
    WHERE id = p_container_id;

    -- إرجاع النتيجة
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

COMMIT;
