-- ═══════════════════════════════════════════════════════════════════════════
-- 🔐 FIX: Proper Company Isolation with Tenant Owner Access
-- إصلاح عزل الشركات مع السماح لمالك الـ Tenant برؤية كل الشركات
-- ═══════════════════════════════════════════════════════════════════════════
-- Date: 2026-02-05
-- 
-- Logic:
--   - Tenant Owner (صاحب الاشتراك): يرى كل الشركات داخل الـ Tenant
--   - Regular Users: يرون فقط الشركة المُعينة لهم
--   - Super Admin: يرى كل شيء
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Create helper function to check if user is Tenant Owner
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_tenant_owner(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_user_email TEXT;
    v_tenant_id UUID;
    v_owner_email TEXT;
BEGIN
    -- Super Admin يرى كل شيء
    IF is_super_admin(p_user_id) THEN
        RETURN true;
    END IF;
    
    -- Get user's email and tenant_id
    SELECT up.email, c.tenant_id INTO v_user_email, v_tenant_id
    FROM user_profiles up
    LEFT JOIN companies c ON up.company_id = c.id
    WHERE up.id = p_user_id;
    
    IF v_tenant_id IS NULL THEN
        RETURN false;
    END IF;
    
    -- Check if user is the tenant owner
    SELECT owner_email INTO v_owner_email
    FROM tenants
    WHERE id = v_tenant_id;
    
    RETURN v_user_email = v_owner_email;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Create function to check if user can access company data
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION can_access_company(p_company_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_user_company_id UUID;
    v_user_tenant_id UUID;
    v_company_tenant_id UUID;
BEGIN
    -- Super Admin يرى كل شيء
    IF is_super_admin(p_user_id) THEN
        RETURN true;
    END IF;
    
    -- Get user's company and tenant
    SELECT up.company_id, c.tenant_id INTO v_user_company_id, v_user_tenant_id
    FROM user_profiles up
    LEFT JOIN companies c ON up.company_id = c.id
    WHERE up.id = p_user_id;
    
    -- Get company's tenant
    SELECT tenant_id INTO v_company_tenant_id
    FROM companies
    WHERE id = p_company_id;
    
    -- Tenant Owner: يرى كل شركات الـ Tenant
    IF is_tenant_owner(p_user_id) THEN
        RETURN v_user_tenant_id = v_company_tenant_id;
    END IF;
    
    -- Regular User: يرى شركته فقط
    RETURN v_user_company_id = p_company_id;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Fix the critical tables with proper isolation
-- ═══════════════════════════════════════════════════════════════════════════

-- جداول الهيكل الأساسية: تستخدم tenant_id للعزل
-- operational tables: تستخدم company_id مع التحقق من صلاحية الوصول

-- 3.1 Fix journal_entries
DROP POLICY IF EXISTS journal_entries_select ON journal_entries;
DROP POLICY IF EXISTS journal_entries_insert ON journal_entries;
DROP POLICY IF EXISTS journal_entries_update ON journal_entries;
DROP POLICY IF EXISTS journal_entries_delete ON journal_entries;

CREATE POLICY "journal_entries_select" ON journal_entries
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "journal_entries_insert" ON journal_entries
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "journal_entries_update" ON journal_entries
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "journal_entries_delete" ON journal_entries
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.2 Fix customers
DROP POLICY IF EXISTS customers_select ON customers;
DROP POLICY IF EXISTS customers_insert ON customers;
DROP POLICY IF EXISTS customers_update ON customers;
DROP POLICY IF EXISTS customers_delete ON customers;

CREATE POLICY "customers_select" ON customers
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "customers_insert" ON customers
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "customers_update" ON customers
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "customers_delete" ON customers
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.3 Fix chart_of_accounts
DROP POLICY IF EXISTS chart_of_accounts_select ON chart_of_accounts;
DROP POLICY IF EXISTS chart_of_accounts_insert ON chart_of_accounts;
DROP POLICY IF EXISTS chart_of_accounts_update ON chart_of_accounts;
DROP POLICY IF EXISTS chart_of_accounts_delete ON chart_of_accounts;

CREATE POLICY "chart_of_accounts_select" ON chart_of_accounts
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "chart_of_accounts_insert" ON chart_of_accounts
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "chart_of_accounts_update" ON chart_of_accounts
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "chart_of_accounts_delete" ON chart_of_accounts
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.4 Fix products
DROP POLICY IF EXISTS products_select ON products;
DROP POLICY IF EXISTS products_insert ON products;
DROP POLICY IF EXISTS products_update ON products;
DROP POLICY IF EXISTS products_delete ON products;

CREATE POLICY "products_select" ON products
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "products_insert" ON products
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "products_update" ON products
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "products_delete" ON products
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.5 Fix suppliers
DROP POLICY IF EXISTS suppliers_select ON suppliers;
DROP POLICY IF EXISTS suppliers_insert ON suppliers;
DROP POLICY IF EXISTS suppliers_update ON suppliers;
DROP POLICY IF EXISTS suppliers_delete ON suppliers;

CREATE POLICY "suppliers_select" ON suppliers
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "suppliers_insert" ON suppliers
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "suppliers_update" ON suppliers
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "suppliers_delete" ON suppliers
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.6 Fix warehouses
DROP POLICY IF EXISTS warehouses_select ON warehouses;
DROP POLICY IF EXISTS warehouses_insert ON warehouses;
DROP POLICY IF EXISTS warehouses_update ON warehouses;
DROP POLICY IF EXISTS warehouses_delete ON warehouses;

CREATE POLICY "warehouses_select" ON warehouses
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "warehouses_insert" ON warehouses
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "warehouses_update" ON warehouses
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "warehouses_delete" ON warehouses
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.7 Fix sales_invoices
DROP POLICY IF EXISTS sales_invoices_select ON sales_invoices;
DROP POLICY IF EXISTS sales_invoices_insert ON sales_invoices;
DROP POLICY IF EXISTS sales_invoices_update ON sales_invoices;
DROP POLICY IF EXISTS sales_invoices_delete ON sales_invoices;

CREATE POLICY "sales_invoices_select" ON sales_invoices
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "sales_invoices_insert" ON sales_invoices
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "sales_invoices_update" ON sales_invoices
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "sales_invoices_delete" ON sales_invoices
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.8 Fix purchase_invoices
DROP POLICY IF EXISTS purchase_invoices_select ON purchase_invoices;
DROP POLICY IF EXISTS purchase_invoices_insert ON purchase_invoices;
DROP POLICY IF EXISTS purchase_invoices_update ON purchase_invoices;
DROP POLICY IF EXISTS purchase_invoices_delete ON purchase_invoices;

CREATE POLICY "purchase_invoices_select" ON purchase_invoices
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "purchase_invoices_insert" ON purchase_invoices
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "purchase_invoices_update" ON purchase_invoices
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "purchase_invoices_delete" ON purchase_invoices
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.9 Fix fiscal_years
DROP POLICY IF EXISTS fiscal_years_select ON fiscal_years;
DROP POLICY IF EXISTS fiscal_years_insert ON fiscal_years;
DROP POLICY IF EXISTS fiscal_years_update ON fiscal_years;
DROP POLICY IF EXISTS fiscal_years_delete ON fiscal_years;

CREATE POLICY "fiscal_years_select" ON fiscal_years
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "fiscal_years_insert" ON fiscal_years
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "fiscal_years_update" ON fiscal_years
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "fiscal_years_delete" ON fiscal_years
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- 3.10 Fix funds
DROP POLICY IF EXISTS cash_accounts_select ON cash_accounts;
DROP POLICY IF EXISTS cash_accounts_insert ON cash_accounts;
DROP POLICY IF EXISTS cash_accounts_update ON cash_accounts;
DROP POLICY IF EXISTS cash_accounts_delete ON cash_accounts;

CREATE POLICY "cash_accounts_select" ON cash_accounts
    FOR SELECT TO authenticated
    USING (can_access_company(company_id));

CREATE POLICY "cash_accounts_insert" ON cash_accounts
    FOR INSERT TO authenticated
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "cash_accounts_update" ON cash_accounts
    FOR UPDATE TO authenticated
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

CREATE POLICY "cash_accounts_delete" ON cash_accounts
    FOR DELETE TO authenticated
    USING (can_access_company(company_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Fix companies table - users see their own tenant's companies
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS companies_select ON companies;
DROP POLICY IF EXISTS companies_insert ON companies;
DROP POLICY IF EXISTS companies_update ON companies;
DROP POLICY IF EXISTS companies_delete ON companies;

CREATE POLICY "companies_select" ON companies
    FOR SELECT TO authenticated
    USING (
        is_super_admin() 
        OR tenant_id = get_current_tenant_id()
    );

CREATE POLICY "companies_insert" ON companies
    FOR INSERT TO authenticated
    WITH CHECK (
        is_super_admin() 
        OR (is_tenant_owner() AND tenant_id = get_current_tenant_id())
    );

CREATE POLICY "companies_update" ON companies
    FOR UPDATE TO authenticated
    USING (
        is_super_admin() 
        OR (is_tenant_owner() AND tenant_id = get_current_tenant_id())
    );

CREATE POLICY "companies_delete" ON companies
    FOR DELETE TO authenticated
    USING (
        is_super_admin() 
        OR (is_tenant_owner() AND tenant_id = get_current_tenant_id())
    );

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Fix user_profiles - users in same tenant can see each other
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS user_profiles_select ON user_profiles;
DROP POLICY IF EXISTS user_profiles_insert ON user_profiles;
DROP POLICY IF EXISTS user_profiles_update ON user_profiles;
DROP POLICY IF EXISTS user_profiles_delete ON user_profiles;

CREATE POLICY "user_profiles_select" ON user_profiles
    FOR SELECT TO authenticated
    USING (
        is_super_admin()
        OR company_id IN (SELECT id FROM companies WHERE tenant_id = get_current_tenant_id())
        OR id = auth.uid()
    );

CREATE POLICY "user_profiles_insert" ON user_profiles
    FOR INSERT TO authenticated
    WITH CHECK (
        is_super_admin()
        OR (is_tenant_owner() AND company_id IN (SELECT id FROM companies WHERE tenant_id = get_current_tenant_id()))
        OR id = auth.uid()
    );

CREATE POLICY "user_profiles_update" ON user_profiles
    FOR UPDATE TO authenticated
    USING (
        is_super_admin()
        OR id = auth.uid()
        OR (is_tenant_owner() AND company_id IN (SELECT id FROM companies WHERE tenant_id = get_current_tenant_id()))
    );

CREATE POLICY "user_profiles_delete" ON user_profiles
    FOR DELETE TO authenticated
    USING (
        is_super_admin()
        OR (is_tenant_owner() AND company_id IN (SELECT id FROM companies WHERE tenant_id = get_current_tenant_id()))
    );

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6: Reload schema cache
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

SELECT '✅ Company isolation with Tenant Owner access has been applied!' as status;
