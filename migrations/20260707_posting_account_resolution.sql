-- ════════════════════════════════════════════════════════════════════════════
-- 20260707_posting_account_resolution.sql
-- إصلاح قاطع تصدير: دوال الترحيل تبحث عن الحسابات بأكواد صلبة، فيفشل ترحيل أي
-- عميل/مستأجر جديد بترقيم حسابات مختلف. الحل: دالة مساعدة موحّدة
-- resolve_posting_account تقرأ من company_accounting_settings أولاً (المصدر الصحيح
-- للحقيقة الذي تملؤه auto_set_default_accounts) ثم تسقط للبحث بالأكواد القياسية
-- كاحتياط، مع الحفاظ التام على منطق كل دالة ترحيل (التوازن/COGS/الضريبة/القفل/العزل).
--
-- ضمان عدم الانحدار: قيمة الإعدادات تُقبل فقط إن كانت حساباً قابلاً للترحيل
-- (is_group=false, is_active) — فحسابات المجموعة الملبّسة (مثل 2111 دين الموردين-رئيسي
-- أو 1131 ذمم-رئيسي) تُرفَض ويعود المنطق للبحث بالأكواد ⇒ نفس النتيجة السابقة بالضبط.
-- حيث كان البحث بالأكواد يفشل أصلاً (ض.مخرجات 214 / ض.مدخلات 117 غير مطابقة لقوائم
-- الأكواد القديمة) تُغطّيه الإعدادات الآن ⇒ إصلاح لا انحدار.
--
-- معاملة واحدة idempotent (CREATE OR REPLACE).
-- ملاحظة: لا نلمس جداول/تريغرات inventory_stock وMulti-UOM إطلاقاً.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- الدالة المساعدة الموحّدة
-- ────────────────────────────────────────────────────────────────────────────
-- p_role يحدّد: عمود الإعدادات المقابل + قائمة الأكواد القياسية (مرتّبة أولوية) +
-- هل يشترط الاحتياط حساباً قابلاً للترحيل (مطابقة لسلوك الدالة الأصلية لكل دور).
--
-- الأدوار المدعومة (سياق × دور):
--   receipt_inventory   استلام مشتريات: المخزون        1400              (بلا فلتر group)
--   receipt_payable     استلام مشتريات: الذمم الدائنة   2100,2108         (بلا فلتر group)
--   purchase_expense    فاتورة مشتريات: المشتريات       521,5100,5000,52,1400   (group=false)
--   purchase_payable    فاتورة مشتريات: الذمم الدائنة   2112,2111,211,2100,2000 (group=false)
--   purchase_tax_input  فاتورة مشتريات: ض.مدخلات        1190,1180,1510,1500,119 (group=false)
--   preturn_inventory   مرتجع مشتريات: المخزون          1400              (بلا فلتر group)
--   preturn_payable     مرتجع مشتريات: الذمم الدائنة     2100              (بلا فلتر group)
--   sales_receivable    فاتورة/مرتجع مبيعات: الذمم المدينة 1131,1130,113   (بلا فلتر group)
--   sales_revenue       فاتورة/مرتجع مبيعات: الإيرادات    4110,4100,411,41  (بلا فلتر group)
--   sales_tax_output    فاتورة/مرتجع مبيعات: ض.مخرجات     2130,2141,2150    (بلا فلتر group)
--   sales_cogs          فاتورة/مرتجع مبيعات: تكلفة المبيعات 5100,5110,511,51 (بلا فلتر group)
--   sales_inventory     فاتورة/مرتجع مبيعات: المخزون       1140,1141,114    (بلا فلتر group)
--   sales_shipping      فاتورة مبيعات: إيراد الشحن         412,4120,421,411 (group=false)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_posting_account(
    p_company_id uuid,
    p_role       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_tenant_id       uuid;
    v_settings_col    text;
    v_codes           text[];
    v_require_postable boolean := false;   -- فلتر group في الاحتياط (مطابق للأصل لكل دور)
    v_account_id      uuid;
    v_settings_id     uuid;
BEGIN
    IF p_company_id IS NULL OR p_role IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;

    -- خريطة الدور → (عمود الإعدادات، قائمة الأكواد، اشتراط القابلية للترحيل في الاحتياط)
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
            v_codes := ARRAY['2100'];                          v_require_postable := false;
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
            v_settings_col := 'default_revenue_account_id';    -- إيراد الشحن ← إيراد افتراضي إن وُجد
            v_codes := ARRAY['412','4120','421','411'];        v_require_postable := true;
        ELSE
            RETURN NULL;   -- دور غير معروف
    END CASE;

    -- (أ) القراءة من company_accounting_settings — تُقبل فقط إن كان الحساب قابلاً
    --     للترحيل (is_group=false) ونشطاً، ويخصّ نفس الشركة (عزل).
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
            -- تحقّق أن الحساب المرجعي صالح للترحيل ويخصّ الشركة
            PERFORM 1 FROM chart_of_accounts a
            WHERE a.id = v_account_id
              AND a.company_id = p_company_id
              AND COALESCE(a.is_active, true) = true
              AND COALESCE(a.is_group, false) = false;
            IF FOUND THEN
                RETURN v_account_id;
            END IF;
            v_account_id := NULL;   -- حساب إعدادات غير صالح (مجموعة/معطّل) ⇒ إلى الاحتياط
        END IF;
    END IF;

    -- (ب) الاحتياط: البحث بقائمة الأكواد القياسية — شركة أولاً ثم عام (company_id IS NULL)،
    --     مع الحفاظ على ترتيب الأولوية بالأكواد، وفلتر group مطابق للدالة الأصلية.
    SELECT a.id INTO v_account_id
    FROM chart_of_accounts a
    WHERE a.tenant_id = v_tenant_id
      AND (a.company_id = p_company_id OR a.company_id IS NULL)
      AND a.account_code = ANY(v_codes)
      AND (NOT v_require_postable OR COALESCE(a.is_group, false) = false)
    ORDER BY array_position(v_codes, a.account_code),
             CASE WHEN a.company_id = p_company_id THEN 0 ELSE 1 END
    LIMIT 1;

    -- (ج) لا شيء ⇒ NULL (تُبقي الدالة المستدعية تُطلق خطأها الواضح)
    RETURN v_account_id;
END;
$function$;

COMMENT ON FUNCTION public.resolve_posting_account(uuid, text) IS
'يحلّ حساب الترحيل لدور محدّد: (أ) company_accounting_settings إن أشار لحساب قابل للترحيل، (ب) البحث بالأكواد القياسية احتياطاً، (ج) NULL. يعالج قاطع تصدير ترقيم الحسابات المختلف للعملاء الجدد.';


-- ════════════════════════════════════════════════════════════════════════════
-- (1) post_purchase_receipt — تغيير سطري تحديد المخزون/الذمم الدائنة فقط
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_purchase_receipt(p_receipt_id uuid, p_warehouse_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_receipt      RECORD;
    v_item         JSONB;
    v_movement_count INT := 0;
    v_total_amount NUMERIC(15,4) := 0;
    v_je_id        UUID;
    v_movement_number VARCHAR(50);
    v_user_id      UUID;
    v_account_inventory UUID;
    v_account_ap   UUID;
    v_item_qty     NUMERIC(15,3);
    v_item_price   NUMERIC(15,4);
    v_item_total   NUMERIC(15,4);
BEGIN
    v_user_id := auth.uid();

    SELECT * INTO v_receipt
    FROM purchase_receipts
    WHERE id = p_receipt_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'سند الاستلام غير موجود');
    END IF;

    IF v_receipt.status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'سند الاستلام مُرحَّل مسبقاً');
    END IF;

    UPDATE purchase_receipts
    SET status = 'completed',
        warehouse_id = COALESCE(p_warehouse_id, warehouse_id),
        updated_at = NOW()
    WHERE id = p_receipt_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty   := COALESCE((v_item->>'quantity')::NUMERIC, 0);
        v_item_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
        v_item_total := v_item_qty * v_item_price;
        v_total_amount := v_total_amount + v_item_total;
        v_movement_count := v_movement_count + 1;

        v_movement_number := 'GRN-' || COALESCE(v_receipt.receipt_number, '') || '-' || v_movement_count;

        INSERT INTO inventory_movements (
            tenant_id, company_id,
            movement_number, movement_date,
            movement_type,
            product_id, material_id, variant_id,
            to_warehouse_id,
            quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number,
            notes, created_by
        ) VALUES (
            v_receipt.tenant_id, v_receipt.company_id,
            v_movement_number, CURRENT_DATE,
            'receipt',
            (v_item->>'product_id')::UUID,
            (v_item->>'material_id')::UUID,
            (v_item->>'variant_id')::UUID,
            COALESCE(p_warehouse_id, v_receipt.warehouse_id),
            v_item_qty, v_item_price, v_item_total,
            'purchase_receipt', p_receipt_id, v_receipt.receipt_number,
            COALESCE(v_item->>'description', 'استلام مشتريات'),
            v_user_id
        );
    END LOOP;

    -- ── الحسابات (عبر المحلّل الموحّد: إعدادات أولاً ثم الأكواد) ──
    v_account_inventory := resolve_posting_account(v_receipt.company_id, 'receipt_inventory');
    v_account_ap        := resolve_posting_account(v_receipt.company_id, 'receipt_payable');

    IF v_account_inventory IS NOT NULL AND v_account_ap IS NOT NULL AND v_total_amount > 0 THEN
        INSERT INTO journal_entries (
            tenant_id, company_id, branch_id,
            entry_date, entry_type,
            description,
            reference_type, reference_id, reference_number,
            status, is_posted, posted_at, posted_by,
            created_by
        ) VALUES (
            v_receipt.tenant_id, v_receipt.company_id, v_receipt.branch_id,
            CURRENT_DATE, 'auto',
            'قيد استلام مشتريات — ' || COALESCE(v_receipt.receipt_number, ''),
            'purchase_receipt', p_receipt_id, v_receipt.receipt_number,
            'posted', true, NOW(), v_user_id,
            v_user_id
        ) RETURNING id INTO v_je_id;

        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number,
            account_id, description,
            debit, credit,
            party_type, party_id
        ) VALUES (
            v_receipt.tenant_id, v_je_id, 1,
            v_account_inventory,
            'استلام مخزني — ' || COALESCE(v_receipt.receipt_number, ''),
            v_total_amount, 0,
            NULL, NULL
        );

        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number,
            account_id, description,
            debit, credit,
            party_type, party_id
        ) VALUES (
            v_receipt.tenant_id, v_je_id, 2,
            v_account_ap,
            'تسوية استلام — ' || COALESCE(v_receipt.receipt_number, ''),
            0, v_total_amount,
            'supplier', v_receipt.supplier_id
        );

        UPDATE purchase_receipts
        SET journal_entry_id = v_je_id
        WHERE id = p_receipt_id;
    END IF;

    IF v_receipt.invoice_id IS NOT NULL THEN
        UPDATE purchase_invoices
        SET receiving_status = 'received', updated_at = NOW()
        WHERE id = v_receipt.invoice_id;
    END IF;

    IF v_receipt.order_id IS NOT NULL THEN
        UPDATE purchase_orders
        SET updated_at = NOW()
        WHERE id = v_receipt.order_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'receipt_id', p_receipt_id,
        'receipt_number', v_receipt.receipt_number,
        'movements_created', v_movement_count,
        'total_amount', v_total_amount,
        'journal_entry_id', v_je_id,
        'message', 'تم ترحيل سند الاستلام بنجاح'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'detail', SQLSTATE,
        'receipt_id', p_receipt_id
    );
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- (2) post_purchase_invoice — تغيير سطري المشتريات/الذمم الدائنة/الضريبة فقط
-- ════════════════════════════════════════════════════════════════════════════
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
    v_je_id      UUID;
    v_user_id    UUID;
    v_account_purchases UUID;
    v_account_ap        UUID;
    v_account_tax       UUID;
    v_net_amount NUMERIC(15,4);
    v_tax_amount NUMERIC(15,4);
    v_total      NUMERIC(15,4);
    v_purch_debit NUMERIC(15,4);
    v_line_num   INT := 0;
