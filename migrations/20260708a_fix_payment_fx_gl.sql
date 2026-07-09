-- ════════════════════════════════════════════════════════════════════════
-- 20260708a — FIX: payment receipt/voucher GL — foreign-currency base value
-- ────────────────────────────────────────────────────────────────────────
-- INHERITED BUG (confirmed empirically 2026-07-07): the receipt/voucher JE
-- triggers posted NEW.amount (FACE amount, in NEW.currency) into BOTH the base
-- columns (debit/credit, total_debit/total_credit) AND the foreign columns
-- (debit_fc/credit_fc). Correct only for the base currency. For a confirmed
-- NON-base receipt/voucher the GL base value was the UNCONVERTED foreign amount
-- (e.g. EUR 100 @ rate 1.1 → debit=100 instead of 110). The trial balance /
-- account ledger read the base columns, so any foreign receipt/voucher
-- understated the GL by the FX difference. This affected the WEB too.
--
-- FX DIRECTION (verified against web code, NOT guessed): exchange_rate is
-- BASE-per-FOREIGN → base = foreign × rate. Evidence: JournalVoucherTab.tsx
-- 761/772 (local = fc × rate), 217 (fc = local / rate), useExchangeRateLookup
-- 245/248. See memory [[payment-voucher-fx-gl-bug]].
--
-- FIX (surgical — nothing else changed): base columns = amount × exchange_rate;
-- foreign (*_fc) columns = amount. For base currency (rate=1) this is a NO-OP
-- (amount × 1 = amount), so existing base-currency data/behavior is unchanged.
-- Both functions are otherwise byte-for-byte the current LIVE definitions
-- (receipt from 00013; voucher from 20260706a §6b incl. the treasury_account_id
-- preference — preserved).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Receipt ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_payment_receipt_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_entry_id UUID;
    v_cust UUID;
    v_cash UUID;
    v_fy UUID;
    v_base NUMERIC;   -- base-currency amount = amount × exchange_rate
BEGIN
    IF NEW.status != 'confirmed' THEN RETURN NEW; END IF;
    IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;

    v_base := round(NEW.amount * COALESCE(NEW.exchange_rate, 1), 2);

    -- حساب العميل (الذمم المدينة)
    v_cust := (SELECT receivable_account_id FROM customers WHERE id = NEW.customer_id);
    IF v_cust IS NULL THEN
        SELECT id INTO v_cust FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND is_party_account = true AND party_type = 'customer' AND party_id = NEW.customer_id LIMIT 1;
    END IF;
    IF v_cust IS NULL THEN
        SELECT id INTO v_cust FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND account_code IN ('1131','1130','113') AND COALESCE(is_group,false)=false
        ORDER BY CASE account_code WHEN '1131' THEN 0 WHEN '1130' THEN 1 ELSE 2 END LIMIT 1;
    END IF;
    IF v_cust IS NULL THEN
        SELECT id INTO v_cust FROM chart_of_accounts
        WHERE company_id = NEW.company_id AND is_receivable = true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;

    -- حساب النقد/البنك (دوري)
    IF NEW.treasury_account_id IS NOT NULL THEN
        v_cash := NEW.treasury_account_id;
    ELSIF NEW.payment_method IN ('cash','نقدي','نقداً') THEN
        SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND is_cash_account=true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    ELSE
        SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND is_bank_account=true AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;
    IF v_cash IS NULL THEN
        SELECT id INTO v_cash FROM chart_of_accounts WHERE company_id=NEW.company_id AND (is_cash_account=true OR is_bank_account=true) AND COALESCE(is_group,false)=false ORDER BY account_code LIMIT 1;
    END IF;

    IF v_cust IS NULL OR v_cash IS NULL THEN
        RAISE EXCEPTION 'سند القبض %: تعذّر إيجاد حساب % ', NEW.receipt_number,
            CASE WHEN v_cust IS NULL THEN 'العميل/الذمم المدينة' ELSE 'النقد/البنك' END;
    END IF;

    SELECT id INTO v_fy FROM fiscal_years WHERE company_id=NEW.company_id AND is_current=true LIMIT 1;

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date, fiscal_year_id, entry_type,
        reference_type, reference_id, reference_number, description, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by, created_at
    ) VALUES (
        NEW.tenant_id, NEW.company_id, NEW.branch_id, 'JE-PR-'||NEW.receipt_number, NEW.receipt_date, v_fy, 'payment_receipt',
        'payment_receipt', NEW.id, NEW.receipt_number,
        'سند قبض رقم '||NEW.receipt_number||' - '||COALESCE(NEW.customer_name,''), NEW.currency, NEW.exchange_rate,
        v_base, v_base, 'draft', false, NEW.created_by, NOW()
    ) RETURNING id INTO v_entry_id;

    -- Line 1: cash/bank — base = v_base (converted), foreign = NEW.amount
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, reference_type, reference_id)
    VALUES (NEW.tenant_id, v_entry_id, 1, v_cash, v_base, 0, NEW.amount, 0, NEW.currency, NEW.exchange_rate, 'تحصيل نقدي - سند '||NEW.receipt_number, 'payment_receipt', NEW.id);

    -- Line 2: customer receivable — base = v_base, foreign = NEW.amount
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, party_type, party_id, reference_type, reference_id)
    VALUES (NEW.tenant_id, v_entry_id, 2, v_cust, 0, v_base, 0, NEW.amount, NEW.currency, NEW.exchange_rate, 'تسديد ذمة العميل - سند '||NEW.receipt_number, 'customer', NEW.customer_id, 'payment_receipt', NEW.id);

    PERFORM post_journal_entry(v_entry_id, NEW.created_by);
    NEW.journal_entry_id := v_entry_id;
    RETURN NEW;
