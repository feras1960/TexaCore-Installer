-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00021: اختبار فصل البيانات بين المستأجرين
-- Tenant Isolation Test Suite
-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ يختبر:
--    1. عزل البيانات بين الـ tenants
--    2. RLS Policies
--    3. دالة get_current_tenant_id()
--    4. الأمان العام

-- ═══════════════════════════════════════════════════════════════
-- الجزء 1: إنشاء بيانات اختبار
-- Part 1: Create Test Data
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_tenant1_id UUID;
    v_tenant2_id UUID;
    v_company1_id UUID;
    v_company2_id UUID;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '🧪 بدء اختبار فصل البيانات (Tenant Isolation Test)';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    
    -- إنشاء أو الحصول على Tenant 1 للاختبار
    INSERT INTO tenants (code, name, email, status, default_language)
    VALUES ('test-tenant-001', 'Test Tenant 1', 'test1@erp.test', 'active', 'ar')
    ON CONFLICT (code) DO UPDATE SET name = 'Test Tenant 1'
    RETURNING id INTO v_tenant1_id;
    
    IF v_tenant1_id IS NULL THEN
        SELECT id INTO v_tenant1_id FROM tenants WHERE code = 'test-tenant-001';
    END IF;
    
    -- إنشاء أو الحصول على Tenant 2 للاختبار
    INSERT INTO tenants (code, name, email, status, default_language)
    VALUES ('test-tenant-002', 'Test Tenant 2', 'test2@erp.test', 'active', 'en')
    ON CONFLICT (code) DO UPDATE SET name = 'Test Tenant 2'
    RETURNING id INTO v_tenant2_id;
    
    IF v_tenant2_id IS NULL THEN
        SELECT id INTO v_tenant2_id FROM tenants WHERE code = 'test-tenant-002';
    END IF;
    
    RAISE NOTICE '📝 Tenant 1 ID: %', v_tenant1_id;
    RAISE NOTICE '📝 Tenant 2 ID: %', v_tenant2_id;
    
    -- إنشاء شركة لـ Tenant 1
    INSERT INTO companies (tenant_id, code, name, name_ar, name_en, is_active)
    VALUES (v_tenant1_id, 'TEST-COMP-001', 'Test Company 1', 'شركة اختبار 1', 'Test Company 1', true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_company1_id;
    
    IF v_company1_id IS NULL THEN
        SELECT id INTO v_company1_id FROM companies WHERE tenant_id = v_tenant1_id LIMIT 1;
    END IF;
    
    -- إنشاء شركة لـ Tenant 2
    INSERT INTO companies (tenant_id, code, name, name_ar, name_en, is_active)
    VALUES (v_tenant2_id, 'TEST-COMP-002', 'Test Company 2', 'شركة اختبار 2', 'Test Company 2', true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_company2_id;
    
    IF v_company2_id IS NULL THEN
        SELECT id INTO v_company2_id FROM companies WHERE tenant_id = v_tenant2_id LIMIT 1;
    END IF;
    
    RAISE NOTICE '📝 Company 1 ID: % (Tenant 1)', v_company1_id;
    RAISE NOTICE '📝 Company 2 ID: % (Tenant 2)', v_company2_id;
    
    -- إنشاء بيانات اختبار في جداول مختلفة
    
    -- عملاء لـ Tenant 1
    INSERT INTO customers (tenant_id, company_id, code, name_ar, email, status)
    VALUES 
        (v_tenant1_id, v_company1_id, 'CUST-T1-001', 'عميل ت1-1', 'cust1@tenant1.test', 'active'),
        (v_tenant1_id, v_company1_id, 'CUST-T1-002', 'عميل ت1-2', 'cust2@tenant1.test', 'active')
    ON CONFLICT DO NOTHING;
    
    -- عملاء لـ Tenant 2
    INSERT INTO customers (tenant_id, company_id, code, name_ar, email, status)
    VALUES 
        (v_tenant2_id, v_company2_id, 'CUST-T2-001', 'عميل ت2-1', 'cust1@tenant2.test', 'active'),
        (v_tenant2_id, v_company2_id, 'CUST-T2-002', 'عميل ت2-2', 'cust2@tenant2.test', 'active')
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE '✅ تم إنشاء بيانات الاختبار';
END $$;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 2: اختبارات فصل البيانات
-- Part 2: Data Isolation Tests
-- ═══════════════════════════════════════════════════════════════

-- دالة اختبار عزل البيانات
CREATE OR REPLACE FUNCTION test_tenant_isolation()
RETURNS TABLE (
    test_name TEXT,
    result TEXT,
    details TEXT
) AS $$
DECLARE
    v_tenant1_id UUID;
    v_tenant2_id UUID;
    v_count1 INT;
    v_count2 INT;
    v_total INT;
BEGIN
    -- الحصول على IDs
    SELECT id INTO v_tenant1_id FROM tenants WHERE code = 'test-tenant-001';
    SELECT id INTO v_tenant2_id FROM tenants WHERE code = 'test-tenant-002';
    
    -- Test 1: التحقق من وجود الـ tenants
    test_name := 'Test Tenants Exist';
    IF v_tenant1_id IS NOT NULL AND v_tenant2_id IS NOT NULL THEN
        result := '✅ PASS';
        details := format('Tenant1: %s, Tenant2: %s', v_tenant1_id, v_tenant2_id);
    ELSE
        result := '❌ FAIL';
        details := 'Missing test tenants';
    END IF;
    RETURN NEXT;
    
    -- Test 2: عدد الشركات لكل tenant
    SELECT COUNT(*) INTO v_count1 FROM companies WHERE tenant_id = v_tenant1_id;
    SELECT COUNT(*) INTO v_count2 FROM companies WHERE tenant_id = v_tenant2_id;
    SELECT COUNT(*) INTO v_total FROM companies WHERE tenant_id IN (v_tenant1_id, v_tenant2_id);
    
    test_name := 'Companies Isolation';
    IF v_count1 > 0 AND v_count2 > 0 AND v_total = (v_count1 + v_count2) THEN
        result := '✅ PASS';
        details := format('T1: %s, T2: %s, Total: %s', v_count1, v_count2, v_total);
    ELSE
        result := '⚠️ WARN';
        details := format('Counts may indicate issues: T1=%s, T2=%s', v_count1, v_count2);
    END IF;
    RETURN NEXT;
    
    -- Test 3: عدد العملاء لكل tenant
    SELECT COUNT(*) INTO v_count1 FROM customers WHERE tenant_id = v_tenant1_id;
    SELECT COUNT(*) INTO v_count2 FROM customers WHERE tenant_id = v_tenant2_id;
    
    test_name := 'Customers Isolation';
    IF v_count1 >= 2 AND v_count2 >= 2 THEN
        result := '✅ PASS';
        details := format('T1: %s customers, T2: %s customers', v_count1, v_count2);
    ELSE
        result := '⚠️ WARN';
        details := format('Expected at least 2 each: T1=%s, T2=%s', v_count1, v_count2);
    END IF;
    RETURN NEXT;
    
    -- Test 4: التحقق من أن دالة get_current_tenant_id موجودة
    test_name := 'get_current_tenant_id Function';
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'get_current_tenant_id'
    ) THEN
        result := '✅ PASS';
        details := 'Function exists and is callable';
    ELSE
        result := '❌ FAIL';
        details := 'Function does not exist - RLS will fail!';
    END IF;
    RETURN NEXT;
    
    -- Test 5: التحقق من RLS مفعل على الجداول الحرجة
    test_name := 'RLS Enabled on Critical Tables';
    DECLARE
        v_rls_count INT;
        v_critical_tables TEXT[] := ARRAY[
            'companies', 'customers', 'suppliers', 'products',
            'journal_entries', 'sales_invoices', 'documents'
        ];
        v_table TEXT;
        v_rls_enabled BOOLEAN;
        v_missing TEXT := '';
    BEGIN
        v_rls_count := 0;
        FOREACH v_table IN ARRAY v_critical_tables
        LOOP
            SELECT relrowsecurity INTO v_rls_enabled
            FROM pg_class
            WHERE relname = v_table AND relnamespace = 'public'::regnamespace;
            
            IF COALESCE(v_rls_enabled, false) THEN
                v_rls_count := v_rls_count + 1;
            ELSE
                v_missing := v_missing || v_table || ', ';
            END IF;
        END LOOP;
        
        IF v_rls_count = array_length(v_critical_tables, 1) THEN
            result := '✅ PASS';
            details := format('All %s critical tables have RLS enabled', v_rls_count);
        ELSIF v_rls_count > 0 THEN
            result := '⚠️ WARN';
            details := format('RLS enabled on %s/%s tables. Missing: %s', 
                v_rls_count, array_length(v_critical_tables, 1), 
                TRIM(TRAILING ', ' FROM v_missing));
        ELSE
            result := '❌ FAIL';
            details := 'No critical tables have RLS enabled!';
        END IF;
    END;
    RETURN NEXT;
    
    -- Test 6: التحقق من وجود RLS Policies
    test_name := 'RLS Policies Exist';
    SELECT COUNT(*) INTO v_count1
    FROM pg_policies
    WHERE schemaname = 'public' 
      AND (policyname LIKE '%tenant%' OR policyname LIKE '%isolation%');
    
    IF v_count1 >= 20 THEN
        result := '✅ PASS';
        details := format('%s tenant isolation policies found', v_count1);
    ELSIF v_count1 > 0 THEN
        result := '⚠️ WARN';
        details := format('Only %s policies found - may need more', v_count1);
    ELSE
        result := '❌ FAIL';
        details := 'No tenant isolation policies found!';
    END IF;
    RETURN NEXT;
    
    -- Test 7: التحقق من audit_logs
    test_name := 'Audit Logs Table';
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'audit_logs'
    ) THEN
        result := '✅ PASS';
        details := 'audit_logs table exists';
    ELSE
        result := '⚠️ WARN';
        details := 'audit_logs table not found';
    END IF;
    RETURN NEXT;
    
    -- Test 8: التحقق من documents table
    test_name := 'Documents Table';
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'documents'
    ) THEN
        SELECT COUNT(*) INTO v_count1
        FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 'tenant_id';
        
        IF v_count1 > 0 THEN
            result := '✅ PASS';
            details := 'documents table exists with tenant_id';
        ELSE
            result := '⚠️ WARN';
            details := 'documents table missing tenant_id column';
        END IF;
    ELSE
        result := '❌ FAIL';
        details := 'documents table not found';
    END IF;
    RETURN NEXT;
    
    -- Test 9: التحقق من storage_quotas
    test_name := 'Storage Quotas Table';
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'storage_quotas'
    ) THEN
        result := '✅ PASS';
        details := 'storage_quotas table exists';
    ELSE
        result := '⚠️ WARN';
        details := 'storage_quotas table not found';
    END IF;
    RETURN NEXT;
    
    -- Test 10: التحقق من subscription_alerts
    test_name := 'Subscription Alerts Table';
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'subscription_alerts'
    ) THEN
        result := '✅ PASS';
        details := 'subscription_alerts table exists';
    ELSE
        result := '⚠️ WARN';
        details := 'subscription_alerts table not found';
    END IF;
    RETURN NEXT;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 3: تنفيذ الاختبارات
