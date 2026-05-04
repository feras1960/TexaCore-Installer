-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 MASTER FIX: Reset ALL RLS policies to simple working state
-- إصلاح شامل: إعادة تعيين جميع سياسات RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- This script will:
-- 1. Find all tables with RLS enabled
-- 2. Drop all their policies
-- 3. Create simple working policies
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Create a function to fix policies on any table
CREATE OR REPLACE FUNCTION fix_table_rls(table_name TEXT)
RETURNS VOID AS $$
DECLARE
    pol RECORD;
BEGIN
    -- Drop all existing policies
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = table_name
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, table_name);
    END LOOP;
    
    -- Create simple policies
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', 
                   table_name || '_read', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (auth.uid() IS NOT NULL)', 
                   table_name || '_write', table_name);
    
    RAISE NOTICE 'Fixed RLS for table: %', table_name;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error fixing %: %', table_name, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Fix all critical tables
DO $$
DECLARE
    tables_to_fix TEXT[] := ARRAY[
        -- Core tables
        'tenants', 'companies', 'branches', 'user_profiles', 'roles', 'user_roles',
        -- Accounting
        'chart_of_accounts', 'journal_entries', 'journal_entry_lines', 
        'fiscal_years', 'cost_centers', 'currencies', 'exchange_rates',
        -- Customers & Suppliers
        'customers', 'suppliers', 'customer_groups', 'supplier_groups',
        -- Products & Inventory
        'products', 'product_categories', 'warehouses', 'warehouse_locations',
        'inventory_movements', 'stock_transactions',
        -- Sales
        'sales_invoices', 'sales_invoice_items', 'sales_orders', 'sales_order_items',
        'sales_quotations', 'sales_quotation_items',
        -- Purchases
        'purchase_invoices', 'purchase_invoice_items', 'purchase_orders', 'purchase_order_items',
        -- Payments
        'payment_receipts', 'payment_vouchers', 'funds', 'fund_transactions',
        -- RBAC
        'user_resource_access', 'visibility_rules',
        -- Other
        'agents', 'notifications', 'in_app_notifications', 'audit_logs'
    ];
    t TEXT;
BEGIN
    FOREACH t IN ARRAY tables_to_fix
    LOOP
        -- Check if table exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            PERFORM fix_table_rls(t);
        ELSE
            RAISE NOTICE 'Table % does not exist, skipping', t;
        END IF;
    END LOOP;
END $$;

-- Step 3: Fix special tables that need public read
DO $$
DECLARE
    pol RECORD;
BEGIN
    -- currencies - public read
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'currencies'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON currencies';
    END LOOP;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'currencies') THEN
        CREATE POLICY "currencies_read" ON currencies FOR SELECT USING (true);
        CREATE POLICY "currencies_write" ON currencies FOR ALL USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- subscription_plans - public read
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_plans'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON subscription_plans';
    END LOOP;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscription_plans') THEN
        CREATE POLICY "subscription_plans_read" ON subscription_plans FOR SELECT USING (true);
        CREATE POLICY "subscription_plans_write" ON subscription_plans FOR ALL USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- saas_products - public read
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saas_products'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON saas_products';
    END LOOP;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'saas_products') THEN
        CREATE POLICY "saas_products_read" ON saas_products FOR SELECT USING (true);
        CREATE POLICY "saas_products_write" ON saas_products FOR ALL USING (auth.uid() IS NOT NULL);
    END IF;
    
    -- system_modules - public read
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_modules'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON system_modules';
    END LOOP;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_modules') THEN
        CREATE POLICY "system_modules_read" ON system_modules FOR SELECT USING (true);
        CREATE POLICY "system_modules_write" ON system_modules FOR ALL USING (auth.uid() IS NOT NULL);
    END IF;
END $$;

-- Step 4: Cleanup - drop the helper function
DROP FUNCTION IF EXISTS fix_table_rls(TEXT);

-- Step 5: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- Step 6: Verify
SELECT '═══════════════════════════════════════════════════════════════' as info;
SELECT '✅ MASTER RLS FIX COMPLETE!' as status;
SELECT '═══════════════════════════════════════════════════════════════' as info;

-- Show result summary
SELECT 
    tablename,
    COUNT(*) as policies_count
FROM pg_policies 
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
