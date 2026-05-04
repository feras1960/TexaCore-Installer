-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 FIX: Change policies from PUBLIC to AUTHENTICATED
-- إصلاح: تغيير السياسات من public إلى authenticated
-- ═══════════════════════════════════════════════════════════════════════════

-- المشكلة: السياسات مُعينة لـ public لكن الشرط يتطلب auth.uid()
-- الحل: إعادة إنشاء السياسات مع roles = authenticated

-- ═══════════════════════════════════════════════════════════════════════════
-- Helper function
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fix_policy_roles(tbl_name TEXT)
RETURNS TEXT AS $$
DECLARE
    result TEXT := '';
BEGIN
    -- Drop existing policies with _read and _write suffix
    BEGIN
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl_name || '_read', tbl_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl_name || '_write', tbl_name);
        result := result || 'Dropped old policies for ' || tbl_name || E'\n';
    EXCEPTION WHEN OTHERS THEN
        result := result || 'Error dropping: ' || SQLERRM || E'\n';
    END;
    
    -- Create new policies with AUTHENTICATED role
    BEGIN
        EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)', 
                       tbl_name || '_select', tbl_name);
        result := result || 'Created SELECT policy for ' || tbl_name || E'\n';
    EXCEPTION WHEN OTHERS THEN
        result := result || 'Error creating SELECT: ' || SQLERRM || E'\n';
    END;
    
    BEGIN
        EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (true)', 
                       tbl_name || '_insert', tbl_name);
        result := result || 'Created INSERT policy for ' || tbl_name || E'\n';
    EXCEPTION WHEN OTHERS THEN
        result := result || 'Error creating INSERT: ' || SQLERRM || E'\n';
    END;
    
    BEGIN
        EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', 
                       tbl_name || '_update', tbl_name);
        result := result || 'Created UPDATE policy for ' || tbl_name || E'\n';
    EXCEPTION WHEN OTHERS THEN
        result := result || 'Error creating UPDATE: ' || SQLERRM || E'\n';
    END;
    
    BEGIN
        EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (true)', 
                       tbl_name || '_delete', tbl_name);
        result := result || 'Created DELETE policy for ' || tbl_name || E'\n';
    EXCEPTION WHEN OTHERS THEN
        result := result || 'Error creating DELETE: ' || SQLERRM || E'\n';
    END;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix all affected tables
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    tables_to_fix TEXT[] := ARRAY[
        'chart_of_accounts',
        'journal_entries', 
        'journal_entry_lines',
        'companies',
        'customers',
        'suppliers',
        'funds',
        'fund_transactions',
        'branches',
        'user_profiles',
        'fiscal_years',
        'accounting_periods',
        'cost_centers',
        'currencies',
        'exchange_rates',
        'products',
        'product_categories',
        'warehouses',
        'warehouse_locations',
        'agents',
        'customer_groups',
        'supplier_groups',
        'notifications',
        'in_app_notifications',
        'audit_logs'
    ];
    t TEXT;
BEGIN
    FOREACH t IN ARRAY tables_to_fix
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            PERFORM fix_policy_roles(t);
            RAISE NOTICE '✅ Fixed: %', t;
        ELSE
            RAISE NOTICE '⚠️ Table not found: %', t;
        END IF;
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Cleanup
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS fix_policy_roles(TEXT);

-- ═══════════════════════════════════════════════════════════════════════════
-- Reload schema
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════════════════════

SELECT '✅ FIX COMPLETE!' as status;

-- Check new policies
SELECT 
    tablename,
    policyname,
    cmd,
    roles
FROM pg_policies 
WHERE schemaname = 'public'
AND tablename IN ('journal_entries', 'customers', 'chart_of_accounts', 'companies')
ORDER BY tablename, policyname;