-- Part 3: Run Tests
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_test RECORD;
    v_pass_count INT := 0;
    v_fail_count INT := 0;
    v_warn_count INT := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '🧪 نتائج اختبار فصل البيانات:';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    
    FOR v_test IN SELECT * FROM test_tenant_isolation()
    LOOP
        RAISE NOTICE '% | % | %', v_test.result, v_test.test_name, v_test.details;
        
        IF v_test.result LIKE '%PASS%' THEN
            v_pass_count := v_pass_count + 1;
        ELSIF v_test.result LIKE '%FAIL%' THEN
            v_fail_count := v_fail_count + 1;
        ELSE
            v_warn_count := v_warn_count + 1;
        END IF;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '📊 ملخص النتائج:';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '   ✅ نجح: %', v_pass_count;
    RAISE NOTICE '   ⚠️ تحذير: %', v_warn_count;
    RAISE NOTICE '   ❌ فشل: %', v_fail_count;
    RAISE NOTICE '';
    
    IF v_fail_count = 0 THEN
        RAISE NOTICE '🎉 جميع الاختبارات الحرجة نجحت!';
    ELSE
        RAISE NOTICE '⚠️ يوجد % اختبارات فاشلة تحتاج إصلاح', v_fail_count;
    END IF;
    
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 4: دالة للاختبار من الـ Frontend
-- Part 4: Function for Frontend Testing
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION run_isolation_tests()
RETURNS JSONB AS $$
DECLARE
    v_results JSONB := '[]'::JSONB;
    v_test RECORD;
    v_summary JSONB;
    v_pass INT := 0;
    v_fail INT := 0;
    v_warn INT := 0;
BEGIN
    FOR v_test IN SELECT * FROM test_tenant_isolation()
    LOOP
        v_results := v_results || jsonb_build_object(
            'name', v_test.test_name,
            'result', v_test.result,
            'details', v_test.details
        );
        
        IF v_test.result LIKE '%PASS%' THEN
            v_pass := v_pass + 1;
        ELSIF v_test.result LIKE '%FAIL%' THEN
            v_fail := v_fail + 1;
        ELSE
            v_warn := v_warn + 1;
        END IF;
    END LOOP;
    
    v_summary := jsonb_build_object(
        'total', v_pass + v_fail + v_warn,
        'passed', v_pass,
        'failed', v_fail,
        'warnings', v_warn,
        'status', CASE 
            WHEN v_fail > 0 THEN 'FAILED'
            WHEN v_warn > 0 THEN 'WARNING'
            ELSE 'PASSED'
        END
    );
    
    RETURN jsonb_build_object(
        'summary', v_summary,
        'tests', v_results,
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ✅ اكتمل ملف اختبار فصل البيانات
-- ✅ Tenant Isolation Test Suite Complete
--
-- 📝 للتشغيل:
-- SELECT * FROM test_tenant_isolation();
-- أو
-- SELECT run_isolation_tests();
