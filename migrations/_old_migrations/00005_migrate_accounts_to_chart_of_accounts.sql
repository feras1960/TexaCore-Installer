-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: نقل بيانات accounts إلى chart_of_accounts
-- Migration: Migrate accounts data to chart_of_accounts
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. Function لتحويل account_type إلى account_type_id
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_account_type_id(p_account_type VARCHAR)
RETURNS UUID AS $$
DECLARE
    v_type_id UUID;
    v_classification VARCHAR(50);
    v_normal_balance VARCHAR(10);
BEGIN
    -- تحديد classification و normal_balance حسب account_type
    CASE p_account_type
        WHEN 'asset' THEN
            v_classification := 'assets';
            v_normal_balance := 'debit';
        WHEN 'liability' THEN
            v_classification := 'liabilities';
            v_normal_balance := 'credit';
        WHEN 'equity' THEN
            v_classification := 'equity';
            v_normal_balance := 'credit';
        WHEN 'revenue' THEN
            v_classification := 'income';
            v_normal_balance := 'credit';
        WHEN 'expense' THEN
            v_classification := 'expenses';
            v_normal_balance := 'debit';
        ELSE
            v_classification := 'assets';
            v_normal_balance := 'debit';
    END CASE;
    
    -- البحث عن account_type_id المناسب
    SELECT id INTO v_type_id
    FROM account_types
    WHERE classification = v_classification
      AND normal_balance = v_normal_balance
    ORDER BY display_order
    LIMIT 1;
    
    -- إذا لم يوجد، استخدم ASSET كافتراضي
    IF v_type_id IS NULL THEN
        SELECT id INTO v_type_id FROM account_types WHERE code = 'ASSET';
    END IF;
    
    RETURN v_type_id;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- 2. نقل البيانات من accounts إلى chart_of_accounts
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_account RECORD;
    v_type_id UUID;
    v_tenant_id UUID;
    v_parent_id UUID;
    v_full_code VARCHAR(200);
BEGIN
    -- التحقق من وجود جدول accounts
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounts') THEN
        RAISE NOTICE 'Table accounts does not exist. Skipping migration.';
        RETURN;
    END IF;
    
    -- نقل البيانات
    FOR v_account IN 
        SELECT a.*, c.tenant_id
        FROM accounts a
        JOIN companies c ON a.company_id = c.id
        ORDER BY a.level, a.code
    LOOP
        -- الحصول على account_type_id
        v_type_id := get_account_type_id(v_account.account_type);
        
        -- الحصول على parent_id إذا كان موجوداً
        IF v_account.parent_id IS NOT NULL THEN
            SELECT id INTO v_parent_id
            FROM chart_of_accounts
            WHERE company_id = v_account.company_id
              AND account_code = (SELECT code FROM accounts WHERE id = v_account.parent_id);
        ELSE
            v_parent_id := NULL;
        END IF;
        
        -- حساب full_code
        v_full_code := v_account.code;
        IF v_parent_id IS NOT NULL THEN
            SELECT full_code INTO v_full_code
            FROM chart_of_accounts
            WHERE id = v_parent_id;
            v_full_code := v_full_code || '.' || v_account.code;
        END IF;
        
        -- إدراج في chart_of_accounts
        INSERT INTO chart_of_accounts (
            tenant_id,
            company_id,
            account_code,
            name_ar,
            name_en,
            account_type_id,
            parent_id,
            is_group,
            is_detail,
            level,
            full_code,
            currency,
            opening_balance,
            current_balance,
            is_active,
            created_at,
            updated_at
        ) VALUES (
            v_account.tenant_id,
            v_account.company_id,
            v_account.code,
            v_account.name,
            COALESCE(v_account.name_en, v_account.name),
            v_type_id,
            v_parent_id,
            v_account.is_group,
            NOT v_account.is_group, -- is_detail = NOT is_group
            v_account.level,
            v_full_code,
            COALESCE(v_account.currency_code, 'SAR'),
            COALESCE(v_account.opening_balance, 0),
            COALESCE(v_account.current_balance, 0),
            COALESCE(v_account.is_active, true),
            COALESCE(v_account.created_at, NOW()),
            COALESCE(v_account.updated_at, NOW())
        )
        ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING;
        
    END LOOP;
    
    RAISE NOTICE 'Migration from accounts to chart_of_accounts completed';
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. إنشاء View للتوافق مع الكود الحالي (اختياري)
-- ═══════════════════════════════════════════════════════════════

-- View للتوافق مع accountsService
CREATE OR REPLACE VIEW accounts_compatibility_view AS
SELECT 
    coa.id,
    coa.company_id,
    coa.account_code AS code,
    coa.name_ar AS name,
    coa.name_en,
    CASE at.classification
        WHEN 'assets' THEN 'asset'
        WHEN 'liabilities' THEN 'liability'
        WHEN 'equity' THEN 'equity'
        WHEN 'income' THEN 'revenue'
        WHEN 'expenses' THEN 'expense'
        ELSE 'asset'
    END AS account_type,
    coa.parent_id,
    coa.level,
    coa.is_group,
    coa.is_active,
    coa.currency AS currency_code,
    coa.opening_balance,
    coa.current_balance,
    NULL AS account_category,
    coa.created_at,
    coa.updated_at
FROM chart_of_accounts coa
JOIN account_types at ON coa.account_type_id = at.id;

-- ═══════════════════════════════════════════════════════════════
-- 4. ملاحظة: لا نحذف جدول accounts القديم الآن
-- يمكن حذفه لاحقاً بعد التأكد من أن كل شيء يعمل
-- ═══════════════════════════════════════════════════════════════

-- ALTER TABLE accounts RENAME TO accounts_old_backup;
