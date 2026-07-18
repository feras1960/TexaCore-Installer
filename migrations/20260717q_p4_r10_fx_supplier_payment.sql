-- ════════════════════════════════════════════════════════════════════════
-- 20260717q_p4_r10_fx_supplier_payment
-- P4 — البند 1 (R10): فروقات الصرف المحققة عند سداد الموردين
-- ────────────────────────────────────────────────────────────────────────
-- المشكلة (R10 من تدقيق المشتريات 2026-07-17):
--   سند صرف المورّد يُرحَّل حالياً بقيد سطرين: مدين الذمم الدائنة (المورد) /
--   دائن النقد — كلاهما بقيمة الأساس = المبلغ الأجنبي × سعر صرف السند
--   (create_payment_voucher_journal_entry في 20260708a). لكن الذمم الدائنة
--   أُثبِتت أصلاً عند الفاتورة بسعر صرف الفاتورة. فحين يُسدَّد بسعر مختلف، تُسوّى
--   الذمة بسعر السند لا بسعر التثبيت، فيبقى فرق الأساس (ربح/خسارة صرف محقّقة) بلا
--   قيد، وتتراكم بقايا في حساب المورد لا تُصفّى أبداً.
--
-- الحل:
--   (أ) توسيع resolve_posting_account بدورين جديدين fx_gain / fx_loss يقرآن من
--       company_accounting_settings.default_fx_gain_account_id / _fx_loss_account_id
--       ثم يسقطان لأكواد شجرة الحسابات المتعارفة (ربح: 422 ثم 433؛ خسارة: 591 ثم 543)
--       — أكواد موجودة ومهيّأة فعلاً بشجرة الشركات (تُحقّق حياً).
--   (ب) تعديل create_payment_voucher_journal_entry: عندما يرتبط السند بفاتورة/حركة
--       شراء محدّدة (purchase_transaction_id أو purchase_invoice_id) بنفس العملة
--       الأجنبية وبسعر تثبيت يختلف عن سعر السند، تُسوّى الذمة الدائنة بقيمة الأساس
--       المثبتة (المبلغ × سعر الفاتورة) ويُضاف سطر ثالث بفرق الأساس:
--         سعر السند > سعر الفاتورة  →  خسارة صرف (مدين fx_loss)
--         سعر السند < سعر الفاتورة  →  ربح صرف  (دائن fx_gain)
--       النقد يبقى بسعر السند (النقد المدفوع فعلاً). القيد متوازن دائماً.
--
-- الحدود الموثّقة (مقصودة):
--   * البنية تربط السند بفاتورة واحدة اختيارية فقط (لا جدول تخصيص متعدّد الفواتير).
--     لذا تُحسب الفروقات فقط حين يحمل السند مرجع فاتورة/حركة محدّدة بسعرها المخزّن.
--     السداد على «رصيد جارٍ» بلا مرجع فاتورة لا يولّد قيد فرق (لا يوجد سعر تثبيت
--     موثوق لكل دفعة على مستوى الرصيد الجاري) — يُبقى السلوك السابق دون فرق.
--   * التسوية الجزئية مُعالَجة طبيعياً: الفرق يُطبّق على المبلغ الأجنبي المدفوع فعلاً
--     (NEW.amount) مضروباً بفرق السعرين، فأي جزء يُحسب بنسبته.
--   * إن تعذّر حلّ حساب الربح/الخسارة (fx_gain/fx_loss = NULL) يعود القيد لسلوكه
--     السابق (تسوية بسعر السند بلا سطر فرق) بدل الفشل.
--   * المبيعات (سندات القبض/سداد العملاء) خارج النطاق — دالة القبض لم تُلمَس.
--
-- FX DIRECTION (كما في 20260708a، مُتحقَّق ضد كود الويب): exchange_rate =
--   وحدة أساس لكل وحدة أجنبية → الأساس = الأجنبي × السعر.
--
-- معاملة واحدة idempotent (CREATE OR REPLACE). طبِّق يدوياً — لا auto-apply.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── (أ) توسيع resolve_posting_account بدوري fx_gain / fx_loss ─────────────
--   نسخة كاملة تحافظ على كل الأدوار القائمة حرفياً وتضيف الدورين الجديدين فقط.
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
            v_settings_col := 'default_revenue_account_id';
            v_codes := ARRAY['412','4120','421','411'];        v_require_postable := true;
        -- P4/R10: فروقات الصرف المحققة
        WHEN 'fx_gain' THEN
            v_settings_col := 'default_fx_gain_account_id';
            v_codes := ARRAY['422','433','4200'];              v_require_postable := true;
        WHEN 'fx_loss' THEN
            v_settings_col := 'default_fx_loss_account_id';
            v_codes := ARRAY['591','543','5900'];              v_require_postable := true;
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

