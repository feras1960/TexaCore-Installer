-- ═══════════════════════════════════════════════════════════════════════════
-- P2 — ذرّية استلام البضائع (GRN) + حماية السباق + إصلاح R9 (Cr 1145 المزدوج)
-- ═══════════════════════════════════════════════════════════════════════════
-- المشكلة (تدقيق المشتريات 2026-07-17):
--   • R5: مسار completeReceipt في receiptCompletionService.ts غير ذرّي —
--     Promise.allSettled يبتلع الأخطاء، وفحص «إيصال مكتمل موجود» قراءة-ثم-كتابة
--     (TOCTOU) بلا قفل ولا قيد فريد → نقرتان متزامنتان = إيصالان + مخزون مزدوج،
--     أو حركات بلا قيد/قيد بلا حركات.
--   • R9: الفرع الدولي في handleAccountingEntry يقيّد Cr 1145 دائماً، حتى للفاتورة
--     الدولية المرتبطة بحاوية التي نُقل رصيدها 1145→حساب الحاوية عند الترحيل →
--     ازدواج الطرف الدائن → 1145 سالب وحساب الحاوية غير مُقفَل.
--
-- الحل: دالة SQL ذرّية واحدة complete_goods_receipt(jsonb) تنقل القسم الحرج من TS
--   للخادم داخل معاملة واحدة:
--     (1) عزل المستأجر assert_can_access_company
--     (2) قفل تسلسلي pg_advisory_xact_lock بمفتاح المستند المصدر (يمنع السباق)
--     (3) حارس idempotency بمفتاح دفعة (idempotency_key) — إعادة المحاولة بنفس
--         المحتوى تُعيد الإيصال القائم بلا ازدواج (بدل رمي خطأ القيد الفريد).
--         ملاحظة: قيود فريدة قائمة مسبقاً (uq_receipt_invoice_active/_container_active/
--         _order_active) تفرض إيصالاً واحداً نشطاً لكل مستند مصدر — وهي الحاجز الصلب
--         النهائي ضد الازدواج فوق القفل، ولم نلمسها (النموذج القائم: إيصال واحد/مستند).
--     (4) سجل الإيصال (ترقية مسودّة أو إدراج) + حركات المخزون + القيد المحاسبي
--         (نقل حرفي من handleAccountingEntry: فرعا الحاوية/غير-الحاوية) + received_qty/stage
--     (5) إصلاح R9 داخل الفرع الدولي: المرتبط بحاوية → Cr حساب الحاوية؛ غير المرتبط → Cr 1145
--
-- ملاحظات النزاهة المحاسبية (تحقّق من الحيّ):
--   • تريغر trg_update_account_balance (AFTER INSERT على journal_entry_lines) يحدّث
--     chart_of_accounts.current_balance فقط حين status='posted' → لذا نُدرج ترويسة
--     القيد بـstatus='posted' مباشرةً ثم السطور (كما يفعل مسار TS الحالي حرفياً)،
--     ولا نستدعي post_journal_entry (كان سيضاعف الرصيد). صفر تغيير سلوك محاسبي.
--   • الفواتير الحقيقية في purchase_transactions (جدول purchase_invoices مهجور/فارغ).
--
-- idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + CREATE OR REPLACE.
-- بلا DDL هدّام، بلا لمس بيانات.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- (أ) مفتاح الدفعة: عمود + قيد فريد جزئي (حماية DB-level ضد السباق فوق القفل)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.purchase_receipts
    ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_receipts_idem
    ON public.purchase_receipts (company_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND is_deleted = false;

-- ───────────────────────────────────────────────────────────────────────────
-- (ب) complete_goods_receipt — القسم الحرج الذرّي للاستلام
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_goods_receipt(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_tenant_id    uuid := (p_payload->>'tenant_id')::uuid;
    v_company_id   uuid := (p_payload->>'company_id')::uuid;
    v_branch_id    uuid := NULLIF(p_payload->>'branch_id','')::uuid;
    v_warehouse_id uuid := NULLIF(p_payload->>'warehouse_id','')::uuid;
    v_src_id       uuid := (p_payload->>'source_document_id')::uuid;
    v_src_type     text := p_payload->>'source_document_type';
    v_src_num      text := COALESCE(p_payload->>'source_document_number','');
    v_supplier_id  uuid := NULLIF(p_payload->>'supplier_id','')::uuid;
    v_receipt_num  text := p_payload->>'receipt_number';
    v_request_key  text := NULLIF(p_payload->>'request_key','');
    v_notes        text := COALESCE(NULLIF(p_payload->>'notes',''), 'Receipt for '||v_src_num);
    v_created_by   uuid := COALESCE(NULLIF(p_payload->>'created_by','')::uuid, auth.uid());
    v_actual_total numeric := COALESCE((p_payload->>'actual_total')::numeric, 0);
    v_move_ref     text := COALESCE(NULLIF(p_payload->>'movement_ref_number',''), v_receipt_num);
    v_items        jsonb := COALESCE(p_payload->'items', '[]'::jsonb);

    v_var_status   text    := p_payload->'variance'->>'status';
    v_var_amount   numeric := NULLIF(p_payload->'variance'->>'amount','')::numeric;
    v_var_pct      numeric := NULLIF(p_payload->'variance'->>'pct','')::numeric;
    v_var_tol      numeric := NULLIF(p_payload->'variance'->>'tolerance_pct','')::numeric;

    v_is_order     boolean := (v_src_type = 'purchase_order');
    v_is_container boolean := (v_src_type = 'container');
    v_is_invoice   boolean := NOT (v_src_type = 'purchase_order') AND NOT (v_src_type = 'container');

    v_receipt_id   uuid;
    v_existing     RECORD;
    v_draft_id     uuid;
    v_src_col      text;
    v_move_type    text;
    v_num_core     text := replace(COALESCE(v_receipt_num,''),'GRN-','');

    v_item         jsonb;
    v_mat          uuid;
    v_qty          numeric;
    v_ucost        numeric;
    v_rolls        int;
    v_idx          int := 0;
    v_moves        int := 0;

    v_inv_acc      uuid;
    v_pay_acc      uuid;
    v_purch_acc    uuid;
    v_transit_acc  uuid;
    v_debit_acc    uuid;
    v_credit_acc   uuid := NULL;
    v_cont_acc     uuid;
    v_cont_num     text;
    v_cont_bal     numeric;
    v_receipt_mode text;
    v_inv_container uuid;
    v_je_id        uuid := NULL;
    v_desc         text := NULL;

    v_ord          numeric;
    v_rcv          numeric;
    v_fully        boolean := NULL;
BEGIN
    -- ═══ عزل المستأجر ═══
    PERFORM assert_can_access_company(v_company_id);

    IF v_request_key IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'مفتاح الدفعة (request_key) مطلوب لضمان عدم الازدواج');
    END IF;

    -- ═══ قفل تسلسلي على المستند المصدر — يُسلسِل نقرتين متزامنتين على نفس المستند ═══
    PERFORM pg_advisory_xact_lock(hashtextextended(v_src_id::text, 0));

    -- ═══ حارس idempotency: نفس مفتاح الدفعة → أعِد نتيجة الإيصال القائم بلا ازدواج ═══
    SELECT id, receipt_number, journal_entry_id
      INTO v_existing
    FROM purchase_receipts
    WHERE company_id = v_company_id
      AND idempotency_key = v_request_key
      AND is_deleted = false
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true, 'already_processed', true,
            'receipt_id', v_existing.id, 'receipt_number', v_existing.receipt_number,
            'journal_entry_id', v_existing.journal_entry_id, 'movements_created', 0);
    END IF;

    -- ═══ 1) سجل الإيصال — ترقية مسودّة قائمة أو إدراج جديد ═══
    v_src_col := CASE WHEN v_is_order THEN 'order_id'
                      WHEN v_is_container THEN 'container_id'
                      ELSE 'invoice_id' END;

    EXECUTE format(
       'SELECT id FROM purchase_receipts
          WHERE company_id = $1 AND %I = $2
            AND status IN (''draft'',''in_progress'')
            AND is_deleted = false
          ORDER BY created_at LIMIT 1', v_src_col)
    INTO v_draft_id USING v_company_id, v_src_id;

    IF v_draft_id IS NOT NULL THEN
        UPDATE purchase_receipts SET
            receipt_number = v_receipt_num,
            receipt_date   = CURRENT_DATE,
            status         = 'completed',
            notes          = v_notes,
            warehouse_id   = v_warehouse_id,
            idempotency_key = v_request_key,
            variance_status = COALESCE(v_var_status, 'ok'),
            variance_amount = v_var_amount,
            variance_pct    = COALESCE(v_var_pct, 0),
            variance_tolerance_pct = COALESCE(v_var_tol, 1),
            updated_at      = NOW()
        WHERE id = v_draft_id;
        v_receipt_id := v_draft_id;
    ELSE
        INSERT INTO purchase_receipts (
            tenant_id, company_id, branch_id, receipt_number, receipt_date, receipt_type,
            order_id, invoice_id, container_id, supplier_id, warehouse_id, status, notes, created_by,
            idempotency_key, variance_status, variance_amount, variance_pct, variance_tolerance_pct)
        VALUES (
            v_tenant_id, v_company_id, v_branch_id, v_receipt_num, CURRENT_DATE,
            CASE WHEN v_is_container THEN 'container' ELSE 'direct' END,
            CASE WHEN v_is_order THEN v_src_id END,
            CASE WHEN v_is_invoice THEN v_src_id END,
            CASE WHEN v_is_container THEN v_src_id END,
            v_supplier_id, v_warehouse_id, 'completed', v_notes, v_created_by,
            v_request_key, COALESCE(v_var_status,'ok'), v_var_amount, COALESCE(v_var_pct,0), COALESCE(v_var_tol,1))
        RETURNING id INTO v_receipt_id;
    END IF;

    -- ═══ 2) حركات المخزون — نوع receipt/container_receipt، مرجع goods_receipt ═══
    --     (نقل حرفي من createInventoryMovements: unit_cost=سعر المصدر، ref=goods_receipt/الإيصال)
    v_move_type := CASE WHEN v_is_container THEN 'container_receipt' ELSE 'receipt' END;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_mat   := NULLIF(v_item->>'material_id','')::uuid;
        v_qty   := COALESCE((v_item->>'quantity')::numeric, 0);
        v_ucost := COALESCE((v_item->>'unit_cost')::numeric, 0);
        v_rolls := COALESCE((v_item->>'roll_count')::int, 0);
        IF v_mat IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
        v_idx := v_idx + 1;
        INSERT INTO inventory_movements (
            tenant_id, company_id, product_id, material_id, to_warehouse_id, movement_type,
            movement_number, quantity, unit_cost, total_cost, reference_type, reference_id,
            reference_number, movement_date, created_by, notes)
        VALUES (
            v_tenant_id, v_company_id, v_mat, v_mat, v_warehouse_id, v_move_type,
            'MV-GRN-'||v_num_core||'-'||v_idx, v_qty, v_ucost, v_qty * v_ucost,
            'goods_receipt', v_receipt_id, v_move_ref, CURRENT_DATE, v_created_by,
            v_rolls||' roll(s) - '||COALESCE(v_move_ref,''));
        v_moves := v_moves + 1;
    END LOOP;

    -- ═══ 3) القيد المحاسبي — نقل حرفي من handleAccountingEntry ═══
    SELECT default_inventory_account_id, default_payable_account_id,
           COALESCE(default_purchase_account_id, default_cogs_account_id),
           default_transit_purchase_account_id
      INTO v_inv_acc, v_pay_acc, v_purch_acc, v_transit_acc
    FROM company_accounting_settings WHERE company_id = v_company_id LIMIT 1;

    v_debit_acc := COALESCE(v_inv_acc, v_purch_acc);

    IF v_is_container THEN
        -- ═══ استلام كونتينر: Dr المخزون / Cr حساب الكونتينر ═══
        SELECT container_account_id, container_number INTO v_cont_acc, v_cont_num
        FROM containers WHERE id = v_src_id;

        -- رصيد حساب الكونتينر (مدين-دائن على السطور المُرحّلة) = المبلغ الأدقّ للإقفال
        IF v_cont_acc IS NOT NULL THEN
            SELECT COALESCE(SUM(jel.debit),0) - COALESCE(SUM(jel.credit),0) INTO v_cont_bal
            FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
            WHERE jel.account_id = v_cont_acc AND je.status = 'posted';
            IF v_cont_bal IS NOT NULL AND v_cont_bal > 0 THEN
                v_actual_total := v_cont_bal;
            END IF;
        END IF;

        IF v_cont_acc IS NOT NULL AND v_debit_acc IS NOT NULL AND v_actual_total > 0 THEN
            v_credit_acc := v_cont_acc;
            v_desc := 'استلام كونتينر ' || COALESCE(v_cont_num, v_src_num);
        END IF;

    ELSIF v_is_order THEN
        -- ═══ استلام أمر شراء: Dr المخزون / Cr الذمم الدائنة ═══
        IF v_debit_acc IS NOT NULL AND v_pay_acc IS NOT NULL AND v_actual_total > 0 THEN
            v_credit_acc := v_pay_acc;
            v_desc := 'استلام بضائع - أمر شراء ' || v_src_num;
        END IF;

    ELSE
        -- ═══ استلام فاتورة: يقرأ receipt_mode + container_id من purchase_transactions ═══
        SELECT receipt_mode, container_id INTO v_receipt_mode, v_inv_container
        FROM purchase_transactions WHERE id = v_src_id;

        IF v_receipt_mode = 'international' THEN
            -- 🔧 R9: الدولي المرتبط بحاوية → Cr حساب الحاوية (رصيد 1145 نُقل إليه عند الترحيل)؛
            --         الدولي غير المرتبط → Cr المشتريات بالطريق (1145) الذي لا يزال يحمل الرصيد.
            --         بهذا لا يتكرّر الطرف الدائن في أي سيناريو (لا 1145 سالب ولا حاوية غير مُقفَلة).
            IF v_inv_container IS NOT NULL THEN
                SELECT container_account_id INTO v_credit_acc FROM containers WHERE id = v_inv_container;
            END IF;
            IF v_credit_acc IS NULL THEN
                v_credit_acc := v_transit_acc;
            END IF;

            IF v_debit_acc IS NOT NULL AND v_credit_acc IS NOT NULL AND v_actual_total > 0 THEN
                v_desc := 'استلام مخزني - فاتورة دولية ' || v_src_num ||
                          CASE WHEN v_inv_container IS NOT NULL THEN ' (إقفال حساب الحاوية)' ELSE ' (نقل من بالطريق للمخزون)' END;
            ELSE
                v_credit_acc := NULL;  -- الحسابات ناقصة → لا قيد (نقل حرفي: التخطي بدل قيد ناقص)
            END IF;
        ELSE
            -- محلي: لا قيد استلام (رُحّل عند الفاتورة على 1141) — نقل حرفي.
            v_credit_acc := NULL;
        END IF;
    END IF;

    -- إنشاء القيد فقط إن اكتمل الطرفان (كما strict-check في TS: كل السطور بحساب صحيح)
    IF v_debit_acc IS NOT NULL AND v_credit_acc IS NOT NULL AND v_actual_total > 0 THEN
        INSERT INTO journal_entries (
            tenant_id, company_id, branch_id, entry_number, entry_date, entry_type, description,
            reference_type, reference_id, reference_number, status, is_posted, posted_at, posted_by,
            total_debit, total_credit, created_by)
        VALUES (
            v_tenant_id, v_company_id, v_branch_id, 'JE-GRN-'||v_num_core, CURRENT_DATE, 'auto',
            'قيد ' || v_desc, 'goods_receipt', v_receipt_id, v_receipt_num,
            'posted', true, NOW(), v_created_by, v_actual_total, v_actual_total, v_created_by)
        RETURNING id INTO v_je_id;

        -- السطران في عبارة واحدة: تريغر تجميع الإجماليات يرى الطرفين فوراً فيبقى
        -- القيد متوازناً ولا يخالف chk_balanced_entry (نفس نمط الإدراج الدفعي في TS).
        -- مدين المخزون / دائن الحاوية-الذمم-الطريق (مع ربط المورد كطرف على الدائن).
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, party_type, party_id)
        VALUES
            (v_tenant_id, v_je_id, 1, v_debit_acc,  v_desc, v_actual_total, 0, NULL, NULL),
            (v_tenant_id, v_je_id, 2, v_credit_acc, v_desc, 0, v_actual_total, 'supplier', v_supplier_id);

        UPDATE purchase_receipts SET journal_entry_id = v_je_id WHERE id = v_receipt_id;
    END IF;

    -- ═══ 4) received_qty + stage (تراكمي، سماحية 0.01) — لحالة الفاتورة فقط ═══
    --     (الحاوية/الأمر يحدّثهما مسار TS في updateSourceDocument؛ لا ازدواج)
    IF v_is_invoice THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
        LOOP
            v_mat := NULLIF(v_item->>'material_id','')::uuid;
            v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
            IF v_mat IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
            UPDATE purchase_transaction_items
               SET received_qty = COALESCE(received_qty,0) + v_qty, updated_at = NOW()
             WHERE transaction_id = v_src_id
               AND (material_id = v_mat OR product_id = v_mat);
        END LOOP;

        SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(received_qty),0)
          INTO v_ord, v_rcv
        FROM purchase_transaction_items WHERE transaction_id = v_src_id;

        v_fully := (v_ord > 0 AND v_rcv >= v_ord - 0.01);
        UPDATE purchase_transactions
           SET stage = CASE WHEN v_fully THEN 'received' ELSE 'partially_received' END,
               received_at = NOW(), received_by = v_created_by, updated_at = NOW()
         WHERE id = v_src_id AND stage NOT IN ('cancelled','posted');
    END IF;

    RETURN jsonb_build_object(
        'success', true, 'already_processed', false,
        'receipt_id', v_receipt_id, 'receipt_number', v_receipt_num,
        'journal_entry_id', v_je_id, 'movements_created', v_moves,
        'is_fully_received', v_fully, 'actual_total', v_actual_total);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.complete_goods_receipt(jsonb) TO authenticated, service_role;
