-- ═══════════════════════════════════════════════════════════════
-- V7.1: تصحيح trigger العملاء — عملاء الصرافة تحت 133
-- 2026-03-19
-- ═══════════════════════════════════════════════════════════════
-- التغييرات:
-- 1. حساب 133 يصبح مجموعة (is_detail=false) لاحتواء حسابات زبائن الصرافة
-- 2. تعديل auto_create_customer_sub_account ليوجّه exchange→133, عادي→1131/113
-- ═══════════════════════════════════════════════════════════════

-- 1. تحويل 133 من حساب تفصيلي إلى مجموعة
UPDATE chart_of_accounts
SET is_detail = false, is_group = true,
    name_ar = 'حسابات زبائن الصرافة',
    name_en = 'Exchange Customer Accounts'
WHERE account_code = '133';

-- 2. إعادة كتابة trigger العميل — يراعي customer_type = 'exchange'
CREATE OR REPLACE FUNCTION auto_create_customer_sub_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_parent_id UUID;
    v_type_id UUID;
    v_tenant_id UUID;
    v_seq INT;
    v_new_code TEXT;
    v_new_id UUID;
    v_parent_code TEXT;
BEGIN
    -- ═══ تحديد الحساب الأب حسب نوع العميل ═══
    IF NEW.customer_type = 'exchange' THEN
        -- زبائن الصرافة → تحت 133
        SELECT id, account_type_id, account_code
        INTO v_parent_id, v_type_id, v_parent_code
        FROM chart_of_accounts
        WHERE company_id = NEW.company_id
          AND account_code = '133'
          AND (is_group = true OR is_detail = false)
        LIMIT 1;
    ELSE
        -- عملاء عاديون → تحت 1131 أو 113 أو 1130
        SELECT id, account_type_id, account_code
        INTO v_parent_id, v_type_id, v_parent_code
        FROM chart_of_accounts
        WHERE company_id = NEW.company_id
          AND account_code IN ('1131', '113', '1130', '1310', '1311')
          AND (is_group = true OR is_detail = false)
        ORDER BY CASE account_code WHEN '1131' THEN 1 WHEN '113' THEN 2 ELSE 3 END
        LIMIT 1;
    END IF;

    IF v_parent_id IS NULL THEN RETURN NEW; END IF;

    SELECT tenant_id INTO v_tenant_id FROM chart_of_accounts WHERE id = v_parent_id;

    SELECT COUNT(*) + 1 INTO v_seq
    FROM chart_of_accounts WHERE parent_id = v_parent_id AND is_party_account = true;

    v_new_code := v_parent_code || '-' || LPAD(v_seq::TEXT, 3, '0');

    INSERT INTO chart_of_accounts (
        id, account_code, name_ar, name_en,
        parent_id, company_id, tenant_id, account_type_id,
        is_group, is_detail, is_system, is_party_account,
        party_id, party_type, current_balance,
        currency
    ) VALUES (
        gen_random_uuid(), v_new_code, NEW.name_ar, NEW.name_en,
        v_parent_id, NEW.company_id, v_tenant_id, v_type_id,
        false, true, false, true, NEW.id, 'customer', 0,
        COALESCE(NEW.currency, 'USD')
    ) RETURNING id INTO v_new_id;

    NEW.receivable_account_id := v_new_id;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION auto_create_customer_sub_account() IS 'V7.1 — حساب فرعي للعميل: exchange→133, عادي→1131/113';

-- 3. إنشاء حسابات ملخص لمجموعات الصرافة (133, 134, 135)
-- تُنشأ تلقائياً عند تشغيل setup_exchange_accounts أيضاً
INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_summary_account, summary_party_type, is_system, currency)
SELECT c.tenant_id, c.company_id, '133-SUM', 'إجمالي ذمم زبائن الصرافة', 'Total Exchange Customer Receivables',
       c.account_type_id, c.id, true, true, true, 'exchange_customer', true, c.currency
FROM chart_of_accounts c WHERE c.account_code = '133' AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts x WHERE x.company_id = c.company_id AND x.account_code = '133-SUM'
);

INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_summary_account, summary_party_type, is_system, currency)
SELECT c.tenant_id, c.company_id, '134-SUM', 'إجمالي حسابات الوكلاء', 'Total Agent Accounts',
       c.account_type_id, c.id, true, true, true, 'exchange_agent', true, c.currency
FROM chart_of_accounts c WHERE c.account_code = '134' AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts x WHERE x.company_id = c.company_id AND x.account_code = '134-SUM'
);

INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, is_summary_account, summary_party_type, is_system, currency)
SELECT c.tenant_id, c.company_id, '135-SUM', 'إجمالي حسابات الشركاء', 'Total Partner Accounts',
       c.account_type_id, c.id, true, true, true, 'exchange_partner', true, c.currency
FROM chart_of_accounts c WHERE c.account_code = '135' AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts x WHERE x.company_id = c.company_id AND x.account_code = '135-SUM'
);

-- ═══════════════════════════════════════════════════════════════
-- 4. Triggers: حذف الحساب المحاسبي تلقائياً عند حذف الكيان
--    يضمن عدم وجود حسابات يتيمة أبداً (DOPO DELETE ذرية)
-- ═══════════════════════════════════════════════════════════════

-- 4.1 العملاء → حذف receivable_account_id
CREATE OR REPLACE FUNCTION auto_delete_customer_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF OLD.receivable_account_id IS NOT NULL THEN
        DELETE FROM chart_of_accounts 
        WHERE id = OLD.receivable_account_id
          AND id NOT IN (SELECT account_id FROM journal_entry_lines WHERE account_id = OLD.receivable_account_id);
    END IF;
    DELETE FROM chart_of_accounts
    WHERE party_id = OLD.id AND is_party_account = true
      AND id NOT IN (SELECT account_id FROM journal_entry_lines);
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_auto_delete_customer_account ON customers;
CREATE TRIGGER trg_auto_delete_customer_account
    AFTER DELETE ON customers FOR EACH ROW
    EXECUTE FUNCTION auto_delete_customer_account();

-- 4.2 الموردين → حذف payable_account_id
CREATE OR REPLACE FUNCTION auto_delete_supplier_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF OLD.payable_account_id IS NOT NULL THEN
        DELETE FROM chart_of_accounts 
        WHERE id = OLD.payable_account_id
          AND id NOT IN (SELECT account_id FROM journal_entry_lines WHERE account_id = OLD.payable_account_id);
    END IF;
    DELETE FROM chart_of_accounts
    WHERE party_id = OLD.id AND is_party_account = true
      AND id NOT IN (SELECT account_id FROM journal_entry_lines);
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_auto_delete_supplier_account ON suppliers;
CREATE TRIGGER trg_auto_delete_supplier_account
    AFTER DELETE ON suppliers FOR EACH ROW
    EXECUTE FUNCTION auto_delete_supplier_account();

-- 4.3 الوكلاء → حذف payable_account_id
CREATE OR REPLACE FUNCTION auto_delete_agent_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF OLD.payable_account_id IS NOT NULL THEN
        DELETE FROM chart_of_accounts 
        WHERE id = OLD.payable_account_id
          AND id NOT IN (SELECT account_id FROM journal_entry_lines WHERE account_id = OLD.payable_account_id);
    END IF;
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_auto_delete_agent_account ON exchange_agents;
CREATE TRIGGER trg_auto_delete_agent_account
    AFTER DELETE ON exchange_agents FOR EACH ROW
    EXECUTE FUNCTION auto_delete_agent_account();

-- 4.4 الشركاء → حذف payable_account_id
CREATE OR REPLACE FUNCTION auto_delete_partner_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF OLD.payable_account_id IS NOT NULL THEN
        DELETE FROM chart_of_accounts 
        WHERE id = OLD.payable_account_id
          AND id NOT IN (SELECT account_id FROM journal_entry_lines WHERE account_id = OLD.payable_account_id);
    END IF;
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_auto_delete_partner_account ON exchange_partners;
CREATE TRIGGER trg_auto_delete_partner_account
    AFTER DELETE ON exchange_partners FOR EACH ROW
    EXECUTE FUNCTION auto_delete_partner_account();
