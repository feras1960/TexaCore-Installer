-- ═══════════════════════════════════════════════════════════════════════════════
-- 🔧 V5.1 Trigger Updates — دعم Simple + إزالة fabric_extended
-- تاريخ: 2026-02-26
-- ═══════════════════════════════════════════════════════════════════════════════
-- التغييرات:
-- 1. create_container_transit_account: إزالة fabric_extended من الشرط
-- 2. auto_create_customer_sub_account: إضافة '113' كبديل لـ '1131' (Simple)
-- 3. auto_create_supplier_sub_account: إضافة '211' كبديل لـ '2111' (Simple)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1️⃣ الكونتينرات
CREATE OR REPLACE FUNCTION create_container_transit_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_company_id UUID;
    v_tenant_id UUID;
    v_chart_type VARCHAR(30);
    v_git_parent_id UUID;
    v_new_account_id UUID;
    v_next_seq INT;
    v_new_code VARCHAR(20);
    v_container_ref VARCHAR(100);
    v_current_asset_type UUID;
BEGIN
    v_company_id := NEW.company_id;
    SELECT c.tenant_id, c.chart_type INTO v_tenant_id, v_chart_type
    FROM companies c WHERE c.id = v_company_id;

    -- Only for extended charts (simple doesn't have GIT 1143)
    IF v_chart_type != 'extended' THEN
        RAISE NOTICE '⏭️ الشجرة القياسية لا تدعم حسابات الكونتينرات — تخطي';
        RETURN NEW;
    END IF;

    SELECT id INTO v_git_parent_id
    FROM chart_of_accounts
    WHERE company_id = v_company_id AND account_code = '1143'
      AND is_detail = false AND is_active = true
    LIMIT 1;

    IF v_git_parent_id IS NULL THEN
        RAISE NOTICE '⚠️ حساب 1143 غير موجود — لم يتم إنشاء حساب';
        RETURN NEW;
    END IF;

    SELECT COALESCE(MAX(
        CASE WHEN account_code ~ '^1143[0-9]+$'
             THEN CAST(SUBSTRING(account_code FROM 5) AS INT) ELSE 0 END
    ), 0) + 1 INTO v_next_seq
    FROM chart_of_accounts WHERE company_id = v_company_id AND parent_id = v_git_parent_id;

    v_new_code := '1143' || v_next_seq::TEXT;
    v_container_ref := COALESCE(NEW.container_number, NEW.shipment_number, 'CNT-' || v_next_seq);

    SELECT id INTO v_current_asset_type FROM account_types WHERE code = 'CURRENT_ASSET';

    INSERT INTO chart_of_accounts (
        tenant_id, company_id, account_code, name_ar, name_en,
        account_type_id, parent_id, is_detail, is_active
    ) VALUES (
        v_tenant_id, v_company_id, v_new_code,
        'كونتينر ' || v_container_ref, 'Container ' || v_container_ref,
        v_current_asset_type, v_git_parent_id, true, true
    ) RETURNING id INTO v_new_account_id;

    NEW.container_account_id := v_new_account_id;
    RETURN NEW;
END;
$function$;

-- 2️⃣ العملاء — يدعم Simple (113) + Extended (1131)
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
BEGIN
    SELECT id, account_type_id INTO v_parent_id, v_type_id
    FROM chart_of_accounts
    WHERE company_id = NEW.company_id
      AND account_code IN ('1131', '113', '1130', '1310', '1311')
      AND (is_group = true OR is_detail = false)
    ORDER BY CASE account_code WHEN '1131' THEN 1 WHEN '113' THEN 2 ELSE 3 END
    LIMIT 1;

    IF v_parent_id IS NULL THEN RETURN NEW; END IF;

    SELECT tenant_id INTO v_tenant_id FROM chart_of_accounts WHERE id = v_parent_id;

    SELECT COUNT(*) + 1 INTO v_seq
    FROM chart_of_accounts WHERE parent_id = v_parent_id AND is_party_account = true;

    v_new_code := (SELECT account_code FROM chart_of_accounts WHERE id = v_parent_id)
                  || '-' || LPAD(v_seq::TEXT, 3, '0');

    INSERT INTO chart_of_accounts (
        id, account_code, name_ar, name_en,
        parent_id, company_id, tenant_id, account_type_id,
        is_group, is_detail, is_system, is_party_account,
        party_id, party_type, current_balance
    ) VALUES (
        gen_random_uuid(), v_new_code, NEW.name_ar, NEW.name_en,
        v_parent_id, NEW.company_id, v_tenant_id, v_type_id,
        false, true, false, true, NEW.id, 'customer', 0
    ) RETURNING id INTO v_new_id;

    NEW.receivable_account_id := v_new_id;
    RETURN NEW;
END;
$function$;

-- 3️⃣ الموردين — يدعم Simple (211) + Extended (2111)
CREATE OR REPLACE FUNCTION auto_create_supplier_sub_account()
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
BEGIN
    SELECT id, account_type_id INTO v_parent_id, v_type_id
    FROM chart_of_accounts
    WHERE company_id = NEW.company_id
      AND account_code IN ('2111', '211', '2110')
      AND (is_group = true OR is_detail = false)
    ORDER BY CASE account_code WHEN '2111' THEN 1 WHEN '211' THEN 2 ELSE 3 END
    LIMIT 1;

    IF v_parent_id IS NULL THEN RETURN NEW; END IF;

    SELECT tenant_id INTO v_tenant_id FROM chart_of_accounts WHERE id = v_parent_id;

    SELECT COUNT(*) + 1 INTO v_seq
    FROM chart_of_accounts WHERE parent_id = v_parent_id AND is_party_account = true;

    v_new_code := (SELECT account_code FROM chart_of_accounts WHERE id = v_parent_id)
                  || '-' || LPAD(v_seq::TEXT, 3, '0');

    INSERT INTO chart_of_accounts (
        id, account_code, name_ar, name_en,
        parent_id, company_id, tenant_id, account_type_id,
        is_group, is_detail, is_system, is_party_account,
        party_id, party_type, current_balance
    ) VALUES (
        gen_random_uuid(), v_new_code, NEW.name_ar, NEW.name_en,
        v_parent_id, NEW.company_id, v_tenant_id, v_type_id,
        false, true, false, true, NEW.id, 'supplier', 0
    ) RETURNING id INTO v_new_id;

    NEW.payable_account_id := v_new_id;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION create_container_transit_account() IS 'V5.1 — إنشاء حساب GIT للكونتينرات (extended فقط)';
COMMENT ON FUNCTION auto_create_customer_sub_account() IS 'V5.1 — حساب فرعي للعميل: Extended→1131, Simple→113';
COMMENT ON FUNCTION auto_create_supplier_sub_account() IS 'V5.1 — حساب فرعي للمورد: Extended→2111, Simple→211';