BEGIN
    v_user_id := auth.uid();

    SELECT 'invoices', pi.tenant_id, pi.company_id, pi.branch_id, pi.supplier_id, pi.supplier_name,
           pi.invoice_number, COALESCE(pi.invoice_date, CURRENT_DATE),
           COALESCE(pi.currency, 'SAR'), COALESCE(pi.exchange_rate, 1),
           COALESCE(pi.is_posted, false), COALESCE(pi.total_amount, 0), COALESCE(pi.tax_amount, 0)
      INTO v_source, v_tenant_id, v_company_id, v_branch_id, v_supplier_id, v_supplier_name,
           v_invoice_number, v_invoice_date, v_currency, v_exchange_rate, v_is_posted, v_total, v_tax_amount
    FROM purchase_invoices pi WHERE pi.id = p_invoice_id FOR UPDATE;

    IF v_source IS NULL THEN
        SELECT 'transactions', pt.tenant_id, pt.company_id, pt.branch_id, pt.supplier_id, pt.supplier_name,
               COALESCE(pt.invoice_no, pt.draft_no, LEFT(pt.id::text, 8)), COALESCE(pt.invoice_date, pt.doc_date, CURRENT_DATE),
               COALESCE(pt.currency, 'SAR'), COALESCE(pt.exchange_rate, 1),
               COALESCE(pt.is_posted, false), COALESCE(pt.total_amount, 0), COALESCE(pt.tax_amount, 0)
          INTO v_source, v_tenant_id, v_company_id, v_branch_id, v_supplier_id, v_supplier_name,
               v_invoice_number, v_invoice_date, v_currency, v_exchange_rate, v_is_posted, v_total, v_tax_amount
        FROM purchase_transactions pt WHERE pt.id = p_invoice_id FOR UPDATE;
    END IF;

    IF v_source IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
    END IF;

    PERFORM assert_can_access_company(v_company_id);

    IF v_is_posted = true THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة مُرحَّلة مسبقاً');
    END IF;

    v_net_amount := v_total - v_tax_amount;

    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'مبلغ الفاتورة صفر');
    END IF;

    -- ── الحسابات (عبر المحلّل الموحّد) ──
    -- المشتريات: إعدادات default_purchase_account_id ثم الأكواد 521/5100/5000/52/1400
    v_account_purchases := resolve_posting_account(v_company_id, 'purchase_expense');

    -- الذمم الدائنة: أولوية حساب المورد الطرفي، ثم is_payable، ثم المحلّل الموحّد
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

    IF v_tax_amount > 0 THEN
        v_account_tax := resolve_posting_account(v_company_id, 'purchase_tax_input');
    END IF;

    IF v_account_purchases IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'لم يُعثر على حساب المشتريات (5100/5000/1400)', 'invoice_id', p_invoice_id);
    END IF;
    IF v_account_ap IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'لم يُعثر على حساب الذمم الدائنة (2100/2000)', 'invoice_id', p_invoice_id);
    END IF;

    v_purch_debit := CASE WHEN v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN v_net_amount ELSE v_total END;

    IF v_source = 'invoices' THEN
        UPDATE purchase_invoices
        SET status = 'posted', is_posted = true, posted_at = NOW(), updated_at = NOW()
        WHERE id = p_invoice_id;
    ELSE
        UPDATE purchase_transactions
        SET stage = 'posted', is_posted = true, posted_at = NOW(), posted_by = v_user_id, updated_at = NOW()
        WHERE id = p_invoice_id;
    END IF;

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_date, entry_type, description,
        reference_type, reference_id, reference_number, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by
    ) VALUES (
        v_tenant_id, v_company_id, v_branch_id,
        v_invoice_date, 'auto',
        'فاتورة مشتريات — ' || COALESCE(v_invoice_number, ''),
        'purchase_invoice', p_invoice_id, v_invoice_number,
        v_currency, v_exchange_rate,
        v_total, v_total, 'draft', false, v_user_id
    ) RETURNING id INTO v_je_id;

    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
    VALUES (v_tenant_id, v_je_id, v_line_num, v_account_purchases,
            'مشتريات — ' || COALESCE(v_invoice_number, ''), v_purch_debit, 0, v_purch_debit, 0);

    IF v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_tenant_id, v_je_id, v_line_num, v_account_tax,
                'ضريبة مدخلات — ' || COALESCE(v_invoice_number, ''), v_tax_amount, 0, v_tax_amount, 0);
    END IF;

    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc, party_type, party_id)
    VALUES (v_tenant_id, v_je_id, v_line_num, v_account_ap,
            'ذمم دائنة — ' || COALESCE(v_supplier_name, '') || ' — ' || COALESCE(v_invoice_number, ''),
            0, v_total, 0, v_total, 'supplier', v_supplier_id);

    PERFORM post_journal_entry(v_je_id, v_user_id);

    IF v_source = 'invoices' THEN
        UPDATE purchase_invoices SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    ELSE
        UPDATE purchase_transactions SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true, 'invoice_id', p_invoice_id, 'invoice_number', v_invoice_number,
        'journal_entry_id', v_je_id, 'total_amount', v_total, 'tax_amount', v_tax_amount,
        'source', v_source,
        'message', 'تم ترحيل فاتورة المشتريات بنجاح'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE, 'invoice_id', p_invoice_id);
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- (3) post_purchase_return — تغيير سطري المخزون/الذمم الدائنة فقط
-- ════════════════════════════════════════════════════════════════════════════
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
            'posted', true, NOW(), v_user_id,
            v_user_id
        ) RETURNING id INTO v_je_id;

        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, party_type, party_id)
        VALUES (v_return.tenant_id, v_je_id, 1, v_account_ap, 'تخفيض ذمم دائنة — مرتجع', v_total, 0, 'supplier', v_return.supplier_id);

        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit)
        VALUES (v_return.tenant_id, v_je_id, 2, v_account_inventory, 'إرجاع مخزون — مرتجع مشتريات', 0, v_total);
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