END;
$function$;

-- ── Voucher ─────────────────────────────────────────────────────────────
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
    v_base NUMERIC;   -- base-currency amount = amount × exchange_rate
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

    SELECT id INTO v_fy FROM fiscal_years WHERE company_id=NEW.company_id AND is_current=true LIMIT 1;

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date, fiscal_year_id, entry_type,
        reference_type, reference_id, reference_number, description, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by, created_at
    ) VALUES (
        NEW.tenant_id, NEW.company_id, NEW.branch_id, 'JE-PV-'||NEW.voucher_number, NEW.voucher_date, v_fy, 'payment_voucher',
        'payment_voucher', NEW.id, NEW.voucher_number,
        'سند صرف رقم '||NEW.voucher_number||' - '||COALESCE(NEW.supplier_name,''), NEW.currency, NEW.exchange_rate,
        v_base, v_base, 'draft', false, NEW.created_by, NOW()
    ) RETURNING id INTO v_entry_id;

    -- Line 1: supplier payable — base = v_base, foreign = NEW.amount
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, party_type, party_id, reference_type, reference_id)
    VALUES (NEW.tenant_id, v_entry_id, 1, v_supp, v_base, 0, NEW.amount, 0, NEW.currency, NEW.exchange_rate, 'سداد للمورد - سند '||NEW.voucher_number, 'supplier', NEW.supplier_id, 'payment_voucher', NEW.id);

    -- Line 2: cash/bank — base = v_base, foreign = NEW.amount
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc, currency, exchange_rate, description, reference_type, reference_id)
    VALUES (NEW.tenant_id, v_entry_id, 2, v_cash, 0, v_base, 0, NEW.amount, NEW.currency, NEW.exchange_rate, 'صرف نقدي - سند '||NEW.voucher_number, 'payment_voucher', NEW.id);

    PERFORM post_journal_entry(v_entry_id, NEW.created_by);
    NEW.journal_entry_id := v_entry_id;
    RETURN NEW;
END;
$function$;

COMMIT;
