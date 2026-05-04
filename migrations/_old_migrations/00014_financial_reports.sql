-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00014: التقارير المالية
-- Financial Reports
-- ═══════════════════════════════════════════════════════════════════════════
-- المحتويات:
-- 1. ميزان المراجعة (Trial Balance)
-- 2. قائمة الدخل (Income Statement)
-- 3. الميزانية العمومية (Balance Sheet)
-- 4. كشف حساب العميل/المورد (Account Statement)
-- 5. تقرير أعمار الديون (Aging Report)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. ميزان المراجعة (Trial Balance)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_trial_balance(
    p_company_id UUID,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
    account_id UUID,
    account_code VARCHAR(50),
    account_name_ar VARCHAR(200),
    account_name_en VARCHAR(200),
    account_type VARCHAR(50),
    parent_code VARCHAR(50),
    level INT,
    is_group BOOLEAN,
    opening_debit DECIMAL(15,2),
    opening_credit DECIMAL(15,2),
    period_debit DECIMAL(15,2),
    period_credit DECIMAL(15,2),
    closing_debit DECIMAL(15,2),
    closing_credit DECIMAL(15,2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_date DATE;
    v_to_date DATE;
BEGIN
    -- تحديد التواريخ الافتراضية
    v_from_date := COALESCE(p_from_date, DATE_TRUNC('year', CURRENT_DATE)::DATE);
    v_to_date := COALESCE(p_to_date, CURRENT_DATE);
    
    RETURN QUERY
    WITH account_movements AS (
        -- حركات قبل الفترة (الرصيد الافتتاحي)
        SELECT 
            jel.account_id,
            SUM(CASE WHEN je.entry_date < v_from_date THEN jel.debit ELSE 0 END) as opening_debit,
            SUM(CASE WHEN je.entry_date < v_from_date THEN jel.credit ELSE 0 END) as opening_credit,
            -- حركات الفترة
            SUM(CASE WHEN je.entry_date BETWEEN v_from_date AND v_to_date THEN jel.debit ELSE 0 END) as period_debit,
            SUM(CASE WHEN je.entry_date BETWEEN v_from_date AND v_to_date THEN jel.credit ELSE 0 END) as period_credit
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id
        WHERE je.company_id = p_company_id
          AND je.is_posted = true
          AND je.entry_date <= v_to_date
        GROUP BY jel.account_id
    ),
    account_balances AS (
        SELECT 
            coa.id as account_id,
            coa.account_code,
            coa.name_ar as account_name_ar,
            coa.name_en as account_name_en,
            at.code as account_type,
            parent.account_code as parent_code,
            coa.level,
            coa.is_group,
            COALESCE(coa.opening_balance, 0) as initial_balance,
            COALESCE(am.opening_debit, 0) as mov_opening_debit,
            COALESCE(am.opening_credit, 0) as mov_opening_credit,
            COALESCE(am.period_debit, 0) as period_debit,
            COALESCE(am.period_credit, 0) as period_credit,
            at.normal_balance
        FROM chart_of_accounts coa
        LEFT JOIN account_types at ON coa.account_type_id = at.id
        LEFT JOIN chart_of_accounts parent ON coa.parent_id = parent.id
        LEFT JOIN account_movements am ON coa.id = am.account_id
        WHERE coa.company_id = p_company_id
          AND coa.is_active = true
    )
    SELECT 
        ab.account_id,
        ab.account_code,
        ab.account_name_ar,
        ab.account_name_en,
        ab.account_type,
        ab.parent_code,
        ab.level,
        ab.is_group,
        -- الرصيد الافتتاحي
        CASE 
            WHEN ab.normal_balance = 'debit' THEN 
                GREATEST(ab.initial_balance + ab.mov_opening_debit - ab.mov_opening_credit, 0)
            ELSE 0::DECIMAL(15,2)
        END as opening_debit,
        CASE 
            WHEN ab.normal_balance = 'credit' THEN 
                GREATEST(ab.initial_balance + ab.mov_opening_credit - ab.mov_opening_debit, 0)
            ELSE 0::DECIMAL(15,2)
        END as opening_credit,
        -- حركات الفترة
        ab.period_debit,
        ab.period_credit,
        -- الرصيد الختامي
        CASE 
            WHEN ab.normal_balance = 'debit' THEN 
                GREATEST(ab.initial_balance + ab.mov_opening_debit - ab.mov_opening_credit + ab.period_debit - ab.period_credit, 0)
            ELSE 0::DECIMAL(15,2)
        END as closing_debit,
        CASE 
            WHEN ab.normal_balance = 'credit' THEN 
                GREATEST(ab.initial_balance + ab.mov_opening_credit - ab.mov_opening_debit + ab.period_credit - ab.period_debit, 0)
            ELSE 0::DECIMAL(15,2)
        END as closing_credit
    FROM account_balances ab
    ORDER BY ab.account_code;
END;
$$;

COMMENT ON FUNCTION get_trial_balance(UUID, DATE, DATE) IS 'ميزان المراجعة - يعرض أرصدة جميع الحسابات (افتتاحي، حركات الفترة، ختامي)';

-- ═══════════════════════════════════════════════════════════════
-- 2. قائمة الدخل (Income Statement)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_income_statement(
    p_company_id UUID,
    p_from_date DATE,
    p_to_date DATE
)
RETURNS TABLE (
    category VARCHAR(50),
    category_ar VARCHAR(100),
    account_id UUID,
    account_code VARCHAR(50),
    account_name_ar VARCHAR(200),
    account_name_en VARCHAR(200),
    amount DECIMAL(15,2),
    is_subtotal BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH income_data AS (
        SELECT 
            coa.id as account_id,
            coa.account_code,
            coa.name_ar as account_name_ar,
            coa.name_en as account_name_en,
            at.classification,
            at.code as type_code,
            COALESCE(SUM(jel.credit - jel.debit), 0) as net_amount
        FROM chart_of_accounts coa
        JOIN account_types at ON coa.account_type_id = at.id
        LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
        LEFT JOIN journal_entries je ON jel.entry_id = je.id 
            AND je.is_posted = true
            AND je.entry_date BETWEEN p_from_date AND p_to_date
        WHERE coa.company_id = p_company_id
          AND coa.is_active = true
          AND coa.is_detail = true
          AND at.classification IN ('income', 'expenses')
        GROUP BY coa.id, coa.account_code, coa.name_ar, coa.name_en, at.classification, at.code
        HAVING COALESCE(SUM(jel.credit - jel.debit), 0) != 0
    )
    -- الإيرادات
    SELECT 
        'revenue'::VARCHAR(50) as category,
        'الإيرادات'::VARCHAR(100) as category_ar,
        id.account_id,
        id.account_code,
        id.account_name_ar,
        id.account_name_en,
        id.net_amount as amount,
        false as is_subtotal
    FROM income_data id
    WHERE id.classification = 'income'
    
    UNION ALL
    
    -- إجمالي الإيرادات
    SELECT 
        'revenue_total'::VARCHAR(50),
        'إجمالي الإيرادات'::VARCHAR(100),
        NULL::UUID,
        ''::VARCHAR(50),
        'إجمالي الإيرادات'::VARCHAR(200),
        'Total Revenue'::VARCHAR(200),
        COALESCE(SUM(net_amount), 0),
        true
    FROM income_data
    WHERE classification = 'income'
    
    UNION ALL
    
    -- المصروفات
    SELECT 
        'expenses'::VARCHAR(50),
        'المصروفات'::VARCHAR(100),
        id.account_id,
        id.account_code,
        id.account_name_ar,
        id.account_name_en,
        ABS(id.net_amount),
        false
    FROM income_data id
    WHERE id.classification = 'expenses'
    
    UNION ALL
    
    -- إجمالي المصروفات
    SELECT 
        'expenses_total'::VARCHAR(50),
        'إجمالي المصروفات'::VARCHAR(100),
        NULL::UUID,
        ''::VARCHAR(50),
        'إجمالي المصروفات'::VARCHAR(200),
        'Total Expenses'::VARCHAR(200),
        COALESCE(ABS(SUM(net_amount)), 0),
        true
    FROM income_data
    WHERE classification = 'expenses'
    
    UNION ALL
    
    -- صافي الربح/الخسارة
    SELECT 
        'net_income'::VARCHAR(50),
        'صافي الربح/الخسارة'::VARCHAR(100),
        NULL::UUID,
        ''::VARCHAR(50),
        CASE 
            WHEN COALESCE(SUM(CASE WHEN classification = 'income' THEN net_amount ELSE -net_amount END), 0) >= 0 
            THEN 'صافي الربح'::VARCHAR(200)
            ELSE 'صافي الخسارة'::VARCHAR(200)
        END,
        CASE 
            WHEN COALESCE(SUM(CASE WHEN classification = 'income' THEN net_amount ELSE -net_amount END), 0) >= 0 
            THEN 'Net Profit'::VARCHAR(200)
            ELSE 'Net Loss'::VARCHAR(200)
        END,
        COALESCE(SUM(CASE WHEN classification = 'income' THEN net_amount ELSE -net_amount END), 0),
        true
    FROM income_data
    
    ORDER BY 
        CASE category 
            WHEN 'revenue' THEN 1 
            WHEN 'revenue_total' THEN 2
            WHEN 'expenses' THEN 3 
            WHEN 'expenses_total' THEN 4
            WHEN 'net_income' THEN 5
        END,
        account_code;
END;
$$;

COMMENT ON FUNCTION get_income_statement(UUID, DATE, DATE) IS 'قائمة الدخل - الإيرادات والمصروفات وصافي الربح/الخسارة';

-- ═══════════════════════════════════════════════════════════════
-- 3. الميزانية العمومية (Balance Sheet)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_balance_sheet(
    p_company_id UUID,
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    category VARCHAR(50),
    category_ar VARCHAR(100),
    account_id UUID,
    account_code VARCHAR(50),
    account_name_ar VARCHAR(200),
    account_name_en VARCHAR(200),
    balance DECIMAL(15,2),
    is_subtotal BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH balance_data AS (
        SELECT 
            coa.id as account_id,
            coa.account_code,
            coa.name_ar as account_name_ar,
            coa.name_en as account_name_en,
            at.classification,
            at.normal_balance,
            coa.opening_balance,
            COALESCE(SUM(jel.debit), 0) as total_debit,
            COALESCE(SUM(jel.credit), 0) as total_credit
        FROM chart_of_accounts coa
        JOIN account_types at ON coa.account_type_id = at.id
        LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
        LEFT JOIN journal_entries je ON jel.entry_id = je.id 
            AND je.is_posted = true
            AND je.entry_date <= p_as_of_date
        WHERE coa.company_id = p_company_id
          AND coa.is_active = true
          AND coa.is_detail = true
          AND at.classification IN ('assets', 'liabilities', 'equity')
        GROUP BY coa.id, coa.account_code, coa.name_ar, coa.name_en, at.classification, at.normal_balance, coa.opening_balance
    ),
    calculated_balances AS (
        SELECT 
            bd.*,
            CASE 
                WHEN bd.normal_balance = 'debit' THEN 
                    COALESCE(bd.opening_balance, 0) + bd.total_debit - bd.total_credit
                ELSE 
                    COALESCE(bd.opening_balance, 0) + bd.total_credit - bd.total_debit
            END as balance
        FROM balance_data bd
    )
    -- الأصول
    SELECT 
        'assets'::VARCHAR(50) as category,
        'الأصول'::VARCHAR(100) as category_ar,
        cb.account_id,
        cb.account_code,
        cb.account_name_ar,
        cb.account_name_en,
        cb.balance,
        false as is_subtotal
    FROM calculated_balances cb
    WHERE cb.classification = 'assets' AND cb.balance != 0
    
    UNION ALL
    
    -- إجمالي الأصول
    SELECT 
        'assets_total'::VARCHAR(50),
        'إجمالي الأصول'::VARCHAR(100),
        NULL::UUID,
        ''::VARCHAR(50),
        'إجمالي الأصول'::VARCHAR(200),
        'Total Assets'::VARCHAR(200),
        COALESCE(SUM(balance), 0),
        true
    FROM calculated_balances
    WHERE classification = 'assets'
    
    UNION ALL
    
    -- الخصوم
    SELECT 
        'liabilities'::VARCHAR(50),
        'الخصوم'::VARCHAR(100),
        cb.account_id,
        cb.account_code,
        cb.account_name_ar,
        cb.account_name_en,
        cb.balance,
        false
    FROM calculated_balances cb
    WHERE cb.classification = 'liabilities' AND cb.balance != 0
    
    UNION ALL
    
    -- إجمالي الخصوم
    SELECT 
        'liabilities_total'::VARCHAR(50),
        'إجمالي الخصوم'::VARCHAR(100),
        NULL::UUID,
        ''::VARCHAR(50),
        'إجمالي الخصوم'::VARCHAR(200),
        'Total Liabilities'::VARCHAR(200),
        COALESCE(SUM(balance), 0),
        true
    FROM calculated_balances
    WHERE classification = 'liabilities'
    
    UNION ALL
    
    -- حقوق الملكية
    SELECT 
        'equity'::VARCHAR(50),
        'حقوق الملكية'::VARCHAR(100),
        cb.account_id,
        cb.account_code,
        cb.account_name_ar,
        cb.account_name_en,
        cb.balance,
        false
    FROM calculated_balances cb
    WHERE cb.classification = 'equity' AND cb.balance != 0
    
    UNION ALL
    
    -- إجمالي حقوق الملكية
    SELECT 
        'equity_total'::VARCHAR(50),
        'إجمالي حقوق الملكية'::VARCHAR(100),
        NULL::UUID,
        ''::VARCHAR(50),
        'إجمالي حقوق الملكية'::VARCHAR(200),
        'Total Equity'::VARCHAR(200),
        COALESCE(SUM(balance), 0),
        true
    FROM calculated_balances
    WHERE classification = 'equity'
    
    UNION ALL
    
    -- إجمالي الخصوم وحقوق الملكية
    SELECT 
        'liabilities_equity_total'::VARCHAR(50),
        'إجمالي الخصوم وحقوق الملكية'::VARCHAR(100),
        NULL::UUID,
        ''::VARCHAR(50),
        'إجمالي الخصوم وحقوق الملكية'::VARCHAR(200),
        'Total Liabilities & Equity'::VARCHAR(200),
        COALESCE(SUM(balance), 0),
        true
    FROM calculated_balances
    WHERE classification IN ('liabilities', 'equity')
    
    ORDER BY 
        CASE category 
            WHEN 'assets' THEN 1 
            WHEN 'assets_total' THEN 2
            WHEN 'liabilities' THEN 3 
            WHEN 'liabilities_total' THEN 4
            WHEN 'equity' THEN 5
            WHEN 'equity_total' THEN 6
            WHEN 'liabilities_equity_total' THEN 7
        END,
        account_code;
END;
$$;

COMMENT ON FUNCTION get_balance_sheet(UUID, DATE) IS 'الميزانية العمومية - الأصول والخصوم وحقوق الملكية';

-- ═══════════════════════════════════════════════════════════════
-- 4. كشف حساب العميل/المورد (Account Statement)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_account_statement(
    p_account_id UUID,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
    entry_date DATE,
    entry_number VARCHAR(50),
    reference_type VARCHAR(50),
    reference_number VARCHAR(100),
    description TEXT,
    debit DECIMAL(15,2),
    credit DECIMAL(15,2),
    balance DECIMAL(15,2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_date DATE;
    v_to_date DATE;
    v_opening_balance DECIMAL(15,2);
    v_normal_balance VARCHAR(10);
BEGIN
    -- تحديد التواريخ
    v_from_date := COALESCE(p_from_date, DATE_TRUNC('year', CURRENT_DATE)::DATE);
    v_to_date := COALESCE(p_to_date, CURRENT_DATE);
    
    -- الحصول على الطبيعة الطبيعية للحساب
    SELECT at.normal_balance INTO v_normal_balance
    FROM chart_of_accounts coa
    JOIN account_types at ON coa.account_type_id = at.id
    WHERE coa.id = p_account_id;
    
    -- حساب الرصيد الافتتاحي
    SELECT 
        COALESCE(coa.opening_balance, 0) +
        CASE 
            WHEN v_normal_balance = 'debit' THEN 
                COALESCE(SUM(jel.debit - jel.credit), 0)
            ELSE 
                COALESCE(SUM(jel.credit - jel.debit), 0)
        END
    INTO v_opening_balance
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
    LEFT JOIN journal_entries je ON jel.entry_id = je.id 
        AND je.is_posted = true
        AND je.entry_date < v_from_date
    WHERE coa.id = p_account_id
    GROUP BY coa.id, coa.opening_balance;
    
    v_opening_balance := COALESCE(v_opening_balance, 0);
    
    RETURN QUERY
    WITH movements AS (
        SELECT 
            je.entry_date,
            je.entry_number,
            je.reference_type,
            je.reference_number,
            COALESCE(jel.description, je.description) as description,
            jel.debit,
            jel.credit,
            ROW_NUMBER() OVER (ORDER BY je.entry_date, je.created_at) as rn
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id
        WHERE jel.account_id = p_account_id
          AND je.is_posted = true
          AND je.entry_date BETWEEN v_from_date AND v_to_date
    )
    -- الرصيد الافتتاحي
    SELECT 
        v_from_date as entry_date,
        'OPENING'::VARCHAR(50) as entry_number,
        'opening_balance'::VARCHAR(50) as reference_type,
        ''::VARCHAR(100) as reference_number,
        'رصيد افتتاحي'::TEXT as description,
        CASE WHEN v_opening_balance > 0 AND v_normal_balance = 'debit' THEN v_opening_balance ELSE 0::DECIMAL(15,2) END as debit,
        CASE WHEN v_opening_balance > 0 AND v_normal_balance = 'credit' THEN v_opening_balance ELSE 0::DECIMAL(15,2) END as credit,
        v_opening_balance as balance
    
    UNION ALL
    
    -- الحركات
    SELECT 
        m.entry_date,
        m.entry_number,
        m.reference_type,
        m.reference_number,
        m.description,
        m.debit,
        m.credit,
        v_opening_balance + SUM(
            CASE WHEN v_normal_balance = 'debit' THEN m.debit - m.credit ELSE m.credit - m.debit END
        ) OVER (ORDER BY m.rn) as balance
    FROM movements m
    
    ORDER BY entry_date, entry_number;
END;
$$;

COMMENT ON FUNCTION get_account_statement(UUID, DATE, DATE) IS 'كشف حساب تفصيلي مع الرصيد الجاري';

-- ═══════════════════════════════════════════════════════════════
-- 5. تقرير أعمار الديون (Aging Report)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_aging_report(
    p_company_id UUID,
    p_party_type VARCHAR DEFAULT 'customer',  -- 'customer' or 'supplier'
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    party_id UUID,
    party_code VARCHAR(50),
    party_name VARCHAR(200),
    current_balance DECIMAL(15,2),      -- 0-30 يوم
    days_31_60 DECIMAL(15,2),           -- 31-60 يوم
    days_61_90 DECIMAL(15,2),           -- 61-90 يوم
    days_91_120 DECIMAL(15,2),          -- 91-120 يوم
    over_120_days DECIMAL(15,2),        -- أكثر من 120 يوم
    total_balance DECIMAL(15,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_party_type = 'customer' THEN
        RETURN QUERY
        SELECT 
            c.id as party_id,
            c.code as party_code,
            c.name_ar as party_name,
            COALESCE(SUM(CASE WHEN p_as_of_date - si.invoice_date <= 30 THEN si.balance_due ELSE 0 END), 0) as current_balance,
            COALESCE(SUM(CASE WHEN p_as_of_date - si.invoice_date BETWEEN 31 AND 60 THEN si.balance_due ELSE 0 END), 0) as days_31_60,
            COALESCE(SUM(CASE WHEN p_as_of_date - si.invoice_date BETWEEN 61 AND 90 THEN si.balance_due ELSE 0 END), 0) as days_61_90,
            COALESCE(SUM(CASE WHEN p_as_of_date - si.invoice_date BETWEEN 91 AND 120 THEN si.balance_due ELSE 0 END), 0) as days_91_120,
            COALESCE(SUM(CASE WHEN p_as_of_date - si.invoice_date > 120 THEN si.balance_due ELSE 0 END), 0) as over_120_days,
            COALESCE(SUM(si.balance_due), 0) as total_balance
        FROM customers c
        LEFT JOIN sales_invoices si ON c.id = si.customer_id 
            AND si.company_id = p_company_id
            AND si.status = 'posted'
            AND si.balance_due > 0
            AND si.invoice_date <= p_as_of_date
        WHERE c.company_id = p_company_id
          AND c.status = 'active'
        GROUP BY c.id, c.code, c.name_ar
        HAVING COALESCE(SUM(si.balance_due), 0) > 0
        ORDER BY total_balance DESC;
    ELSE
        RETURN QUERY
        SELECT 
            s.id as party_id,
            s.code as party_code,
            s.name_ar as party_name,
            COALESCE(SUM(CASE WHEN p_as_of_date - pi.invoice_date <= 30 THEN pi.balance_due ELSE 0 END), 0) as current_balance,
            COALESCE(SUM(CASE WHEN p_as_of_date - pi.invoice_date BETWEEN 31 AND 60 THEN pi.balance_due ELSE 0 END), 0) as days_31_60,
            COALESCE(SUM(CASE WHEN p_as_of_date - pi.invoice_date BETWEEN 61 AND 90 THEN pi.balance_due ELSE 0 END), 0) as days_61_90,
            COALESCE(SUM(CASE WHEN p_as_of_date - pi.invoice_date BETWEEN 91 AND 120 THEN pi.balance_due ELSE 0 END), 0) as days_91_120,
            COALESCE(SUM(CASE WHEN p_as_of_date - pi.invoice_date > 120 THEN pi.balance_due ELSE 0 END), 0) as over_120_days,
            COALESCE(SUM(pi.balance_due), 0) as total_balance
        FROM suppliers s
        LEFT JOIN purchase_invoices pi ON s.id = pi.supplier_id 
            AND pi.company_id = p_company_id
            AND pi.status = 'posted'
            AND pi.balance_due > 0
            AND pi.invoice_date <= p_as_of_date
        WHERE s.company_id = p_company_id
          AND s.status = 'active'
        GROUP BY s.id, s.code, s.name_ar
        HAVING COALESCE(SUM(pi.balance_due), 0) > 0
        ORDER BY total_balance DESC;
    END IF;
END;
$$;

COMMENT ON FUNCTION get_aging_report(UUID, VARCHAR, DATE) IS 'تقرير أعمار الديون - تصنيف المستحقات حسب العمر (0-30، 31-60، 61-90، 91-120، +120 يوم)';

-- ═══════════════════════════════════════════════════════════════
-- 6. دالة مساعدة: ملخص الحساب
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_account_summary(
    p_account_id UUID,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
    account_code VARCHAR(50),
    account_name_ar VARCHAR(200),
    opening_balance DECIMAL(15,2),
    total_debit DECIMAL(15,2),
    total_credit DECIMAL(15,2),
    closing_balance DECIMAL(15,2),
    transactions_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_date DATE;
    v_to_date DATE;
BEGIN
    v_from_date := COALESCE(p_from_date, DATE_TRUNC('year', CURRENT_DATE)::DATE);
    v_to_date := COALESCE(p_to_date, CURRENT_DATE);
    
    RETURN QUERY
    SELECT 
        coa.account_code,
        coa.name_ar as account_name_ar,
        COALESCE(coa.opening_balance, 0) + COALESCE(SUM(
            CASE WHEN je.entry_date < v_from_date THEN 
                CASE WHEN at.normal_balance = 'debit' THEN jel.debit - jel.credit ELSE jel.credit - jel.debit END
            ELSE 0 END
        ), 0) as opening_balance,
        COALESCE(SUM(CASE WHEN je.entry_date BETWEEN v_from_date AND v_to_date THEN jel.debit ELSE 0 END), 0) as total_debit,
        COALESCE(SUM(CASE WHEN je.entry_date BETWEEN v_from_date AND v_to_date THEN jel.credit ELSE 0 END), 0) as total_credit,
        COALESCE(coa.opening_balance, 0) + COALESCE(SUM(
            CASE WHEN at.normal_balance = 'debit' THEN jel.debit - jel.credit ELSE jel.credit - jel.debit END
        ), 0) as closing_balance,
        COUNT(DISTINCT CASE WHEN je.entry_date BETWEEN v_from_date AND v_to_date THEN je.id END)::INT as transactions_count
    FROM chart_of_accounts coa
    JOIN account_types at ON coa.account_type_id = at.id
    LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
    LEFT JOIN journal_entries je ON jel.entry_id = je.id 
        AND je.is_posted = true
        AND je.entry_date <= v_to_date
    WHERE coa.id = p_account_id
    GROUP BY coa.id, coa.account_code, coa.name_ar, coa.opening_balance, at.normal_balance;
END;
$$;

COMMENT ON FUNCTION get_account_summary(UUID, DATE, DATE) IS 'ملخص حساب - الرصيد الافتتاحي والحركات والرصيد الختامي';

-- ═══════════════════════════════════════════════════════════════
-- نهاية المرحلة 3: التقارير المالية
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'تم إنشاء المرحلة 3: التقارير المالية بنجاح';
    RAISE NOTICE '- get_trial_balance: ميزان المراجعة';
    RAISE NOTICE '- get_income_statement: قائمة الدخل';
    RAISE NOTICE '- get_balance_sheet: الميزانية العمومية';
    RAISE NOTICE '- get_account_statement: كشف حساب';
    RAISE NOTICE '- get_aging_report: تقرير أعمار الديون';
    RAISE NOTICE '- get_account_summary: ملخص حساب';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