-- ════════════════════════════════════════════════════════════════════════════
-- (4) post_sales_invoice — تغيير أسطر تحديد الحسابات فقط (AR/إيراد/ضريبة/COGS/مخزون/شحن)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_trx         sales_transactions%ROWTYPE;
    v_account_ar  UUID;
    v_account_rev UUID;
    v_account_tax UUID;
    v_account_cogs UUID;
    v_account_inv UUID;
    v_je_id       UUID;
    v_user_id     UUID;
    v_total       NUMERIC(15,4) := 0;
    v_net_amount  NUMERIC(15,4) := 0;
    v_tax_amount  NUMERIC(15,4) := 0;
    v_delivered_subtotal NUMERIC(15,4) := 0;
    v_delivered_discount NUMERIC(15,4) := 0;
    v_cost_amount NUMERIC(15,4) := 0;
    v_line_num    INT := 0;
    v_entry_no    TEXT;
    v_inv_label   TEXT;
    v_item_count  INT := 0;
    v_has_delivered BOOLEAN := false;
    v_cogs_recorded BOOLEAN := false;
    v_total_debit  NUMERIC(15,4) := 0;
    v_total_credit NUMERIC(15,4) := 0;
    v_shipping     NUMERIC(15,4) := 0;
    v_account_shipping UUID;
