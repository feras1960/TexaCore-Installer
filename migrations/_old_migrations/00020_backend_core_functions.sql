-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00020: الدوال الأساسية للباك إند
-- Core Backend Functions & Security
-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ يحتوي على:
--    1. get_current_tenant_id() - الدالة الحرجة للـ RLS
--    2. Enhanced Audit Logging
--    3. Security Helper Functions
--    4. Storage Setup
--    5. Subscription Management Functions

-- ═══════════════════════════════════════════════════════════════
-- الجزء 1: الدوال الأساسية للـ Tenant
-- Part 1: Core Tenant Functions
-- ═══════════════════════════════════════════════════════════════

-- الدالة الحرجة: get_current_tenant_id
-- تستخرج tenant_id من JWT token أو من user_profiles
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
BEGIN
    -- المحاولة 1: من JWT metadata مباشرة
    v_tenant_id := NULLIF(
        COALESCE(
            auth.jwt() -> 'user_metadata' ->> 'tenant_id',
            auth.jwt() -> 'app_metadata' ->> 'tenant_id'
        ),
        ''
    )::UUID;
    
    IF v_tenant_id IS NOT NULL THEN
        RETURN v_tenant_id;
    END IF;
    
    -- المحاولة 2: من user_profiles
    v_user_id := auth.uid();
    IF v_user_id IS NOT NULL THEN
        SELECT tenant_id INTO v_tenant_id
        FROM user_profiles
        WHERE id = v_user_id
        LIMIT 1;
        
        IF v_tenant_id IS NOT NULL THEN
            RETURN v_tenant_id;
        END IF;
    END IF;
    
    -- المحاولة 3: من companies عبر user_profiles
    IF v_user_id IS NOT NULL THEN
        SELECT c.tenant_id INTO v_tenant_id
        FROM companies c
        JOIN user_profiles up ON up.company_id = c.id
        WHERE up.id = v_user_id
        LIMIT 1;
    END IF;
    
    RETURN v_tenant_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- التحقق من أن المستخدم ينتمي لهذا الـ tenant
CREATE OR REPLACE FUNCTION belongs_to_tenant(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_current_tenant_id() = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- الحصول على معلومات الـ tenant الحالي
CREATE OR REPLACE FUNCTION get_current_tenant()
RETURNS JSONB AS $$
DECLARE
    v_tenant_id UUID;
    v_result JSONB;
BEGIN
    v_tenant_id := get_current_tenant_id();
    
    IF v_tenant_id IS NULL THEN
        RETURN NULL;
    END IF;
    
    SELECT jsonb_build_object(
        'id', t.id,
        'code', t.code,
        'name', t.name,
        'status', t.status,
        'default_language', t.default_language,
        'settings', t.settings
    ) INTO v_result
    FROM tenants t
    WHERE t.id = v_tenant_id;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 2: نظام Audit Logging المحسّن
-- Part 2: Enhanced Audit Logging System
-- ═══════════════════════════════════════════════════════════════

-- جدول audit_logs المحسّن
DROP TABLE IF EXISTS audit_logs CASCADE;
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- create, read, update, delete, login, logout, etc.
    entity_type VARCHAR(100), -- table name or entity type
    entity_id UUID,
    entity_name VARCHAR(255), -- human readable name
    old_values JSONB,
    new_values JSONB,
    changes JSONB, -- only the changed fields
    ip_address INET,
    user_agent TEXT,
    session_id UUID,
    metadata JSONB DEFAULT '{}',
    severity VARCHAR(20) DEFAULT 'info', -- info, warning, error, critical
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);

-- تفعيل RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: المستخدم يرى logs الخاصة بـ tenant فقط
DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
    FOR SELECT USING (
        tenant_id = get_current_tenant_id()
        OR COALESCE(
            (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::BOOLEAN,
            false
        )
    );

-- Policy: الكل يستطيع الإدخال (logging)
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs
    FOR INSERT WITH CHECK (true);

-- دالة تسجيل Audit Log
CREATE OR REPLACE FUNCTION log_audit(
    p_action VARCHAR(50),
    p_entity_type VARCHAR(100),
    p_entity_id UUID DEFAULT NULL,
    p_entity_name VARCHAR(255) DEFAULT NULL,
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}',
    p_severity VARCHAR(20) DEFAULT 'info'
)
RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
    v_changes JSONB;
