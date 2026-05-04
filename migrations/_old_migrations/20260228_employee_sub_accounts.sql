-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: حسابات الموظفين + الحسابات الملخصة (الموظفين + العملاء + الموردين)
-- تاريخ: 2026-02-28
-- ═══════════════════════════════════════════════════════════════════════════════
-- المنطق:
--   المرحلة 1: إضافة is_summary_account لـ chart_of_accounts
--   المرحلة 2: إضافة payable_account_id لـ employees  
--   المرحلة 3: تحويل حساب 213 لمجموعة
--   المرحلة 4: Trigger إنشاء حساب فرعي للموظف تلقائياً
--   المرحلة 5: إنشاء حسابات ملخصة (موظفين + عملاء + موردين)
--   المرحلة 6: Backfill — إنشاء حسابات للموظفين الموجودين
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- المرحلة 1: إضافة عمود is_summary_account
-- حساب ملخص = حساب ظاهر في الشجرة يعرض إجمالي أرصدة الأطراف
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'chart_of_accounts' AND column_name = 'is_summary_account'
    ) THEN
        ALTER TABLE chart_of_accounts ADD COLUMN is_summary_account BOOLEAN DEFAULT false;
        RAISE NOTICE '✅ تمت إضافة عمود is_summary_account لـ chart_of_accounts';
    ELSE
        RAISE NOTICE '⏭️ عمود is_summary_account موجود مسبقاً';
    END IF;
    
    -- summary_party_type: نوع الأطراف (employee/customer/supplier)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'chart_of_accounts' AND column_name = 'summary_party_type'
    ) THEN
        ALTER TABLE chart_of_accounts ADD COLUMN summary_party_type VARCHAR(20);
        RAISE NOTICE '✅ تمت إضافة عمود summary_party_type';
    ELSE
        RAISE NOTICE '⏭️ عمود summary_party_type موجود مسبقاً';
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- المرحلة 2: إضافة payable_account_id لجدول الموظفين
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'employees') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'employees' AND column_name = 'payable_account_id'
        ) THEN
            ALTER TABLE employees ADD COLUMN payable_account_id UUID REFERENCES chart_of_accounts(id);
            RAISE NOTICE '✅ تمت إضافة عمود payable_account_id لجدول employees';
        ELSE
            RAISE NOTICE '⏭️ عمود payable_account_id موجود مسبقاً';
        END IF;
    ELSE
        RAISE NOTICE '⚠️ جدول employees غير موجود — تم التخطي';
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- المرحلة 3: تحويل حسابات الأم إلى مجموعات
-- ═══════════════════════════════════════════════════════════════

-- تحويل حساب الرواتب المستحقة (213/2120) إلى مجموعة
UPDATE chart_of_accounts
SET is_group = true,
    is_detail = false
WHERE account_code IN ('213', '2120')
  AND is_group = false;


-- ═══════════════════════════════════════════════════════════════
-- المرحلة 4: دالة + Trigger إنشاء حساب فرعي للموظف
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_create_employee_sub_account()
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
    v_emp_name_ar TEXT;
    v_emp_name_en TEXT;
BEGIN
    -- البحث عن حساب الرواتب المستحقة
    SELECT id, account_type_id INTO v_parent_id, v_type_id
    FROM chart_of_accounts
    WHERE company_id = NEW.company_id
      AND account_code IN ('213', '2120', '2130', '214')
      AND (is_group = true OR is_detail = false)
    ORDER BY CASE account_code WHEN '213' THEN 1 WHEN '2120' THEN 2 WHEN '214' THEN 3 ELSE 4 END
    LIMIT 1;

    IF v_parent_id IS NULL THEN 
        RAISE NOTICE '⚠️ حساب الرواتب (213) غير موجود — تخطي';
        RETURN NEW; 
    END IF;

    SELECT tenant_id INTO v_tenant_id FROM chart_of_accounts WHERE id = v_parent_id;

    -- حساب التسلسل (تجاهل الحساب الملخص)
    SELECT COUNT(*) + 1 INTO v_seq
    FROM chart_of_accounts 
    WHERE parent_id = v_parent_id 
      AND is_party_account = true;

    v_new_code := (SELECT account_code FROM chart_of_accounts WHERE id = v_parent_id)
                  || '-' || LPAD(v_seq::TEXT, 3, '0');

    v_emp_name_ar := TRIM(NEW.first_name_ar || ' ' || COALESCE(NEW.last_name_ar, ''));
    v_emp_name_en := TRIM(COALESCE(NEW.first_name_en, '') || ' ' || COALESCE(NEW.last_name_en, ''));

    INSERT INTO chart_of_accounts (
        id, account_code, name_ar, name_en,
        parent_id, company_id, tenant_id, account_type_id,
        is_group, is_detail, is_system, is_party_account,
        party_id, party_type, current_balance
    ) VALUES (
        gen_random_uuid(), v_new_code, v_emp_name_ar, v_emp_name_en,
        v_parent_id, NEW.company_id, v_tenant_id, v_type_id,
        false, true, false, true, NEW.id, 'employee', 0
    ) RETURNING id INTO v_new_id;

    NEW.payable_account_id := v_new_id;

    RAISE NOTICE '✅ حساب فرعي للموظف: % (كود: %)', v_emp_name_ar, v_new_code;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION auto_create_employee_sub_account() IS 'إنشاء حساب فرعي تلقائي للموظف تحت 213 (الرواتب المستحقة)';

