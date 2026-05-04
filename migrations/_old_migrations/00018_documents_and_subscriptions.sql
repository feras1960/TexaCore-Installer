-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00018: نظام المستندات وتنبيهات الاشتراك
-- Documents System & Subscription Alerts
-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ آمنة - لا تؤثر على الجداول الموجودة
-- ✅ Safe - Does not affect existing tables

-- ═══════════════════════════════════════════════════════════════
-- الجزء الأول: نظام المستندات والتخزين
-- Part 1: Documents & Storage System
-- ═══════════════════════════════════════════════════════════════

-- جدول المستندات
-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- ═══ الربط مع الكيانات ═══
    entity_type VARCHAR(50) NOT NULL,
    -- invoice, contract, account, journal_entry, customer, supplier, product, tenant, agent
    entity_id UUID NOT NULL,
    
    -- ═══ معلومات الملف ═══
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    file_type VARCHAR(100),
    -- pdf, image, excel, doc, other
    mime_type VARCHAR(100),
    file_size BIGINT NOT NULL,
    -- بالبايت
    storage_path TEXT NOT NULL,
    -- المسار في Supabase Storage
    public_url TEXT,
    -- الرابط العام إذا كان متاحاً
    
    -- ═══ معلومات إضافية ═══
    description TEXT,
    category VARCHAR(50),
    -- contract, invoice_copy, receipt, id_document, certificate, other
    tags TEXT[] DEFAULT '{}',
    
    -- ═══ البيانات الوصفية ═══
    metadata JSONB DEFAULT '{}',
    -- يمكن تخزين: عدد الصفحات، الأبعاد للصور، إلخ
    
    -- ═══ التتبع ═══
    uploaded_by UUID REFERENCES auth.users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- جدول حدود التخزين لكل مستأجر
-- Storage quotas per tenant
CREATE TABLE IF NOT EXISTS storage_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- ═══ الحدود ═══
    max_storage_bytes BIGINT DEFAULT 5368709120,
    -- 5 GB افتراضي
    used_storage_bytes BIGINT DEFAULT 0,
    max_files_count INT DEFAULT 1000,
    current_files_count INT DEFAULT 0,
    max_file_size_bytes BIGINT DEFAULT 26214400,
    -- 25 MB حد أقصى للملف الواحد
    
    -- ═══ الإشعارات ═══
    alert_threshold_percent INT DEFAULT 80,
    -- تنبيه عند 80%
    critical_threshold_percent INT DEFAULT 95,
    -- تحذير حرج عند 95%
    last_alert_sent_at TIMESTAMPTZ,
    last_critical_alert_at TIMESTAMPTZ,
    
    -- ═══ التتبع ═══
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- حدود التخزين حسب الباقة
-- Storage limits per plan
CREATE TABLE IF NOT EXISTS plan_storage_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID REFERENCES subscription_plans(id) ON DELETE CASCADE,
    
    max_storage_bytes BIGINT NOT NULL,
    max_files_count INT NOT NULL,
    max_file_size_bytes BIGINT NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(plan_id)
);

-- ═══════════════════════════════════════════════════════════════
-- الجزء الثاني: نظام تنبيهات الاشتراك
-- Part 2: Subscription Alerts System
-- ═══════════════════════════════════════════════════════════════

-- إضافة حقول جديدة لجدول subscriptions
DO $$
BEGIN
    -- فترة السماح بالأيام
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscriptions' AND column_name = 'grace_period_days') THEN
        ALTER TABLE subscriptions ADD COLUMN grace_period_days INT DEFAULT 7;
    END IF;
    
    -- تاريخ القفل
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscriptions' AND column_name = 'locked_at') THEN
        ALTER TABLE subscriptions ADD COLUMN locked_at TIMESTAMPTZ;
    END IF;
    
    -- سبب القفل
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscriptions' AND column_name = 'lock_reason') THEN
        ALTER TABLE subscriptions ADD COLUMN lock_reason TEXT;
    END IF;
    
    -- آخر تنبيه تم إرساله
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscriptions' AND column_name = 'last_alert_type') THEN
        ALTER TABLE subscriptions ADD COLUMN last_alert_type VARCHAR(50);
    END IF;
    
    -- تاريخ آخر تنبيه
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscriptions' AND column_name = 'last_alert_at') THEN
        ALTER TABLE subscriptions ADD COLUMN last_alert_at TIMESTAMPTZ;
    END IF;
END $$;

