-- ═══════════════════════════════════════════════════════════════════════════
-- P1 — توحيد فلسفة الجرد على «الجرد المستمر» (1141) + إصلاح عكس المخزون
-- ═══════════════════════════════════════════════════════════════════════════
-- القرار المعتمد: الجرد المستمر. عند ترحيل فاتورة الشراء يُدين حسابُ المخزون
-- (1141 بضاعة جاهزة) لا حساب «مشتريات/مصروف 521» — كي يتطابق محرّك SQL مع
-- محرّك TS (purchaseAccountingService) الذي يقيّد المخزون محلياً و1145 دولياً.
--
-- يشمل هذا الملف:
--   (أ) resolve_posting_account: إضافة دورَي 'purchase_inventory' و'purchase_transit'
--   (ب) post_purchase_invoice: مدين المخزون/الطريق + بلا ضريبة للدولي
--   (ج) direct_post_purchase: تحويل تكلفة الحركة للعملة الأساس + حارس ازدواج GRN (R4)
--   (د) reverse_direct_stock_movements: عكس ذرّي بحركات عكسية (بنمط doc_reverse)
--
-- idempotent: CREATE OR REPLACE فقط. بلا DDL هدّام، بلا لمس بيانات.
-- (النسخة المطبّقة فعلياً طُبّقت دالةً-دالةً عبر psql/execute_sql؛ هذا الملف مصدر الحقيقة.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- (أ) resolve_posting_account — دورا مخزون المشتريات والمشتريات بالطريق
--     purchase_inventory → default_inventory_account_id (1141/1140/114)
--     purchase_transit   → default_transit_purchase_account_id (1145/1146/114)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_posting_account(p_company_id uuid, p_role text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_tenant_id       uuid;
    v_settings_col    text;
    v_codes           text[];
    v_require_postable boolean := false;
    v_account_id      uuid;
    v_settings_id     uuid;
BEGIN
    IF p_company_id IS NULL OR p_role IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;

    CASE p_role
        WHEN 'receipt_inventory' THEN
            v_settings_col := 'default_inventory_account_id';
            v_codes := ARRAY['1400'];                          v_require_postable := false;
        WHEN 'receipt_payable' THEN
            v_settings_col := 'default_payable_account_id';
            v_codes := ARRAY['2100','2108'];                   v_require_postable := false;
        WHEN 'purchase_expense' THEN
            v_settings_col := 'default_purchase_account_id';
            v_codes := ARRAY['521','5100','5000','52','1400']; v_require_postable := true;
        -- ✨ الجرد المستمر: مدين المخزون المحلي عند ترحيل فاتورة الشراء
        WHEN 'purchase_inventory' THEN
            v_settings_col := 'default_inventory_account_id';
            v_codes := ARRAY['1141','1140','114','1400'];      v_require_postable := true;
        -- ✨ الدولي: مدين المشتريات بالطريق (1145) قبل نقلها لحساب الكونتينر
        WHEN 'purchase_transit' THEN
            v_settings_col := 'default_transit_purchase_account_id';
            v_codes := ARRAY['1145','1146','114'];             v_require_postable := true;
        WHEN 'purchase_payable' THEN
            v_settings_col := 'default_payable_account_id';
            v_codes := ARRAY['2112','2111','211','2100','2000']; v_require_postable := true;
        WHEN 'purchase_tax_input' THEN
            v_settings_col := 'default_tax_input_account_id';
            v_codes := ARRAY['1190','1180','1510','1500','119']; v_require_postable := true;
        WHEN 'preturn_inventory' THEN
            v_settings_col := 'default_inventory_account_id';
            v_codes := ARRAY['1400'];                          v_require_postable := false;
        WHEN 'preturn_payable' THEN
            v_settings_col := 'default_payable_account_id';
            v_codes := ARRAY['2112','2111','211','2100','2000']; v_require_postable := true;
        WHEN 'sales_receivable' THEN
            v_settings_col := 'default_receivable_account_id';
            v_codes := ARRAY['1131','1130','113'];             v_require_postable := false;
        WHEN 'sales_revenue' THEN
            v_settings_col := 'default_revenue_account_id';
            v_codes := ARRAY['4110','4100','411','41'];        v_require_postable := false;
        WHEN 'sales_tax_output' THEN
            v_settings_col := 'default_tax_output_account_id';
            v_codes := ARRAY['2130','2141','2150'];            v_require_postable := false;
        WHEN 'sales_cogs' THEN
            v_settings_col := 'default_cogs_account_id';
            v_codes := ARRAY['5100','5110','511','51'];        v_require_postable := false;
        WHEN 'sales_inventory' THEN
            v_settings_col := 'default_inventory_account_id';
            v_codes := ARRAY['1140','1141','114'];             v_require_postable := false;
        WHEN 'sales_shipping' THEN
            v_settings_col := 'default_revenue_account_id';
            v_codes := ARRAY['412','4120','421','411'];        v_require_postable := true;
        ELSE
            RETURN NULL;
    END CASE;

    SELECT id INTO v_settings_id
    FROM company_accounting_settings
    WHERE company_id = p_company_id
    LIMIT 1;

    IF v_settings_id IS NOT NULL THEN
        EXECUTE format(
            'SELECT s.%I FROM company_accounting_settings s WHERE s.id = $1',
            v_settings_col
        ) INTO v_account_id USING v_settings_id;

        IF v_account_id IS NOT NULL THEN
            PERFORM 1 FROM chart_of_accounts a
            WHERE a.id = v_account_id
              AND a.company_id = p_company_id
              AND COALESCE(a.is_active, true) = true
              AND COALESCE(a.is_group, false) = false;
            IF FOUND THEN
                RETURN v_account_id;
            END IF;
            v_account_id := NULL;
        END IF;
    END IF;

    SELECT a.id INTO v_account_id
    FROM chart_of_accounts a
    WHERE a.tenant_id = v_tenant_id
      AND (a.company_id = p_company_id OR a.company_id IS NULL)
      AND a.account_code = ANY(v_codes)
      AND (NOT v_require_postable OR COALESCE(a.is_group, false) = false)
    ORDER BY array_position(v_codes, a.account_code),
             CASE WHEN a.company_id = p_company_id THEN 0 ELSE 1 END
    LIMIT 1;

    RETURN v_account_id;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- (ب) post_purchase_invoice — الجرد المستمر
--     المحلي:  مدين المخزون (1141) + مدين ضريبة المدخلات + دائن المورد
--     الدولي:  مدين المشتريات بالطريق (1145) + دائن المورد — بلا سطر ضريبة
--     كل السطور بالعملة الأساس = face × exchange_rate (BASE-per-FOREIGN)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_source     TEXT;
    v_tenant_id  UUID;
    v_company_id UUID;
    v_branch_id  UUID;
    v_supplier_id UUID;
    v_supplier_name TEXT;
    v_invoice_number TEXT;
    v_invoice_date DATE;
    v_currency   TEXT;
    v_exchange_rate NUMERIC;
    v_is_posted  BOOLEAN;
    v_receipt_mode TEXT;
    v_is_international BOOLEAN := false;
    v_je_id      UUID;
    v_user_id    UUID;
    v_account_inventory UUID;   -- مدين: المخزون (محلي) أو الطريق (دولي)
    v_account_ap        UUID;
    v_account_tax       UUID;
    v_net_amount NUMERIC(15,4);
    v_tax_amount NUMERIC(15,4);
    v_total      NUMERIC(15,4);
    v_inv_debit  NUMERIC(15,4);
    v_credit_total NUMERIC(15,4);
    v_line_num   INT := 0;
    v_rate       NUMERIC := 1;   -- FX: base = face x v_rate (BASE-per-FOREIGN)
BEGIN
    v_user_id := auth.uid();

    SELECT 'invoices', pi.tenant_id, pi.company_id, pi.branch_id, pi.supplier_id, pi.supplier_name,
           pi.invoice_number, COALESCE(pi.invoice_date, CURRENT_DATE),
           COALESCE(pi.currency, 'SAR'), COALESCE(pi.exchange_rate, 1),
           COALESCE(pi.is_posted, false), COALESCE(pi.total_amount, 0), COALESCE(pi.tax_amount, 0),
           pi.receipt_mode
      INTO v_source, v_tenant_id, v_company_id, v_branch_id, v_supplier_id, v_supplier_name,
           v_invoice_number, v_invoice_date, v_currency, v_exchange_rate, v_is_posted, v_total, v_tax_amount,
           v_receipt_mode
    FROM purchase_invoices pi WHERE pi.id = p_invoice_id FOR UPDATE;

    IF v_source IS NULL THEN
        SELECT 'transactions', pt.tenant_id, pt.company_id, pt.branch_id, pt.supplier_id, pt.supplier_name,
               COALESCE(pt.invoice_no, pt.draft_no, LEFT(pt.id::text, 8)), COALESCE(pt.invoice_date, pt.doc_date, CURRENT_DATE),
               COALESCE(pt.currency, 'SAR'), COALESCE(pt.exchange_rate, 1),
               COALESCE(pt.is_posted, false), COALESCE(pt.total_amount, 0), COALESCE(pt.tax_amount, 0),
               pt.receipt_mode
          INTO v_source, v_tenant_id, v_company_id, v_branch_id, v_supplier_id, v_supplier_name,
               v_invoice_number, v_invoice_date, v_currency, v_exchange_rate, v_is_posted, v_total, v_tax_amount,
               v_receipt_mode
        FROM purchase_transactions pt WHERE pt.id = p_invoice_id FOR UPDATE;
    END IF;

    IF v_source IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
    END IF;

    PERFORM assert_can_access_company(v_company_id);

    IF v_is_posted = true THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة مُرحَّلة مسبقاً');
    END IF;

    v_rate := COALESCE(v_exchange_rate, 1);
    v_is_international := (v_receipt_mode = 'international');

    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'مبلغ الفاتورة صفر');
    END IF;

    -- ── حساب المدين (الجرد المستمر) ──
    IF v_is_international THEN
        v_account_inventory := resolve_posting_account(v_company_id, 'purchase_transit');
        IF v_account_inventory IS NULL THEN
            v_account_inventory := resolve_posting_account(v_company_id, 'purchase_inventory');
        END IF;
    ELSE
        v_account_inventory := resolve_posting_account(v_company_id, 'purchase_inventory');
        IF v_account_inventory IS NULL THEN
            -- فولباك احترازي: حساب المشتريات القديم (521) كي لا يفشل الترحيل مطلقاً
            v_account_inventory := resolve_posting_account(v_company_id, 'purchase_expense');
        END IF;
    END IF;

    -- ── الذمم الدائنة: أولوية حساب المورد الطرفي، ثم is_payable، ثم المحلّل ──
    IF v_supplier_id IS NOT NULL THEN
        SELECT id INTO v_account_ap FROM chart_of_accounts
        WHERE company_id = v_company_id AND is_party_account = true
          AND party_type = 'supplier' AND party_id = v_supplier_id LIMIT 1;
    END IF;
    IF v_account_ap IS NULL THEN
        SELECT id INTO v_account_ap FROM chart_of_accounts
        WHERE company_id = v_company_id
          AND COALESCE(is_payable, false) = true
          AND COALESCE(is_group, false) = false
        ORDER BY account_code LIMIT 1;
    END IF;
    IF v_account_ap IS NULL THEN
        v_account_ap := resolve_posting_account(v_company_id, 'purchase_payable');
    END IF;

    -- ── الضريبة: تُتجاهَل كلياً للفاتورة الدولية (تُدفع بالجمارك) ──
    IF v_is_international THEN
        v_tax_amount := 0;
        v_account_tax := NULL;
    ELSIF v_tax_amount > 0 THEN
        v_account_tax := resolve_posting_account(v_company_id, 'purchase_tax_input');
    END IF;

    IF v_account_inventory IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            CASE WHEN v_is_international
                 THEN 'لم يُعثر على حساب المشتريات بالطريق (1145)'
                 ELSE 'لم يُعثر على حساب المخزون (1141/1140/114)' END,
            'invoice_id', p_invoice_id);
    END IF;
    IF v_account_ap IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'لم يُعثر على حساب الذمم الدائنة (2111/2100)', 'invoice_id', p_invoice_id);
    END IF;

    v_net_amount := v_total - v_tax_amount;

    IF v_is_international THEN
        -- استيراد: مدين الطريق = الصافي (بلا ضريبة)، دائن المورد = الصافي
        v_inv_debit    := v_net_amount;
        v_credit_total := v_net_amount;
    ELSE
        v_inv_debit    := CASE WHEN v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN v_net_amount ELSE v_total END;
        v_credit_total := v_total;
    END IF;

    -- وسم الفاتورة مُرحَّلة (المسار SQL ذرّي ضمن معاملة الدالة)
    IF v_source = 'invoices' THEN
        UPDATE purchase_invoices
        SET status = 'posted', is_posted = true, posted_at = NOW(), updated_at = NOW()
        WHERE id = p_invoice_id;
    ELSE
        UPDATE purchase_transactions
        SET stage = 'posted', is_posted = true, posted_at = NOW(), posted_by = v_user_id, updated_at = NOW()
        WHERE id = p_invoice_id;
    END IF;

    -- ترويسة القيد بالعملة الأساس = credit_total × rate
    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_date, entry_type, description,
        reference_type, reference_id, reference_number, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by
    ) VALUES (
        v_tenant_id, v_company_id, v_branch_id,
        v_invoice_date, 'auto',
        'فاتورة مشتريات — ' || COALESCE(v_invoice_number, ''),
        'purchase_invoice', p_invoice_id, v_invoice_number,
        v_currency, v_rate,
        round(v_credit_total * v_rate, 2), round(v_credit_total * v_rate, 2), 'draft', false, v_user_id
    ) RETURNING id INTO v_je_id;

    -- مدين المخزون/الطريق: base = face × rate، fc = face
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
    VALUES (v_tenant_id, v_je_id, v_line_num, v_account_inventory,
            CASE WHEN v_is_international THEN 'بضاعة بالطريق — ' ELSE 'بضاعة/مخزون — ' END || COALESCE(v_invoice_number, ''),
            round(v_inv_debit * v_rate, 2), 0, v_inv_debit, 0);

    -- ضريبة المدخلات (محلي فقط)
    IF v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_tenant_id, v_je_id, v_line_num, v_account_tax,
                'ضريبة مدخلات — ' || COALESCE(v_invoice_number, ''), round(v_tax_amount * v_rate, 2), 0, v_tax_amount, 0);
    END IF;

    -- دائن المورد
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc, party_type, party_id)
    VALUES (v_tenant_id, v_je_id, v_line_num, v_account_ap,
            'ذمم دائنة — ' || COALESCE(v_supplier_name, '') || ' — ' || COALESCE(v_invoice_number, ''),
            0, round(v_credit_total * v_rate, 2), 0, v_credit_total, 'supplier', v_supplier_id);

    PERFORM post_journal_entry(v_je_id, v_user_id);

    IF v_source = 'invoices' THEN
        UPDATE purchase_invoices SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    ELSE
        UPDATE purchase_transactions SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true, 'invoice_id', p_invoice_id, 'invoice_number', v_invoice_number,
        'journal_entry_id', v_je_id, 'total_amount', v_total, 'tax_amount', v_tax_amount,
        'inventory_debit', v_inv_debit, 'is_international', v_is_international,
        'source', v_source,
        'message', 'تم ترحيل فاتورة المشتريات بنجاح (جرد مستمر)'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE, 'invoice_id', p_invoice_id);
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- (ج) direct_post_purchase — تكلفة الحركة بالعملة الأساس + حارس ازدواج GRN (R4)
--     • تكلفة الحركة = cost × exchange_rate (اتساق تقييم المخزون مع الأستاذ)
--     • حارس R4: إن استُلمت البضاعة عبر GRN مرتبط بالفاتورة → رفض صريح (الأسلم
--       محاسبياً: يمنع ازدواج المخزون ولا يفترض أثر GRN على الأستاذ)
-- ───────────────────────────────────────────────────────────────────────────
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
    v_cost         numeric;    -- بالعملة الأساس (face × rate)
    v_rate         numeric := 1;
    v_post         jsonb;
    v_idx          int := 0;
    v_movement_ids uuid[] := '{}';
    v_mv_id        uuid;
    v_ref_no       text;