-- تفعيل الـ Trigger
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'employees') THEN
        DROP TRIGGER IF EXISTS trg_auto_create_employee_sub_account ON employees;
        CREATE TRIGGER trg_auto_create_employee_sub_account
            BEFORE INSERT ON employees
            FOR EACH ROW
            EXECUTE FUNCTION auto_create_employee_sub_account();
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- المرحلة 5: إنشاء الحسابات الملخصة (3 حسابات)
-- ═══════════════════════════════════════════════════════════════
-- لكل شركة: حساب ملخص واحد ظاهر تحت كل مجموعة
-- الحساب الملخص:
--   ● is_summary_account = true
--   ● is_party_account = false (ليظهر في الشجرة)
--   ● summary_party_type = نوع الأطراف
--   ● رصيده = مجموع أرصدة الحسابات الفرعية المخفية

DO $$
DECLARE
    v_company RECORD;
    v_parent RECORD;
    v_sum_code TEXT;
    v_sum_name_ar TEXT;
    v_sum_name_en TEXT;
    v_party_type TEXT;
    v_account_codes TEXT[];
    v_i INT;
BEGIN
    -- لكل شركة في النظام
    FOR v_company IN SELECT DISTINCT company_id FROM chart_of_accounts WHERE company_id IS NOT NULL
    LOOP
        -- ═══ 3 فئات: موظفين + عملاء + موردين ═══
        v_account_codes := ARRAY[
            '213,2120,2130,214',  -- الموظفين
            '1131,113,1130,1310', -- العملاء
            '2111,211,2110'       -- الموردين
        ];

        FOR v_i IN 1..3
        LOOP
            -- تحديد النوع والأسماء
            CASE v_i
                WHEN 1 THEN 
                    v_party_type := 'employee';
                    v_sum_name_ar := 'مستحقات الموظفين';
                    v_sum_name_en := 'Employee Payables';
                WHEN 2 THEN 
                    v_party_type := 'customer';
                    v_sum_name_ar := 'إجمالي ذمم العملاء';
                    v_sum_name_en := 'Total Customer Receivables';
                WHEN 3 THEN 
                    v_party_type := 'supplier';
                    v_sum_name_ar := 'إجمالي ذمم الموردين';
                    v_sum_name_en := 'Total Supplier Payables';
            END CASE;

            -- البحث عن الحساب الأم
            SELECT id, account_code, account_type_id, tenant_id 
            INTO v_parent
            FROM chart_of_accounts
            WHERE company_id = v_company.company_id
              AND account_code = ANY(string_to_array(v_account_codes[v_i], ','))
              AND (is_group = true OR is_detail = false)
            ORDER BY 
                CASE account_code 
                    WHEN '213' THEN 1 WHEN '2120' THEN 2 
                    WHEN '1131' THEN 1 WHEN '113' THEN 2
                    WHEN '2111' THEN 1 WHEN '211' THEN 2
                    ELSE 5 
                END
            LIMIT 1;

            -- إذا لم يوجد حساب أم → تخطي
            IF v_parent.id IS NULL THEN
                CONTINUE;
            END IF;

            -- التحقق من عدم وجود حساب ملخص مسبق
            IF EXISTS (
                SELECT 1 FROM chart_of_accounts 
                WHERE parent_id = v_parent.id 
                  AND is_summary_account = true
                  AND summary_party_type = v_party_type
            ) THEN
                RAISE NOTICE '⏭️ حساب ملخص % موجود مسبقاً للشركة %', v_party_type, v_company.company_id;
                CONTINUE;
            END IF;

            v_sum_code := v_parent.account_code || '-SUM';

            -- حساب الرصيد الإجمالي من الحسابات الفرعية
            INSERT INTO chart_of_accounts (
                id, account_code, name_ar, name_en,
                parent_id, company_id, tenant_id, account_type_id,
                is_group, is_detail, is_system, 
                is_party_account, is_summary_account, summary_party_type,
                current_balance
            ) VALUES (
                gen_random_uuid(), v_sum_code, v_sum_name_ar, v_sum_name_en,
                v_parent.id, v_company.company_id, v_parent.tenant_id, v_parent.account_type_id,
                false, true, true,
                false, true, v_party_type,
                COALESCE((
                    SELECT SUM(current_balance) 
                    FROM chart_of_accounts 
                    WHERE parent_id = v_parent.id 
                      AND is_party_account = true
                ), 0)
            );

            RAISE NOTICE '✅ حساب ملخص: % (%) للشركة %', v_sum_name_ar, v_sum_code, v_company.company_id;
        END LOOP;
    END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- المرحلة 6: Backfill — إنشاء حسابات للموظفين الموجودين
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_emp RECORD;
    v_parent_id UUID;
    v_type_id UUID;
    v_tenant_id UUID;
    v_seq INT;
    v_new_code TEXT;
    v_new_id UUID;
    v_emp_name_ar TEXT;
    v_emp_name_en TEXT;
    v_count INT := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'employees') THEN
        RETURN;
    END IF;

    FOR v_emp IN 
        SELECT e.* 
        FROM employees e 
        WHERE e.payable_account_id IS NULL
          AND e.company_id IS NOT NULL
        ORDER BY e.created_at
    LOOP
        SELECT id, account_type_id INTO v_parent_id, v_type_id
        FROM chart_of_accounts
        WHERE company_id = v_emp.company_id
          AND account_code IN ('213', '2120', '2130', '214')
          AND (is_group = true OR is_detail = false)
        ORDER BY CASE account_code WHEN '213' THEN 1 WHEN '2120' THEN 2 WHEN '214' THEN 3 ELSE 4 END
        LIMIT 1;

        IF v_parent_id IS NULL THEN CONTINUE; END IF;

        SELECT tenant_id INTO v_tenant_id FROM chart_of_accounts WHERE id = v_parent_id;

        -- تجاهل الحساب الملخص في العد
        SELECT COUNT(*) + 1 INTO v_seq
        FROM chart_of_accounts 
        WHERE parent_id = v_parent_id 
          AND is_party_account = true;

        v_new_code := (SELECT account_code FROM chart_of_accounts WHERE id = v_parent_id)
                      || '-' || LPAD(v_seq::TEXT, 3, '0');

        v_emp_name_ar := TRIM(v_emp.first_name_ar || ' ' || COALESCE(v_emp.last_name_ar, ''));
        v_emp_name_en := TRIM(COALESCE(v_emp.first_name_en, '') || ' ' || COALESCE(v_emp.last_name_en, ''));

        IF NOT EXISTS (
            SELECT 1 FROM chart_of_accounts 
            WHERE party_id = v_emp.id AND party_type = 'employee'
        ) THEN
            INSERT INTO chart_of_accounts (
                id, account_code, name_ar, name_en,
                parent_id, company_id, tenant_id, account_type_id,
                is_group, is_detail, is_system, is_party_account,
                party_id, party_type, current_balance
            ) VALUES (
                gen_random_uuid(), v_new_code, v_emp_name_ar, v_emp_name_en,
                v_parent_id, v_emp.company_id, v_tenant_id, v_type_id,
                false, true, false, true, v_emp.id, 'employee', 0
            ) RETURNING id INTO v_new_id;

            UPDATE employees SET payable_account_id = v_new_id WHERE id = v_emp.id;
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RAISE NOTICE '✅ تم إنشاء حسابات فرعية لـ % موظف موجود', v_count;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- المرحلة 7: دالة تحديث رصيد الحساب الملخص
-- تُستدعى عند تغيّر رصيد أي حساب فرعي
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_summary_account_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    -- تحديث رصيد الحساب الملخص = مجموع أرصدة الحسابات الفرعية
    UPDATE chart_of_accounts
    SET current_balance = COALESCE((
        SELECT SUM(current_balance)
        FROM chart_of_accounts sub
        WHERE sub.parent_id = NEW.parent_id
          AND sub.is_party_account = true
    ), 0),
    updated_at = now()
    WHERE parent_id = NEW.parent_id
      AND is_summary_account = true;

    RETURN NEW;
END;
$function$;

-- Trigger: عند تحديث رصيد أي حساب فرعي (party_account)
DROP TRIGGER IF EXISTS trg_update_summary_balance ON chart_of_accounts;
CREATE TRIGGER trg_update_summary_balance
    AFTER UPDATE OF current_balance ON chart_of_accounts
    FOR EACH ROW
    WHEN (OLD.is_party_account = true AND NEW.current_balance IS DISTINCT FROM OLD.current_balance)
    EXECUTE FUNCTION update_summary_account_balance();


-- ═══════════════════════════════════════════════════════════════
-- ✅ ملخص Migration
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════';
    RAISE NOTICE '✅ Migration مكتملة:';
    RAISE NOTICE '  • is_summary_account + summary_party_type مضافة';
    RAISE NOTICE '  • payable_account_id مضاف لـ employees';
    RAISE NOTICE '  • حساب 213 محوّل لمجموعة';
    RAISE NOTICE '  • Trigger: auto_create_employee_sub_account';
    RAISE NOTICE '  • حسابات ملخصة: موظفين + عملاء + موردين';
    RAISE NOTICE '  • Trigger: تحديث رصيد الملخص تلقائياً';
    RAISE NOTICE '═══════════════════════════════════════════════════════';
END $$;