-- جدول تنبيهات الاشتراك
-- Subscription alerts table
CREATE TABLE IF NOT EXISTS subscription_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    
    -- ═══ نوع التنبيه ═══
    alert_type VARCHAR(50) NOT NULL,
    -- warning_30_days: تذكير قبل شهر
    -- warning_7_days: تحذير قبل أسبوع
    -- warning_3_days: تحذير قبل 3 أيام
    -- warning_1_day: تحذير قبل يوم
    -- expired: انتهى الاشتراك
    -- grace_period: فترة السماح
    -- locked: تم القفل
    -- payment_reminder: تذكير بالدفع
    
    -- ═══ قنوات الإرسال ═══
    channels TEXT[] DEFAULT ARRAY['in_app'],
    -- in_app, email, sms, whatsapp
    
    -- ═══ الحالة ═══
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    -- تاريخ رؤية المستخدم للتنبيه والنقر عليه
    
    -- ═══ محتوى التنبيه ═══
    title TEXT,
    message TEXT,
    action_url TEXT,
    -- الرابط للتجديد أو الدفع
    
    -- ═══ بيانات إضافية ═══
    metadata JSONB DEFAULT '{}',
    -- أيام متبقية، مبلغ مستحق، إلخ
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- جدول سجل حالة الاشتراك
-- Subscription status history
CREATE TABLE IF NOT EXISTS subscription_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    old_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    changed_by UUID REFERENCES auth.users(id),
    reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- الجزء الثالث: الدوال والـ Triggers
-- Part 3: Functions & Triggers
-- ═══════════════════════════════════════════════════════════════

-- دالة لتحديث حد التخزين عند رفع/حذف ملف
CREATE OR REPLACE FUNCTION update_storage_quota()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- زيادة الاستخدام عند رفع ملف جديد
        UPDATE storage_quotas
        SET 
            used_storage_bytes = used_storage_bytes + NEW.file_size,
            current_files_count = current_files_count + 1,
            updated_at = NOW()
        WHERE tenant_id = NEW.tenant_id;
        
        -- إنشاء سجل جديد إذا لم يكن موجوداً
        INSERT INTO storage_quotas (tenant_id, used_storage_bytes, current_files_count)
        VALUES (NEW.tenant_id, NEW.file_size, 1)
        ON CONFLICT (tenant_id) DO NOTHING;
        
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- تقليل الاستخدام عند حذف ملف
        UPDATE storage_quotas
        SET 
            used_storage_bytes = GREATEST(0, used_storage_bytes - OLD.file_size),
            current_files_count = GREATEST(0, current_files_count - 1),
            updated_at = NOW()
        WHERE tenant_id = OLD.tenant_id;
        
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger لتحديث حد التخزين
DROP TRIGGER IF EXISTS trigger_update_storage_quota ON documents;
CREATE TRIGGER trigger_update_storage_quota
    AFTER INSERT OR DELETE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_storage_quota();