BEGIN
    -- حساب التغييرات
    IF p_old_values IS NOT NULL AND p_new_values IS NOT NULL THEN
        SELECT jsonb_object_agg(key, value)
        INTO v_changes
        FROM jsonb_each(p_new_values)
        WHERE p_old_values -> key IS DISTINCT FROM value;
    END IF;
    
    INSERT INTO audit_logs (
        tenant_id,
        user_id,
        action,
        entity_type,
        entity_id,
        entity_name,
        old_values,
        new_values,
        changes,
        metadata,
        severity
    ) VALUES (
        get_current_tenant_id(),
        auth.uid(),
        p_action,
        p_entity_type,
        p_entity_id,
        p_entity_name,
        p_old_values,
        p_new_values,
        v_changes,
        p_metadata,
        p_severity
    )
    RETURNING id INTO v_audit_id;
    
    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger Function للتسجيل التلقائي
CREATE OR REPLACE FUNCTION auto_audit_log()
RETURNS TRIGGER AS $$
DECLARE
    v_action VARCHAR(50);
    v_old_values JSONB;
    v_new_values JSONB;
    v_entity_name VARCHAR(255);
BEGIN
    -- تحديد نوع العملية
    IF TG_OP = 'INSERT' THEN
        v_action := 'create';
        v_new_values := to_jsonb(NEW);
        v_entity_name := COALESCE(
            v_new_values ->> 'name',
            v_new_values ->> 'name_ar',
            v_new_values ->> 'code',
            v_new_values ->> 'id'
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'update';
        v_old_values := to_jsonb(OLD);
        v_new_values := to_jsonb(NEW);
        v_entity_name := COALESCE(
            v_new_values ->> 'name',
            v_new_values ->> 'name_ar',
            v_new_values ->> 'code',
            v_new_values ->> 'id'
        );
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'delete';
        v_old_values := to_jsonb(OLD);
        v_entity_name := COALESCE(
            v_old_values ->> 'name',
            v_old_values ->> 'name_ar',
            v_old_values ->> 'code',
            v_old_values ->> 'id'
        );
    END IF;
    
    -- تسجيل
    PERFORM log_audit(
        v_action,
        TG_TABLE_NAME::VARCHAR(100),
        COALESCE(NEW.id, OLD.id),
        v_entity_name,
        v_old_values,
        v_new_values
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 3: تطبيق Audit على الجداول المهمة
-- Part 3: Apply Audit to Important Tables
-- ═══════════════════════════════════════════════════════════════

-- دالة لتطبيق Audit Trigger على جدول
CREATE OR REPLACE FUNCTION apply_audit_trigger(p_table_name TEXT)
RETURNS VOID AS $$
DECLARE
    v_trigger_name TEXT;
BEGIN
    v_trigger_name := 'trg_audit_' || p_table_name;
    
    -- حذف Trigger القديم
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', v_trigger_name, p_table_name);
    
    -- إنشاء Trigger جديد
    EXECUTE format('
        CREATE TRIGGER %I
        AFTER INSERT OR UPDATE OR DELETE ON %I
        FOR EACH ROW
        EXECUTE FUNCTION auto_audit_log()
    ', v_trigger_name, p_table_name);
    
    RAISE NOTICE '✅ تم تطبيق Audit Trigger على %', p_table_name;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠️ فشل تطبيق Audit على %: %', p_table_name, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- تطبيق على الجداول المهمة
SELECT apply_audit_trigger('companies');
SELECT apply_audit_trigger('chart_of_accounts');
SELECT apply_audit_trigger('journal_entries');
SELECT apply_audit_trigger('sales_invoices');
SELECT apply_audit_trigger('purchase_invoices');
SELECT apply_audit_trigger('customers');
SELECT apply_audit_trigger('suppliers');
SELECT apply_audit_trigger('subscriptions');
SELECT apply_audit_trigger('documents');

-- ═══════════════════════════════════════════════════════════════
-- الجزء 4: إعداد Storage
-- Part 4: Storage Setup
-- ═══════════════════════════════════════════════════════════════

-- إنشاء bucket للمستندات (إذا لم يكن موجوداً)
-- ملاحظة: هذا يحتاج تنفيذ من Supabase Dashboard أو Service Role
DO $$
BEGIN
    -- التحقق من وجود جدول storage.buckets
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'storage' AND table_name = 'buckets'
    ) THEN
        -- إنشاء bucket
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
            'documents',
            'documents',
            false,
            26214400, -- 25MB
            ARRAY[
                'application/pdf',
                'image/jpeg',
                'image/png',
                'image/gif',
                'image/webp',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/plain',
                'text/csv'
            ]
        )
        ON CONFLICT (id) DO UPDATE SET
            file_size_limit = 26214400,
            allowed_mime_types = EXCLUDED.allowed_mime_types;
        
        RAISE NOTICE '✅ تم إنشاء/تحديث Storage Bucket: documents';
    ELSE
        RAISE NOTICE '⚠️ storage.buckets غير موجود - يحتاج إنشاء من Dashboard';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠️ فشل إنشاء Storage Bucket: %', SQLERRM;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 5: Storage RLS Policies
-- Part 5: Storage RLS Policies
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'storage' AND table_name = 'objects'
    ) THEN
        -- Policy: المستخدم يرفع لمجلد tenant الخاص به
        DROP POLICY IF EXISTS "Tenant folder upload" ON storage.objects;
        CREATE POLICY "Tenant folder upload" ON storage.objects
        FOR INSERT WITH CHECK (
            bucket_id = 'documents' AND
            (storage.foldername(name))[1] = get_current_tenant_id()::text
        );
        
        -- Policy: المستخدم يقرأ ملفات tenant الخاص به
        DROP POLICY IF EXISTS "Tenant folder read" ON storage.objects;
        CREATE POLICY "Tenant folder read" ON storage.objects
        FOR SELECT USING (
            bucket_id = 'documents' AND
            (storage.foldername(name))[1] = get_current_tenant_id()::text
        );
        
        -- Policy: المستخدم يحذف ملفات tenant الخاص به
        DROP POLICY IF EXISTS "Tenant folder delete" ON storage.objects;
        CREATE POLICY "Tenant folder delete" ON storage.objects
        FOR DELETE USING (
            bucket_id = 'documents' AND
            (storage.foldername(name))[1] = get_current_tenant_id()::text
        );
        
        RAISE NOTICE '✅ تم تطبيق Storage RLS Policies';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '⚠️ فشل تطبيق Storage Policies: %', SQLERRM;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 6: دوال إدارة الاشتراكات
