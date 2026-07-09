-- ════════════════════════════════════════════════════════════════════════
-- الدورة الضريبية + ربط حسابات الذمم
-- 20260706_tax_cycle_receivables_linking.sql
-- ════════════════════════════════════════════════════════════════════════
--
-- 1) ربط الحسابات الافتراضية (الذمم..الخ) للشركتين اللتين default_* = NULL:
--    «النخبة» a7a96b7c… و«الاحلام» 924c7954…
--    عبر auto_set_default_accounts (idempotent، تملأ من الشجرة القياسية).
--
-- 2) تعبئة tax_rates بصفّ VAT قياسي واحد لكل شركة enable_vat=true،
--    بنسبة default_vat_rate من إعداداتها، مربوط بحسابي المدخلات/المخرجات.
--    idempotent عبر NOT EXISTS على (tenant_id, code).
--
-- 3) دالة compute_tax_settlement(company, from, to) — تحسب مدخلات/مخرجات/صافي
--    (لا تُنشئ قيداً — الحساب والعرض فقط).
--
-- منطق النِسَب: كل الشركات الخمس enable_vat=true و default_vat_rate=20%.
-- نُدرج صفّ «VAT-STD» لكلٍّ منها بنسبتها الفعلية (لا نخترع نِسَباً).
-- الشركات التي enable_vat=false أو default_vat_rate=0 → تُستثنى (WHERE).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) ربط الذمم للشركتين (auto_set_default_accounts idempotent)
--    الدالة تُحدّث كل الأعمدة الافتراضية من الشجرة؛ الشركتان كل default_* = NULL
--    فلا شيء لتدهسه. (النمط الحيّ يربط الذمم بحساب المجموعة 1131/2111 مثل
--    نيكست/vape — resolve_posting_account يحوّله لحساب الطرف عند الترحيل.)
-- ─────────────────────────────────────────────────────────────────────
SELECT auto_set_default_accounts('a7a96b7c-5b0b-451a-ac58-d64a5a3d1930'::uuid);  -- النخبة
SELECT auto_set_default_accounts('924c7954-eee3-4542-9387-e919483d0aec'::uuid);  -- الاحلام


-- ─────────────────────────────────────────────────────────────────────
-- 2) تعبئة tax_rates — صفّ VAT قياسي واحد لكل شركة enable_vat=true
--    code = 'VAT-STD' فريد ضمن (tenant_id, code)
--    sales_account_id   → حساب المخرجات (214) = ضريبة على المبيعات
--    purchase_account_id→ حساب المدخلات (117) = ضريبة على المشتريات
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO tax_rates (
    tenant_id, company_id, code, name_ar, name_en, rate, tax_type,
    sales_account_id, purchase_account_id, is_default, is_active
)
SELECT
    c.tenant_id,
    c.id,
    'VAT-STD',
    'ضريبة القيمة المضافة',
    'Standard VAT',
    s.default_vat_rate,
    'vat',
    s.default_tax_output_account_id,   -- 214 مخرجات ← ضريبة المبيعات
    s.default_tax_input_account_id,    -- 117 مدخلات ← ضريبة المشتريات
    true,
    true
FROM companies c
JOIN company_accounting_settings s ON s.company_id = c.id
WHERE s.enable_vat = true
  AND COALESCE(s.default_vat_rate, 0) > 0
  AND NOT EXISTS (
        SELECT 1 FROM tax_rates tr
        WHERE tr.tenant_id = c.tenant_id AND tr.code = 'VAT-STD'
  );


-- ─────────────────────────────────────────────────────────────────────
-- 3) compute_tax_settlement(company, from, to) → jsonb
--    مطابق لمنطق واجهة VATSettlement.tsx:
--      output = Σ(credit − debit) على حساب المخرجات (214)
--      input  = Σ(debit − credit) على حساب المدخلات (117)
--      net    = output − input   (موجب ⇒ مستحق للحكومة / سالب ⇒ قابل للاسترداد)
--    الفترة نصف-مفتوحة [from, to) توافق واجهة التسوية.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_tax_settlement(
    p_company_id uuid,
    p_from date,
    p_to   date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_tenant_id   uuid;
    v_caller_ten  text;
    v_in_acct     uuid;
    v_out_acct    uuid;
    v_input       numeric := 0;
    v_output      numeric := 0;
    v_net         numeric := 0;
    v_direction   text;
BEGIN
    -- حارس الشركة: يجب أن تخصّ tenant المتصل
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Company not found';
    END IF;

    v_caller_ten := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id';
    -- عندما يُستدعى عبر PostgREST يكون هناك JWT؛ نمنع عبور tenant.
    IF v_caller_ten IS NOT NULL AND v_caller_ten <> v_tenant_id::text THEN
        RAISE EXCEPTION 'Access denied: company belongs to another tenant';
    END IF;

    -- حسابا الضريبة من الإعدادات
    SELECT default_tax_input_account_id, default_tax_output_account_id
      INTO v_in_acct, v_out_acct
      FROM company_accounting_settings
     WHERE company_id = p_company_id;

    -- ضريبة المدخلات (117): مدين − دائن
    IF v_in_acct IS NOT NULL THEN
        SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_input
          FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id = v_in_acct
           AND je.company_id = p_company_id
           AND je.status = 'posted'
           AND je.entry_date >= p_from
           AND je.entry_date <  p_to;
    END IF;

    -- ضريبة المخرجات (214): دائن − مدين
    IF v_out_acct IS NOT NULL THEN
        SELECT COALESCE(SUM(jl.credit - jl.debit), 0) INTO v_output
          FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id = v_out_acct
           AND je.company_id = p_company_id
           AND je.status = 'posted'
           AND je.entry_date >= p_from
           AND je.entry_date <  p_to;
    END IF;

    v_net := v_output - v_input;
    v_direction := CASE
        WHEN v_net > 0 THEN 'payable'       -- مستحق للحكومة (ندفع)
        WHEN v_net < 0 THEN 'refundable'    -- قابل للاسترداد/الترحيل
        ELSE 'balanced'
    END;

    RETURN jsonb_build_object(
        'company_id',   p_company_id,
        'from',         p_from,
        'to',           p_to,
        'input',        round(v_input, 2),
        'output',       round(v_output, 2),
        'net',          round(v_net, 2),
        'direction',    v_direction,
        'has_accounts', (v_in_acct IS NOT NULL AND v_out_acct IS NOT NULL)
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_tax_settlement(uuid, date, date) TO authenticated;

COMMIT;