-- دالة لتسجيل تغيير حالة الاشتراك
CREATE OR REPLACE FUNCTION log_subscription_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO subscription_status_history (
            subscription_id,
            tenant_id,
            old_status,
            new_status,
            reason
        ) VALUES (
            NEW.id,
            NEW.tenant_id,
            OLD.status,
            NEW.status,
            NEW.lock_reason
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger لتسجيل تغيير حالة الاشتراك
DROP TRIGGER IF EXISTS trigger_log_subscription_status ON subscriptions;
CREATE TRIGGER trigger_log_subscription_status
    AFTER UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION log_subscription_status_change();

-- دالة للتحقق من حالة الاشتراك
CREATE OR REPLACE FUNCTION get_subscription_status(p_tenant_id UUID)
RETURNS TABLE (
    subscription_id UUID,
    plan_name VARCHAR,
    status VARCHAR,
    days_remaining INT,
    is_expired BOOLEAN,
    is_locked BOOLEAN,
    is_in_grace_period BOOLEAN,
    grace_days_remaining INT,
    access_level VARCHAR
) AS $$
DECLARE
    v_sub RECORD;
    v_days_remaining INT;
    v_grace_days_remaining INT;
    v_access_level VARCHAR;
BEGIN
    SELECT s.*, sp.name_ar as plan_name_ar, sp.name_en as plan_name_en
    INTO v_sub
    FROM subscriptions s
    LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
    WHERE s.tenant_id = p_tenant_id
    AND s.status != 'cancelled'
    ORDER BY s.created_at DESC
    LIMIT 1;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            NULL::UUID,
            'No Plan'::VARCHAR,
            'none'::VARCHAR,
            0,
            true,
            true,
            false,
            0,
            'locked'::VARCHAR;
        RETURN;
    END IF;
    
    -- حساب الأيام المتبقية
    v_days_remaining := EXTRACT(DAY FROM (v_sub.current_period_end - NOW()));
    
    -- حساب أيام فترة السماح المتبقية
    IF v_sub.current_period_end < NOW() THEN
        v_grace_days_remaining := COALESCE(v_sub.grace_period_days, 7) - 
            EXTRACT(DAY FROM (NOW() - v_sub.current_period_end))::INT;
    ELSE
        v_grace_days_remaining := COALESCE(v_sub.grace_period_days, 7);
    END IF;
    
    -- تحديد مستوى الوصول
    IF v_sub.locked_at IS NOT NULL THEN
        v_access_level := 'locked';
    ELSIF v_sub.current_period_end < NOW() AND v_grace_days_remaining <= 0 THEN
        v_access_level := 'locked';
    ELSIF v_sub.current_period_end < NOW() THEN
        v_access_level := 'read_only';
    ELSIF v_days_remaining <= 3 THEN
        v_access_level := 'warning';
    ELSE
        v_access_level := 'full';
    END IF;
    
    RETURN QUERY SELECT 
        v_sub.id,
        COALESCE(v_sub.plan_name_ar, v_sub.plan_name_en, 'Unknown')::VARCHAR,
        v_sub.status,
        GREATEST(0, v_days_remaining),
        v_sub.current_period_end < NOW(),
        v_sub.locked_at IS NOT NULL OR (v_sub.current_period_end < NOW() AND v_grace_days_remaining <= 0),
        v_sub.current_period_end < NOW() AND v_grace_days_remaining > 0,
        GREATEST(0, v_grace_days_remaining),
        v_access_level;
END;
$$ LANGUAGE plpgsql;

-- دالة لقفل الاشتراك
CREATE OR REPLACE FUNCTION lock_subscription(
    p_subscription_id UUID,
    p_reason TEXT DEFAULT 'Payment overdue'
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE subscriptions
    SET 
        status = 'locked',
        locked_at = NOW(),
        lock_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_subscription_id
    AND locked_at IS NULL;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- دالة لفتح الاشتراك
CREATE OR REPLACE FUNCTION unlock_subscription(
    p_subscription_id UUID,
    p_new_period_end TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE subscriptions
    SET 
        status = 'active',
        locked_at = NULL,
        lock_reason = NULL,
        current_period_end = COALESCE(p_new_period_end, current_period_end + INTERVAL '30 days'),
        updated_at = NOW()
    WHERE id = p_subscription_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- الجزء الرابع: الفهارس
-- Part 4: Indexes
-- ═══════════════════════════════════════════════════════════════

-- فهارس جدول المستندات
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);

-- فهارس جدول تنبيهات الاشتراك
CREATE INDEX IF NOT EXISTS idx_subscription_alerts_tenant ON subscription_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_alerts_type ON subscription_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_subscription_alerts_read ON subscription_alerts(read_at) WHERE read_at IS NULL;

-- فهارس جدول سجل حالة الاشتراك
CREATE INDEX IF NOT EXISTS idx_subscription_history_sub ON subscription_status_history(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_history_tenant ON subscription_status_history(tenant_id);

-- ═══════════════════════════════════════════════════════════════
-- الجزء الخامس: RLS Policies
-- Part 5: RLS Policies
-- ═══════════════════════════════════════════════════════════════

-- تفعيل RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_status_history ENABLE ROW LEVEL SECURITY;

-- سياسات جدول المستندات
DROP POLICY IF EXISTS "Users can view documents of their tenant" ON documents;
CREATE POLICY "Users can view documents of their tenant" ON documents
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Users can insert documents for their tenant" ON documents;
CREATE POLICY "Users can insert documents for their tenant" ON documents
    FOR INSERT WITH CHECK (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Users can delete their uploaded documents" ON documents;
CREATE POLICY "Users can delete their uploaded documents" ON documents
    FOR DELETE USING (
        uploaded_by = auth.uid() OR
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

-- سياسات جدول حدود التخزين
DROP POLICY IF EXISTS "Users can view their tenant storage quota" ON storage_quotas;
CREATE POLICY "Users can view their tenant storage quota" ON storage_quotas
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

-- سياسات جدول التنبيهات
DROP POLICY IF EXISTS "Users can view their tenant alerts" ON subscription_alerts;
CREATE POLICY "Users can view their tenant alerts" ON subscription_alerts
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Users can update their alerts (acknowledge)" ON subscription_alerts;
CREATE POLICY "Users can update their alerts (acknowledge)" ON subscription_alerts
    FOR UPDATE USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

-- ═══════════════════════════════════════════════════════════════
-- الجزء السادس: البيانات الافتراضية
-- Part 6: Default Data
-- ═══════════════════════════════════════════════════════════════

-- حدود التخزين للباقات الافتراضية
INSERT INTO plan_storage_limits (plan_id, max_storage_bytes, max_files_count, max_file_size_bytes)
SELECT 
    id,
    CASE code
        WHEN 'free' THEN 1073741824       -- 1 GB
        WHEN 'starter' THEN 5368709120    -- 5 GB
        WHEN 'professional' THEN 26843545600  -- 25 GB
        WHEN 'enterprise' THEN 107374182400   -- 100 GB
        ELSE 5368709120  -- 5 GB default
    END,
    CASE code
        WHEN 'free' THEN 100
        WHEN 'starter' THEN 500
        WHEN 'professional' THEN 2000
        WHEN 'enterprise' THEN 10000
        ELSE 1000
    END,
    CASE code
        WHEN 'free' THEN 10485760        -- 10 MB
        WHEN 'starter' THEN 26214400     -- 25 MB
        WHEN 'professional' THEN 52428800  -- 50 MB
        WHEN 'enterprise' THEN 104857600   -- 100 MB
        ELSE 26214400  -- 25 MB default
    END
FROM subscription_plans
WHERE id NOT IN (SELECT plan_id FROM plan_storage_limits)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- ✅ تم! Migration مكتمل
-- ✅ Done! Migration complete
-- ═══════════════════════════════════════════════════════════════