-- Part 6: Subscription Management Functions
-- ═══════════════════════════════════════════════════════════════

-- تجديد الاشتراك
CREATE OR REPLACE FUNCTION renew_subscription(
    p_subscription_id UUID,
    p_months INT DEFAULT 1
)
RETURNS JSONB AS $$
DECLARE
    v_subscription RECORD;
    v_new_end DATE;
    v_result JSONB;
BEGIN
    -- الحصول على الاشتراك
    SELECT * INTO v_subscription
    FROM subscriptions
    WHERE id = p_subscription_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'subscription_not_found');
    END IF;
    
    -- حساب التاريخ الجديد
    IF v_subscription.current_period_end IS NULL OR 
       v_subscription.current_period_end < CURRENT_DATE THEN
        v_new_end := CURRENT_DATE + (p_months * INTERVAL '1 month');
    ELSE
        v_new_end := v_subscription.current_period_end + (p_months * INTERVAL '1 month');
    END IF;
    
    -- تحديث الاشتراك
    UPDATE subscriptions
    SET 
        status = 'active',
        current_period_end = v_new_end,
        locked_at = NULL,
        lock_reason = NULL,
        updated_at = NOW()
    WHERE id = p_subscription_id;
    
    -- تسجيل
    PERFORM log_audit(
        'renew',
        'subscriptions',
        p_subscription_id,
        NULL,
        NULL,
        jsonb_build_object('new_period_end', v_new_end, 'months', p_months)
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'new_period_end', v_new_end,
        'months_added', p_months
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- التحقق من حالة الاشتراك
CREATE OR REPLACE FUNCTION check_subscription_access(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_tenant_id UUID;
    v_subscription RECORD;
    v_days_remaining INT;
    v_access_level TEXT;
    v_result JSONB;
BEGIN
    v_tenant_id := COALESCE(p_tenant_id, get_current_tenant_id());
    
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object(
            'access_level', 'denied',
            'reason', 'no_tenant'
        );
    END IF;
    
    -- الحصول على الاشتراك
    SELECT * INTO v_subscription
    FROM subscriptions
    WHERE tenant_id = v_tenant_id
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'access_level', 'denied',
            'reason', 'no_subscription'
        );
    END IF;
    
    -- التحقق من القفل
    IF v_subscription.locked_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'access_level', 'locked',
            'reason', v_subscription.lock_reason,
            'locked_at', v_subscription.locked_at
        );
    END IF;
    
    -- حساب الأيام المتبقية
    v_days_remaining := GREATEST(0, 
        (v_subscription.current_period_end::date - CURRENT_DATE)
    );
    
    -- تحديد مستوى الوصول
    IF v_days_remaining <= 0 THEN
        v_access_level := 'expired';
    ELSIF v_days_remaining <= 3 THEN
        v_access_level := 'critical_warning';
    ELSIF v_days_remaining <= 7 THEN
        v_access_level := 'warning';
    ELSE
        v_access_level := 'full';
    END IF;
    
    RETURN jsonb_build_object(
        'access_level', v_access_level,
        'status', v_subscription.status,
        'days_remaining', v_days_remaining,
        'period_end', v_subscription.current_period_end,
        'plan_id', v_subscription.plan_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 7: دوال الإحصائيات
-- Part 7: Statistics Functions
-- ═══════════════════════════════════════════════════════════════

-- إحصائيات الـ tenant
CREATE OR REPLACE FUNCTION get_tenant_statistics(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_tenant_id UUID;
    v_result JSONB;
BEGIN
    v_tenant_id := COALESCE(p_tenant_id, get_current_tenant_id());
    
    SELECT jsonb_build_object(
        'companies', (SELECT COUNT(*) FROM companies WHERE tenant_id = v_tenant_id),
        'users', (SELECT COUNT(*) FROM user_profiles WHERE tenant_id = v_tenant_id),
        'customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = v_tenant_id),
        'suppliers', (SELECT COUNT(*) FROM suppliers WHERE tenant_id = v_tenant_id),
        'products', (SELECT COUNT(*) FROM products WHERE tenant_id = v_tenant_id),
        'journal_entries', (SELECT COUNT(*) FROM journal_entries WHERE tenant_id = v_tenant_id),
        'sales_invoices', (SELECT COUNT(*) FROM sales_invoices WHERE tenant_id = v_tenant_id),
        'documents', (SELECT COUNT(*) FROM documents WHERE tenant_id = v_tenant_id),
        'storage_used', (
            SELECT COALESCE(SUM(file_size), 0)
            FROM documents
            WHERE tenant_id = v_tenant_id
        )
    ) INTO v_result;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════
-- الجزء 8: التحقق النهائي
-- Part 8: Final Verification
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_func TEXT;
    v_exists BOOLEAN;
    v_functions TEXT[] := ARRAY[
        'get_current_tenant_id',
        'belongs_to_tenant',
        'get_current_tenant',
        'log_audit',
        'auto_audit_log',
        'renew_subscription',
        'check_subscription_access',
        'get_tenant_statistics'
    ];
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '📊 التحقق من الدوال الجديدة:';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    
    FOREACH v_func IN ARRAY v_functions
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = v_func
        ) INTO v_exists;
        
        IF v_exists THEN
            RAISE NOTICE '✅ %', v_func;
        ELSE
            RAISE NOTICE '❌ %: غير موجودة', v_func;
        END IF;
    END LOOP;
    
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ اكتمل تنفيذ Migration 00020';
    RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;

-- ✅ تم إنشاء جميع الدوال الأساسية للباك إند
-- ✅ All core backend functions have been created