BEGIN
    -- ═══ 0) الصلاحية أولاً ═══
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

    v_rate := COALESCE(v_trx.exchange_rate, 1);

    -- ═══ 2) حارس الاستلام المزدوج (المسار المباشر نفسه) ═══
    IF EXISTS (
        SELECT 1 FROM inventory_movements
        WHERE reference_id = p_invoice_id
          AND reference_type = 'purchase_invoice'
          AND movement_type = 'purchase_receipt'
    ) THEN
        RAISE EXCEPTION 'تم استلام هذه الفاتورة مسبقاً';
    END IF;

    -- ═══ 2ب) حارس الازدواج عبر المسارات (R4): استلام عبر GRN مرتبط بالفاتورة ═══
    -- إن دخلت البضاعة للمخزون عبر سند استلام (GRN) خاص بهذه الفاتورة، فإنشاء حركة
    -- شراء مباشر ثانية يضاعف المخزون. الأسلم محاسبياً: نرفض بوضوح ونوجّه للمسار العادي.
    IF EXISTS (
        SELECT 1 FROM inventory_movements m
        WHERE m.movement_type IN ('receipt','purchase_receipt','container_receipt','goods_receipt')
          AND (
                (m.reference_type = 'goods_receipt' AND m.reference_id = p_invoice_id)
             OR (m.reference_type IN ('purchase_receipt','goods_receipt','receipt')
                 AND m.reference_id IN (SELECT id FROM purchase_receipts WHERE invoice_id = p_invoice_id))
          )
    ) THEN
        RAISE EXCEPTION 'تعذّر الشراء المباشر: تم استلام بضاعة هذه الفاتورة عبر سند استلام (GRN) — رحّل الفاتورة عبر مسار الاستلام العادي بدل الشراء المباشر';
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

        -- تكلفة الوحدة بالعملة الأساس: face × exchange_rate (اتساق مع قيد الأستاذ)
        v_cost := v_item.cost * v_rate;
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

    -- ═══ 4) الترحيل المحاسبي — ذرّي ═══
    v_post := post_purchase_invoice(p_invoice_id);
    IF NOT COALESCE((v_post->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'فشل الترحيل المحاسبي: %', COALESCE(v_post->>'error', 'غير معروف');
    END IF;

    -- ═══ 5) وسم الاستلام + ربط الحركة ═══
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

-- ───────────────────────────────────────────────────────────────────────────
-- (د) reverse_direct_stock_movements — عكس ذرّي للمخزون بحركات عاكسة
--     يستبدل reverseDirectStockUpdate المكسور (كان يكتب عموداً مُولَّداً ثم يحذف
--     الحركات بلا تريغر DELETE). يستدعي doc_reverse_stock_movements (يعمل عبر
--     التريغر update_inventory_stock ويحمل idempotency guard) — نفس نمط الحذف
--     الناعم المُعتمَد إنتاجياً (يعالج الرولونات/الألوان بنفس أسلوب النظام القائم).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_direct_stock_movements(
    p_doc_id uuid, p_type text, p_reason text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_company  uuid;
    v_src      text[];
    v_rev_ref  text;
    v_count    int;
    v_user     uuid;
BEGIN
    v_user := COALESCE(p_user_id, auth.uid());

    IF p_type = 'purchase' THEN
        SELECT company_id INTO v_company FROM purchase_transactions WHERE id = p_doc_id;
        v_src := ARRAY['purchase_invoice','purchase_receipt','goods_receipt'];
        v_rev_ref := 'purchase_reversal';
    ELSE
        SELECT company_id INTO v_company FROM sales_transactions WHERE id = p_doc_id;
        v_src := ARRAY['sales_invoice','sales_delivery'];
        v_rev_ref := 'sales_reversal';
    END IF;

    IF v_company IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'المستند غير موجود');
    END IF;

    -- عزل المستأجر
    PERFORM assert_can_access_company(v_company);

    -- عكس ذرّي: حركات عاكسة (adjustment_out/in) عبر التريغر + idempotency داخلي
    v_count := doc_reverse_stock_movements(
        p_doc_id, v_src, v_rev_ref, COALESCE(p_reason, 'عكس ترحيل مباشر'), v_user);

    RETURN jsonb_build_object(
        'success', true,
        'doc_id', p_doc_id,
        'reversed', v_count,
        'reversal_reference_type', v_rev_ref
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;