BEGIN
    v_user_id := auth.uid();

    SELECT * INTO v_trx FROM sales_transactions WHERE id = p_invoice_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
    END IF;

    PERFORM assert_can_access_company(v_trx.company_id);

    IF v_trx.is_posted = true THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة مُرحَّلة مسبقاً');
    END IF;

    v_inv_label := COALESCE(v_trx.invoice_no, v_trx.draft_no, LEFT(p_invoice_id::text, 8));

    SELECT COUNT(*) INTO v_item_count
    FROM sales_transaction_items sti
    WHERE sti.transaction_id = p_invoice_id
      AND COALESCE(sti.delivered_qty, 0) > 0;

    v_has_delivered := v_item_count > 0;

    SELECT
        COALESCE(SUM(line_sub), 0),
        COALESCE(SUM(line_disc), 0),
        COALESCE(SUM((line_sub - line_disc) * line_tax_rate / 100), 0),
        COALESCE(SUM(line_cost), 0)
    INTO v_delivered_subtotal, v_delivered_discount, v_tax_amount, v_cost_amount
    FROM (
        SELECT
            COALESCE(sti.delivered_qty, 0) * COALESCE(sti.unit_price, 0) AS line_sub,
            CASE WHEN COALESCE(sti.discount_percent, 0) > 0
                 THEN COALESCE(sti.delivered_qty, 0) * COALESCE(sti.unit_price, 0) * sti.discount_percent / 100
                 ELSE COALESCE(sti.discount_amount, 0) * (COALESCE(sti.delivered_qty, 0) / NULLIF(sti.quantity, 0))
            END AS line_disc,
            COALESCE(sti.tax_rate, 0) AS line_tax_rate,
            COALESCE(sti.cost_price, 0) * COALESCE(sti.delivered_qty, 0) AS line_cost
        FROM sales_transaction_items sti
        WHERE sti.transaction_id = p_invoice_id
    ) t;

    v_net_amount := v_delivered_subtotal - v_delivered_discount;
    v_total := v_net_amount + v_tax_amount;

    IF NOT v_has_delivered THEN
        v_total := COALESCE(v_trx.total_amount, 0);
        v_tax_amount := COALESCE(v_trx.tax_amount, 0);
        v_net_amount := v_total - v_tax_amount;

        SELECT COALESCE(SUM(COALESCE(sti.cost_price, 0) * COALESCE(sti.quantity, 0)), 0)
        INTO v_cost_amount
        FROM sales_transaction_items sti
        WHERE sti.transaction_id = p_invoice_id;
    END IF;

    v_shipping := GREATEST(COALESCE(v_trx.shipping_amount, 0), 0);

    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'مبلغ الفاتورة صفر أو سالب — تحقق من الكميات المسلّمة');
    END IF;

    -- ── الحسابات (عبر المحلّل الموحّد؛ يبقى حساب العميل الطرفي أولوية) ──
    IF v_trx.customer_id IS NOT NULL THEN
        SELECT c.receivable_account_id INTO v_account_ar
        FROM customers c
        WHERE c.id = v_trx.customer_id AND c.receivable_account_id IS NOT NULL;

        IF v_account_ar IS NULL THEN
            SELECT id INTO v_account_ar
            FROM chart_of_accounts
            WHERE is_party_account = true AND party_type = 'customer' AND party_id = v_trx.customer_id
            LIMIT 1;
        END IF;
    END IF;

    IF v_account_ar IS NULL THEN
        v_account_ar := resolve_posting_account(v_trx.company_id, 'sales_receivable');
    END IF;

    v_account_rev := resolve_posting_account(v_trx.company_id, 'sales_revenue');

    IF v_tax_amount > 0 THEN
        v_account_tax := resolve_posting_account(v_trx.company_id, 'sales_tax_output');
    END IF;

    v_account_cogs := resolve_posting_account(v_trx.company_id, 'sales_cogs');
    v_account_inv  := resolve_posting_account(v_trx.company_id, 'sales_inventory');

    IF v_shipping > 0 THEN
        v_account_shipping := resolve_posting_account(v_trx.company_id, 'sales_shipping');
        IF v_account_shipping IS NULL THEN v_account_shipping := v_account_rev; END IF;
    END IF;

    IF v_account_ar IS NULL OR v_account_rev IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حسابات المبيعات غير مكتملة — تحقق من الذمم المدينة (1130/113) وحساب الإيرادات (411/4100)');
    END IF;

    IF v_tax_amount > 0 AND v_account_tax IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حساب ضريبة المخرجات (2130/2141/2150) غير موجود رغم وجود ضريبة — أضِفه قبل الترحيل');
    END IF;

    v_cogs_recorded := (v_cost_amount > 0 AND v_account_cogs IS NOT NULL AND v_account_inv IS NOT NULL);

    UPDATE sales_transactions
    SET stage = 'posted',
        is_posted = true,
        posted_at = NOW(),
        posted_by = v_user_id,
        subtotal = v_delivered_subtotal,
        discount_amount = v_delivered_discount,
        tax_amount = v_tax_amount,
        total_amount = v_total + v_shipping,
        updated_at = NOW()
    WHERE id = p_invoice_id;

    IF v_has_delivered THEN
        UPDATE sales_transaction_items
        SET quantity = delivered_qty,
            subtotal = delivered_qty * unit_price,
            discount_amount = CASE WHEN COALESCE(discount_percent, 0) > 0
                                   THEN (delivered_qty * unit_price) * (discount_percent / 100)
                                   ELSE COALESCE(discount_amount, 0) * (delivered_qty / NULLIF(quantity, 0))
                              END,
            tax_amount = ((delivered_qty * unit_price)
                          - CASE WHEN COALESCE(discount_percent, 0) > 0
                                 THEN (delivered_qty * unit_price) * (discount_percent / 100)
                                 ELSE COALESCE(discount_amount, 0) * (delivered_qty / NULLIF(quantity, 0))
                            END
                         ) * (COALESCE(tax_rate, 0) / 100),
            total = ((delivered_qty * unit_price)
                     - CASE WHEN COALESCE(discount_percent, 0) > 0
                            THEN (delivered_qty * unit_price) * (discount_percent / 100)
                            ELSE COALESCE(discount_amount, 0) * (delivered_qty / NULLIF(quantity, 0))
                       END
                    ) * (1 + COALESCE(tax_rate, 0) / 100)
        WHERE transaction_id = p_invoice_id
          AND COALESCE(delivered_qty, 0) > 0;
    END IF;

    v_entry_no := 'JE-S-' || to_char(NOW(), 'YYMMDD') || '-' ||
                  LPAD(nextval('journal_entry_number_seq')::text, 4, '0');

    v_total_debit  := v_total + v_shipping + CASE WHEN v_cogs_recorded THEN v_cost_amount ELSE 0 END;
    v_total_credit := v_net_amount
                      + CASE WHEN v_tax_amount > 0 THEN v_tax_amount ELSE 0 END
                      + v_shipping
                      + CASE WHEN v_cogs_recorded THEN v_cost_amount ELSE 0 END;

    INSERT INTO journal_entries (
        tenant_id, company_id, entry_number, entry_date,
        description,
        reference_type, reference_id, reference_number,
        currency, exchange_rate,
        total_debit, total_credit,
        status, is_posted, created_by
    ) VALUES (
        v_trx.tenant_id, v_trx.company_id, v_entry_no, CURRENT_DATE,
        'فاتورة مبيعات — ' || v_inv_label || CASE WHEN v_has_delivered THEN ' (بناءً على المسلّم فعلياً)' ELSE '' END,
        'sales_invoice', p_invoice_id, v_inv_label,
        COALESCE(v_trx.currency, 'SAR'), COALESCE(v_trx.exchange_rate, 1),
        v_total_debit, v_total_credit,
        'draft', false, v_user_id
    ) RETURNING id INTO v_je_id;

    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id, description,
        debit, credit, debit_fc, credit_fc, party_type, party_id
    ) VALUES (
        v_trx.tenant_id, v_je_id, v_line_num, v_account_ar,
        'ذمم مدينة — ' || COALESCE(v_trx.customer_name, ''),
        v_total + v_shipping, 0, v_total + v_shipping, 0, 'customer', v_trx.customer_id
    );

    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id, description,
        debit, credit, debit_fc, credit_fc
    ) VALUES (
        v_trx.tenant_id, v_je_id, v_line_num, v_account_rev,
        'إيرادات مبيعات — ' || v_inv_label,
        0, v_net_amount, 0, v_net_amount
    );

    IF v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc
        ) VALUES (
            v_trx.tenant_id, v_je_id, v_line_num, v_account_tax,
            'ضريبة مخرجات — ' || v_inv_label,
            0, v_tax_amount, 0, v_tax_amount
        );
    END IF;

    IF v_shipping > 0 AND v_account_shipping IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc
        ) VALUES (
            v_trx.tenant_id, v_je_id, v_line_num, v_account_shipping,
            'إيراد شحن — ' || v_inv_label,
            0, v_shipping, 0, v_shipping
        );
    END IF;

    IF v_cogs_recorded THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc
        ) VALUES (
            v_trx.tenant_id, v_je_id, v_line_num, v_account_cogs,
            'تكلفة مبيعات — ' || v_inv_label,
            v_cost_amount, 0, v_cost_amount, 0
        );

        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc
        ) VALUES (
            v_trx.tenant_id, v_je_id, v_line_num, v_account_inv,
            'إخراج مخزون — ' || v_inv_label,
            0, v_cost_amount, 0, v_cost_amount
        );
    END IF;

    PERFORM post_journal_entry(v_je_id, v_user_id);

    UPDATE sales_transactions SET journal_entry_id = v_je_id WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'invoice_number', v_inv_label,
        'journal_entry_id', v_je_id,
        'customer_account_id', v_account_ar,
        'based_on_delivered', v_has_delivered,
        'delivered_subtotal', v_delivered_subtotal,
        'delivered_discount', v_delivered_discount,
        'net_amount', v_net_amount,
        'tax_amount', v_tax_amount,
        'shipping_amount', v_shipping,
        'total_amount', v_total + v_shipping,
        'cost_amount', v_cost_amount,
        'cogs_recorded', v_cogs_recorded,
        'gross_profit', v_net_amount - v_cost_amount,
        'message', CASE
            WHEN v_has_delivered THEN 'تم ترحيل فاتورة المبيعات بنجاح — بناءً على الكميات المسلّمة فعلياً'
            ELSE 'تم ترحيل فاتورة المبيعات بنجاح — بناءً على الفاتورة الأصلية (لا توجد كميات مسلّمة)'
        END
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- (5) post_sales_return — تغيير أسطر تحديد الحسابات فقط (AR/إيراد/ضريبة/مخزون/COGS)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_sales_return(p_return_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_return       sales_returns%ROWTYPE;
    v_item         RECORD;
    v_je_id        UUID;
    v_user_id      UUID;
    v_net          NUMERIC(15,4) := 0;
    v_tax          NUMERIC(15,4) := 0;
    v_total        NUMERIC(15,4) := 0;
    v_cost_total   NUMERIC(15,4) := 0;
    v_item_cost    NUMERIC(15,4) := 0;
    v_src_txn      UUID;
    v_movement_count INT := 0;
    v_line_num     INT := 0;
    v_account_ar   UUID;
    v_account_rev  UUID;
    v_account_tax  UUID;
    v_account_inv  UUID;
    v_account_cogs UUID;
    v_movement_number VARCHAR(50);
    v_wh_id        UUID;
    v_cogs_recorded BOOLEAN := false;
    v_total_debit  NUMERIC(15,4) := 0;
    v_total_credit NUMERIC(15,4) := 0;
BEGIN
    v_user_id := auth.uid();

    SELECT * INTO v_return FROM sales_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'مرتجع المبيعات غير موجود');
    END IF;

    PERFORM assert_can_access_company(v_return.company_id);

    IF v_return.status = 'posted' THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرتجع مُرحَّل مسبقاً');
    END IF;

    v_wh_id := COALESCE(p_warehouse_id, v_return.warehouse_id);

    IF v_return.invoice_id IS NOT NULL THEN
        v_src_txn := v_return.invoice_id;
    ELSIF v_return.source_type = 'ecommerce' AND v_return.source_id IS NOT NULL THEN
        SELECT sales_invoice_id INTO v_src_txn FROM ecommerce_orders WHERE id = v_return.source_id;
    END IF;

    FOR v_item IN SELECT * FROM sales_return_items WHERE return_id = p_return_id
    LOOP
        v_movement_count := v_movement_count + 1;

        v_item_cost := 0;
        IF v_src_txn IS NOT NULL THEN
            SELECT sti.cost_price INTO v_item_cost
            FROM sales_transaction_items sti
            WHERE sti.transaction_id = v_src_txn
              AND ( (v_item.material_id IS NOT NULL AND sti.material_id = v_item.material_id)
                 OR (v_item.product_id  IS NOT NULL AND sti.product_id  = v_item.product_id) )
            ORDER BY sti.cost_price DESC NULLS LAST
            LIMIT 1;
            v_item_cost := COALESCE(v_item_cost, 0);
        END IF;
        v_cost_total := v_cost_total + v_item.quantity_returned * v_item_cost;

        v_movement_number := 'SR-' || COALESCE(v_return.return_number, '') || '-' || v_movement_count;

        INSERT INTO inventory_movements (
            tenant_id, company_id,
            movement_number, movement_date,
            movement_type,
            product_id, material_id, variant_id,
            to_warehouse_id,
            quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number,
            notes, created_by
        ) VALUES (
            v_return.tenant_id, v_return.company_id,
            v_movement_number, CURRENT_DATE,
            'return_in',
            v_item.product_id, v_item.material_id, v_item.variant_id,
            v_wh_id,
            v_item.quantity_returned, v_item_cost,
            v_item.quantity_returned * v_item_cost,
            'sales_return', p_return_id, v_return.return_number,
            'مرتجع مبيعات', v_user_id
        );
    END LOOP;

    SELECT
        COALESCE(SUM(COALESCE(sri.subtotal, sri.total - COALESCE(sri.tax_amount, 0),
                              sri.quantity_returned * COALESCE(sri.unit_price, 0))), 0),
        COALESCE(SUM(COALESCE(sri.tax_amount, 0)), 0)
    INTO v_net, v_tax
    FROM sales_return_items sri
    WHERE sri.return_id = p_return_id;
    v_total := v_net + v_tax;

    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'قيمة المرتجع صفر أو سالبة');
    END IF;

    -- ── الحسابات (عبر المحلّل الموحّد؛ يبقى حساب العميل الطرفي أولوية) ──
    IF v_return.customer_id IS NOT NULL THEN
        SELECT receivable_account_id INTO v_account_ar
        FROM customers WHERE id = v_return.customer_id AND receivable_account_id IS NOT NULL;
        IF v_account_ar IS NULL THEN
            SELECT id INTO v_account_ar FROM chart_of_accounts
            WHERE is_party_account = true AND party_type = 'customer' AND party_id = v_return.customer_id
            LIMIT 1;
        END IF;
    END IF;
    IF v_account_ar IS NULL THEN
        v_account_ar := resolve_posting_account(v_return.company_id, 'sales_receivable');
    END IF;

    v_account_rev := resolve_posting_account(v_return.company_id, 'sales_revenue');

    IF v_tax > 0 THEN
        v_account_tax := resolve_posting_account(v_return.company_id, 'sales_tax_output');
    END IF;

    v_account_inv  := resolve_posting_account(v_return.company_id, 'sales_inventory');
    v_account_cogs := resolve_posting_account(v_return.company_id, 'sales_cogs');

    IF v_account_ar IS NULL OR v_account_rev IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حسابات المرتجع غير مكتملة — تحقق من الذمم المدينة والإيرادات');
    END IF;
    IF v_tax > 0 AND v_account_tax IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حساب ضريبة المخرجات غير موجود رغم وجود ضريبة في المرتجع');
    END IF;

    v_cogs_recorded := (v_cost_total > 0 AND v_account_inv IS NOT NULL AND v_account_cogs IS NOT NULL);

    UPDATE sales_returns SET status = 'posted', updated_at = NOW() WHERE id = p_return_id;

    v_total_debit  := v_net + v_tax + CASE WHEN v_cogs_recorded THEN v_cost_total ELSE 0 END;
    v_total_credit := v_total + CASE WHEN v_cogs_recorded THEN v_cost_total ELSE 0 END;

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id,
        entry_date, entry_type, description,
        reference_type, reference_id, reference_number,
        total_debit, total_credit,
        status, is_posted, created_by
    ) VALUES (
        v_return.tenant_id, v_return.company_id, v_return.branch_id,
        CURRENT_DATE, 'auto',
        'مرتجع مبيعات — ' || COALESCE(v_return.return_number, ''),
        'sales_return', p_return_id, v_return.return_number,
        v_total_debit, v_total_credit,
        'draft', false, v_user_id
    ) RETURNING id INTO v_je_id;

    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
    VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_rev, 'تخفيض إيرادات — مرتجع', v_net, 0, v_net, 0);

    IF v_tax > 0 AND v_account_tax IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_tax, 'تخفيض ضريبة — مرتجع', v_tax, 0, v_tax, 0);
    END IF;

    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc, party_type, party_id)
    VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_ar, 'تخفيض ذمم مدينة — مرتجع', 0, v_total, 0, v_total, 'customer', v_return.customer_id);

    IF v_cogs_recorded THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_inv, 'إرجاع مخزون — مرتجع', v_cost_total, 0, v_cost_total, 0);

        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_cogs, 'عكس تكلفة مبيعات — مرتجع', 0, v_cost_total, 0, v_cost_total);
    END IF;

    PERFORM post_journal_entry(v_je_id, v_user_id);

    RETURN jsonb_build_object(
        'success', true,
        'return_id', p_return_id,
        'movements_created', v_movement_count,
        'net_amount', v_net,
        'tax_amount', v_tax,
        'total_amount', v_total,
        'cost_reversed', v_cost_total,
        'cogs_reversed', v_cogs_recorded,
        'journal_entry_id', v_je_id,
        'message', 'تم ترحيل مرتجع المبيعات بنجاح'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;

COMMIT;
