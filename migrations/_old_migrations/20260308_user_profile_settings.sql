-- ═══════════════════════════════════════════════════════════════════════════
-- 📋 User Profile & Settings Infrastructure
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds profile settings, login history, access policies, and active sessions
-- Date: 2026-03-08
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. إضافة حقول جديدة لـ user_profiles ─────────────────────────────

-- البيانات الشخصية
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS bio TEXT;

-- التفضيلات
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Riyadh';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS language_preference TEXT DEFAULT 'ar';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS theme_preference TEXT DEFAULT 'system';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS date_format TEXT DEFAULT 'DD/MM/YYYY';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS number_format TEXT DEFAULT 'en';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS default_currency TEXT DEFAULT 'USD';

-- التلغرام
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS telegram_verified BOOLEAN DEFAULT FALSE;

-- الأمان
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}';

-- تتبع النشاط
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_login_ip TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_login_device TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS current_page TEXT;

-- حظر/تعليق المستخدم
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS suspended_by UUID;


-- ─── 2. جدول سجل تسجيل الدخول ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS login_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID,
    company_id UUID,
    -- بيانات الجلسة
    login_at TIMESTAMPTZ DEFAULT NOW(),
    logout_at TIMESTAMPTZ,
    duration_minutes INTEGER,
    session_id TEXT,
    -- بيانات الجهاز
    ip_address TEXT,
    user_agent TEXT,
    device_type TEXT,          -- 'desktop', 'mobile', 'tablet'
    browser TEXT,              -- 'Chrome', 'Safari', 'Firefox', etc.
    os TEXT,                   -- 'macOS', 'Windows', 'iOS', 'Android'
    -- الموقع الجغرافي
    location_city TEXT,
    location_country TEXT,
    location_country_code TEXT,
    -- النتيجة
    success BOOLEAN DEFAULT TRUE,
    failure_reason TEXT,       -- 'wrong_password', 'account_suspended', 'outside_hours', etc.
    -- الطابع الزمني
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE login_history ENABLE ROW LEVEL SECURITY;

-- المستخدم يرى سجله فقط
CREATE POLICY "login_history_user_select" ON login_history
    FOR SELECT USING (user_id = auth.uid());

-- المدير يرى سجل جميع مستخدمي نفس الشركة
CREATE POLICY "login_history_admin_select" ON login_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('super_admin', 'tenant_owner', 'company_admin')
        )
        AND company_id IN (
            SELECT company_id FROM user_profiles WHERE id = auth.uid()
        )
    );

-- السماح بإدراج سجلات جديدة
CREATE POLICY "login_history_insert" ON login_history
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id, login_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_company ON login_history(company_id, login_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_success ON login_history(success, login_at DESC);


-- ─── 3. جدول الجلسات النشطة ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID,
    company_id UUID,
    -- بيانات الجلسة
    session_token TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    -- بيانات الجهاز
    ip_address TEXT,
    user_agent TEXT,
    device_type TEXT,
    browser TEXT,
    os TEXT,
    -- الموقع
    location_city TEXT,
    location_country TEXT,
    location_country_code TEXT,
    -- الصفحة الحالية
    current_page TEXT,
    -- هل هذه الجلسة الحالية؟
    is_current BOOLEAN DEFAULT FALSE,
    -- الطابع الزمني
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;

-- المستخدم يرى ويدير جلساته
CREATE POLICY "active_sessions_user_select" ON active_sessions
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "active_sessions_user_delete" ON active_sessions
    FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "active_sessions_user_insert" ON active_sessions
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "active_sessions_user_update" ON active_sessions
    FOR UPDATE USING (user_id = auth.uid());

-- المدير يرى ويدير جلسات مستخدمي الشركة
CREATE POLICY "active_sessions_admin_select" ON active_sessions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('super_admin', 'tenant_owner', 'company_admin')
        )
        AND company_id IN (
            SELECT company_id FROM user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "active_sessions_admin_delete" ON active_sessions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('super_admin', 'tenant_owner', 'company_admin')
        )
        AND company_id IN (
            SELECT company_id FROM user_profiles WHERE id = auth.uid()
        )
    );

CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_company ON active_sessions(company_id);


-- ─── 4. جدول سياسات أوقات الوصول ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS access_policies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID,
    company_id UUID,
    -- التسمية
    name TEXT NOT NULL,
    name_ar TEXT,
    description TEXT,
    -- الأدوار التي تنطبق عليها السياسة
    applies_to_roles TEXT[] DEFAULT '{}',
    applies_to_users UUID[] DEFAULT '{}',
    -- أيام العمل المسموحة (sat, sun, mon, tue, wed, thu, fri)
    allowed_days TEXT[] DEFAULT ARRAY['sat','sun','mon','tue','wed','thu'],
    -- ساعات العمل
    work_start_time TIME DEFAULT '08:00',
    work_end_time TIME DEFAULT '20:00',
    -- سلوك خارج الأوقات
    outside_hours_action TEXT DEFAULT 'allow_notify',  -- 'block', 'allow_notify', 'allow_silent'
    -- تقييد IP
    ip_restriction_enabled BOOLEAN DEFAULT FALSE,
    allowed_ips TEXT[] DEFAULT '{}',
    -- الحالة والترتيب
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0,
    -- الطوابع الزمنية
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

ALTER TABLE access_policies ENABLE ROW LEVEL SECURITY;

