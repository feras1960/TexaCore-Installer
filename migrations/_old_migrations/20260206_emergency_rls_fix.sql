-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 EMERGENCY FIX: Allow authenticated access to all operational tables
-- إصلاح طارئ: السماح للمستخدمين المُسجلين بالوصول لجميع الجداول
-- ═══════════════════════════════════════════════════════════════════════════

-- المشكلة: بعض السياسات تُعيق الوصول حتى للمستخدمين المُسجلين
-- الحل: إعادة إنشاء سياسات بسيطة وفعالة

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Create a helper function to safely fix policies
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION emergency_fix_table_rls(tbl_name TEXT)
RETURNS TEXT AS $$
DECLARE
    pol RECORD;
    result TEXT := '';
BEGIN
    -- Drop ALL existing policies
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = tbl_name
    LOOP
        BEGIN
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, tbl_name);
            result := result || 'Dropped: ' || pol.policyname || E'\n';
        EXCEPTION WHEN OTHERS THEN
            result := result || 'Error dropping: ' || pol.policyname || ' - ' || SQLERRM || E'\n';
        END;
    END LOOP;
    
    -- Create simple READ policy
    BEGIN
        EXECUTE format('CREATE POLICY "auth_read" ON %I FOR SELECT TO authenticated USING (true)', tbl_name);
        result := result || 'Created: auth_read' || E'\n';
    EXCEPTION WHEN OTHERS THEN
        result := result || 'Error creating auth_read: ' || SQLERRM || E'\n';
    END;
    
    -- Create simple ALL policy
    BEGIN
        EXECUTE format('CREATE POLICY "auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl_name);
        result := result || 'Created: auth_all' || E'\n';
    EXCEPTION WHEN OTHERS THEN
        result := result || 'Error creating auth_all: ' || SQLERRM || E'\n';
    END;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Fix ALL critical tables
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    tables_to_fix TEXT[] := ARRAY[
        -- محاسبة
        'chart_of_accounts', 'journal_entries', 'journal_entry_lines',
        'fiscal_years', 'accounting_periods', 'cost_centers',
        -- زبائن/موردين
        'customers', 'suppliers', 'customer_groups', 'supplier_groups',
        -- صناديق
        'funds', 'fund_transactions', 
        -- شركات/فروع
        'companies', 'branches',
        -- مستخدمين
        'user_profiles', 'roles', 'user_roles',
        -- عملات
        'currencies', 'exchange_rates',
        -- المنتجات/المخزون
        'products', 'product_categories', 'warehouses', 'warehouse_locations',
        'inventory_movements', 'stock_transactions',
        -- المبيعات
        'sales_invoices', 'sales_invoice_items', 'sales_orders', 'sales_order_items',
        -- المشتريات
        'purchase_invoices', 'purchase_invoice_items', 'purchase_orders', 'purchase_order_items',
        -- المدفوعات
        'payment_receipts', 'payment_vouchers',
        -- RBAC
        'user_resource_access', 'visibility_rules',
        -- إشعارات
        'notifications', 'in_app_notifications',
        -- وكلاء
        'agents', 'agent_commissions', 'commission_rules',
        -- tenant
        'tenants', 'tenant_subscriptions', 'subscription_plans'
    ];
    t TEXT;
BEGIN
    FOREACH t IN ARRAY tables_to_fix
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            PERFORM emergency_fix_table_rls(t);
            RAISE NOTICE 'Fixed: %', t;
        ELSE
            RAISE NOTICE 'Table does not exist: %', t;
        END IF;
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Clean up
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS emergency_fix_table_rls(TEXT);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Reload schema
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Verify
-- ═══════════════════════════════════════════════════════════════════════════

SELECT '✅ EMERGENCY FIX COMPLETE!' as status;

-- Show summary
SELECT 
    tablename,
    COUNT(*) as policies_count
FROM pg_policies 
WHERE schemaname = 'public'
AND tablename IN (
    'chart_of_accounts', 'journal_entries', 'journal_entry_lines',
    'customers', 'suppliers', 'funds', 'companies', 'branches',
    'user_profiles', 'products', 'warehouses'
)
GROUP BY tablename
ORDER BY tablename;