-- ── (ب) سند الصرف: إضافة سطر فرق الصرف المحقّق ───────────────────────────
CREATE OR REPLACE FUNCTION public.create_payment_voucher_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_entry_id UUID;
    v_supp UUID;
    v_cash UUID;
    v_fy UUID;
    v_base NUMERIC;        -- النقد المدفوع بالأساس = amount × سعر السند
    -- P4/R10:
    v_base_ccy   TEXT;
    v_inv_rate   NUMERIC;
    v_inv_ccy    TEXT;
    v_settle_base NUMERIC; -- الذمة المسوّاة بالأساس = amount × سعر الفاتورة
    v_fx_diff    NUMERIC := 0;
    v_fx_acct    UUID := NULL;
    v_je_total   NUMERIC;
    v_ap_rate    NUMERIC;
BEGIN
    IF NEW.status != 'confirmed' THEN RETURN NEW; END IF;
    IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;

    v_base := round(NEW.amount * COALESCE(NEW.exchange_rate, 1), 2);

    -- حساب المورد (الذمم الدائنة)
    v_supp := (SELECT payable_account_id FROM suppliers WHERE id = NEW.supplier_id);
    IF v_supp IS NULL THEN
        SELECT id INTO v_supp FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND is_party_account = true AND party_type = 'supplier' AND party_id = NEW.supplier_id LIMIT 1;
    END IF;
    IF v_supp IS NULL THEN
        SELECT id INTO v_supp FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND is_payable = true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;
    IF v_supp IS NULL THEN
        SELECT id INTO v_supp FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND account_code IN ('2112','2110','2100','2000') AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;

    -- النقد/البنك: أولوية للحساب المختار على السند (treasury_account_id)
    IF NEW.treasury_account_id IS NOT NULL THEN
        SELECT id INTO v_cash FROM chart_of_accounts
        WHERE id = NEW.treasury_account_id AND company_id = NEW.company_id
          AND (is_cash_account = true OR is_bank_account = true)
          AND COALESCE(is_group,false) = false;
    END IF;
    IF v_cash IS NULL THEN
        IF NEW.payment_method IN ('cash','نقدي','نقداً') THEN
            SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND is_cash_account=true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
        ELSE
            SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND is_bank_account=true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
        END IF;
    END IF;
    IF v_cash IS NULL THEN
        SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND (is_cash_account=true OR is_bank_account=true) AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;

    IF v_supp IS NULL OR v_cash IS NULL THEN
        RAISE EXCEPTION 'سند الصرف %: تعذّر إيجاد حساب %', NEW.voucher_number,
            CASE WHEN v_supp IS NULL THEN 'المورد/الذمم الدائنة' ELSE 'النقد/البنك' END;
    END IF;

    -- ── فرق الصرف المحقّق (R10) ──────────────────────────────────────────
    v_settle_base := v_base;   -- الافتراضي: بلا فرق (يطابق السلوك السابق تماماً)
    v_ap_rate     := COALESCE(NEW.exchange_rate, 1);

    SELECT base_currency INTO v_base_ccy FROM company_accounting_settings
    WHERE company_id = NEW.company_id LIMIT 1;

    IF NEW.currency IS NOT NULL
       AND (v_base_ccy IS NULL OR NEW.currency <> v_base_ccy)
       AND COALESCE(NEW.exchange_rate, 1) <> 0 THEN
        -- إيجاد سعر تثبيت الفاتورة/الحركة المرتبطة (إن وُجدت)
        IF NEW.purchase_transaction_id IS NOT NULL THEN
            SELECT exchange_rate, currency INTO v_inv_rate, v_inv_ccy
            FROM purchase_transactions WHERE id = NEW.purchase_transaction_id;
        END IF;
        IF v_inv_rate IS NULL AND NEW.purchase_invoice_id IS NOT NULL THEN
            SELECT exchange_rate, currency INTO v_inv_rate, v_inv_ccy
            FROM purchase_invoices WHERE id = NEW.purchase_invoice_id;
        END IF;

        IF v_inv_rate IS NOT NULL
           AND v_inv_ccy = NEW.currency
           AND ROUND(v_inv_rate, 8) <> ROUND(COALESCE(NEW.exchange_rate, 1), 8) THEN
            v_settle_base := round(NEW.amount * v_inv_rate, 2);
            v_fx_diff     := round(v_base - v_settle_base, 2);
            IF v_fx_diff <> 0 THEN
                v_fx_acct := resolve_posting_account(
                    NEW.company_id,
                    CASE WHEN v_fx_diff > 0 THEN 'fx_loss' ELSE 'fx_gain' END);
                IF v_fx_acct IS NULL THEN
                    -- تعذّر حلّ حساب الفرق ⇒ العودة للسلوك السابق (تسوية بسعر السند)
                    v_settle_base := v_base;
                    v_fx_diff     := 0;
                ELSE
                    v_ap_rate := v_inv_rate;  -- الذمة تُسوّى بسعر التثبيت
                END IF;
            END IF;
        END IF;
    END IF;

    -- إجمالي القيد المتوازن (= v_base عند الخسارة، = v_settle_base عند الربح)
    v_je_total := v_settle_base + GREATEST(v_fx_diff, 0);

    SELECT id INTO v_fy FROM fiscal_years WHERE company_id=NEW.company_id AND is_current=true LIMIT 1;

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date, fiscal_year_id, entry_type,
        reference_type, reference_id, reference_number, description, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by, created_at
    ) VALUES (
        NEW.tenant_id, NEW.company_id, NEW.branch_id, 'JE-PV-'||NEW.voucher_number, NEW.voucher_date, v_fy, 'payment_voucher',
        'payment_voucher', NEW.id, NEW.voucher_number,
        'سند صرف رقم '||NEW.voucher_number||' - '||COALESCE(NEW.supplier_name,''), NEW.currency, NEW.exchange_rate,
        v_je_total, v_je_total, 'draft', false, NEW.created_by, NOW()
    ) RETURNING id INTO v_entry_id;

    -- Line 1: الذمم الدائنة (المورد) — بالأساس = v_settle_base (سعر التثبيت)، الأجنبي = amount
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, party_type, party_id, reference_type, reference_id)
    VALUES (NEW.tenant_id, v_entry_id, 1, v_supp, v_settle_base, 0, NEW.amount, 0, NEW.currency, v_ap_rate, 'سداد للمورد - سند '||NEW.voucher_number, 'supplier', NEW.supplier_id, 'payment_voucher', NEW.id);

    -- Line 2: النقد/البنك — بالأساس = v_base (سعر السند)، الأجنبي = amount
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, reference_type, reference_id)
    VALUES (NEW.tenant_id, v_entry_id, 2, v_cash, 0, v_base, 0, NEW.amount, NEW.currency, NEW.exchange_rate, 'صرف نقدي - سند '||NEW.voucher_number, 'payment_voucher', NEW.id);

    -- Line 3: فرق الصرف المحقّق (إن وُجد) — بالأساس فقط، بلا مبلغ أجنبي
    IF v_fx_diff <> 0 THEN
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, reference_type, reference_id)
        VALUES (NEW.tenant_id, v_entry_id, 3, v_fx_acct,
                CASE WHEN v_fx_diff > 0 THEN v_fx_diff ELSE 0 END,
                CASE WHEN v_fx_diff < 0 THEN -v_fx_diff ELSE 0 END,
                0, 0, COALESCE(v_base_ccy, NEW.currency), 1,
                CASE WHEN v_fx_diff > 0 THEN 'خسارة فرق صرف عند السداد - سند '||NEW.voucher_number
                     ELSE 'ربح فرق صرف عند السداد - سند '||NEW.voucher_number END,
                'payment_voucher', NEW.id);
    END IF;

    PERFORM post_journal_entry(v_entry_id, NEW.created_by);
    NEW.journal_entry_id := v_entry_id;
    RETURN NEW;
END;
$function$;

COMMIT;