-- المدراء فقط يديرون السياسات
CREATE POLICY "access_policies_admin_all" ON access_policies
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('super_admin', 'tenant_owner', 'company_admin')
        )
        AND company_id IN (
            SELECT company_id FROM user_profiles WHERE id = auth.uid()
        )
    );

-- الجميع يقرأ السياسات (لتطبيقها عند الدخول)
CREATE POLICY "access_policies_read" ON access_policies
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM user_profiles WHERE id = auth.uid()
        )
    );

CREATE INDEX IF NOT EXISTS idx_access_policies_company ON access_policies(company_id, is_active);

-- Updated at trigger
CREATE TRIGGER update_access_policies_updated_at
    BEFORE UPDATE ON access_policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─── 5. جدول سجل أحداث الأمان ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID,
    company_id UUID,
    -- نوع الحدث
    event_type TEXT NOT NULL,
    -- 'password_changed', 'mfa_enabled', 'mfa_disabled',
    -- 'session_terminated', 'user_suspended', 'user_reactivated',
    -- 'login_blocked', 'suspicious_login', 'email_changed'
    description TEXT,
    metadata JSONB DEFAULT '{}',
    -- من قام بالإجراء
    performed_by UUID,
    ip_address TEXT,
    -- الطابع الزمني
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "security_events_user_select" ON security_events
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "security_events_admin_select" ON security_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('super_admin', 'tenant_owner', 'company_admin')
        )
        AND company_id IN (
            SELECT company_id FROM user_profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "security_events_insert" ON security_events
    FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_company ON security_events(company_id, created_at DESC);


-- ─── 6. دوال مساعدة ─────────────────────────────────────────────────────

-- تنظيف الجلسات المنتهية (يُشغّل كـ cron job)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
    DELETE FROM active_sessions 
    WHERE last_active_at < NOW() - INTERVAL '24 hours';
    
    UPDATE user_profiles 
    SET is_online = FALSE 
    WHERE is_online = TRUE 
    AND last_active_at < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تنظيف سجل الدخول القديم (أكثر من 90 يوم)
CREATE OR REPLACE FUNCTION cleanup_old_login_history()
RETURNS void AS $$
BEGIN
    DELETE FROM login_history 
    WHERE login_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- التحقق من سياسة الوصول
CREATE OR REPLACE FUNCTION check_access_policy(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_policy RECORD;
    v_user RECORD;
    v_current_day TEXT;
    v_current_time TIME;
    v_result JSONB;
BEGIN
    -- الحصول على بيانات المستخدم
    SELECT * INTO v_user FROM user_profiles WHERE id = p_user_id;
    
    -- التحقق من الحظر
    IF v_user.is_suspended = TRUE THEN
        IF v_user.suspended_until IS NOT NULL AND v_user.suspended_until < NOW() THEN
            -- انتهى التعليق المؤقت، إعادة تفعيل
            UPDATE user_profiles 
            SET is_suspended = FALSE, suspended_at = NULL, 
                suspended_until = NULL, suspended_reason = NULL 
            WHERE id = p_user_id;
        ELSE
            RETURN jsonb_build_object(
                'allowed', false,
                'reason', 'suspended',
                'message', COALESCE(v_user.suspended_reason, 'Account suspended'),
                'until', v_user.suspended_until
            );
        END IF;
    END IF;
    
    -- التحقق من is_active
    IF v_user.is_active = FALSE THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'deactivated',
            'message', 'Account deactivated'
        );
    END IF;
    
    -- البحث عن السياسة المطبقة
    v_current_day := LOWER(to_char(NOW() AT TIME ZONE COALESCE(v_user.timezone, 'Asia/Riyadh'), 'Dy'));
    v_current_time := (NOW() AT TIME ZONE COALESCE(v_user.timezone, 'Asia/Riyadh'))::TIME;
    
    SELECT * INTO v_policy 
    FROM access_policies 
    WHERE company_id = v_user.company_id 
    AND is_active = TRUE
    AND (
        v_user.role = ANY(applies_to_roles) 
        OR p_user_id = ANY(applies_to_users)
        OR (array_length(applies_to_roles, 1) IS NULL AND array_length(applies_to_users, 1) IS NULL)
    )
    ORDER BY priority DESC
    LIMIT 1;
    
    -- لا توجد سياسة = السماح
    IF v_policy IS NULL THEN
        RETURN jsonb_build_object('allowed', true, 'reason', 'no_policy');
    END IF;
    
    -- التحقق من اليوم
    IF NOT (v_current_day = ANY(v_policy.allowed_days)) THEN
        IF v_policy.outside_hours_action = 'block' THEN
            RETURN jsonb_build_object('allowed', false, 'reason', 'day_blocked', 'action', 'block');
        ELSE
            RETURN jsonb_build_object('allowed', true, 'reason', 'day_notify', 'action', v_policy.outside_hours_action);
        END IF;
    END IF;
    
    -- التحقق من الساعات
    IF v_current_time < v_policy.work_start_time OR v_current_time > v_policy.work_end_time THEN
        IF v_policy.outside_hours_action = 'block' THEN
            RETURN jsonb_build_object('allowed', false, 'reason', 'hours_blocked', 'action', 'block');
        ELSE
            RETURN jsonb_build_object('allowed', true, 'reason', 'hours_notify', 'action', v_policy.outside_hours_action);
        END IF;
    END IF;
    
    RETURN jsonb_build_object('allowed', true, 'reason', 'policy_ok');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── 7. Reload Schema ───────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

SELECT 'User Profile & Settings infrastructure created successfully' as status;
