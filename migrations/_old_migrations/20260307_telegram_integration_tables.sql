-- ════════════════════════════════════════════════════════════════
-- 📱 Telegram Integration Tables — NexaPro Agent
-- ════════════════════════════════════════════════════════════════
-- 1. telegram_connections — ربط الموظفين/المجموعات بالبوت
-- 2. pending_actions — إجراءات معلّقة من المحادثة
-- 3. notification_rules — قواعد الإشعارات لكل مشترك
-- ════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1️⃣ telegram_connections — ربط المستخدمين والمجموعات بالبوت
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.telegram_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),

    -- ربط بالمستخدم (NULL للمجموعات)
    user_id UUID REFERENCES auth.users(id),

    -- بيانات Telegram
    telegram_chat_id BIGINT NOT NULL,
    telegram_username VARCHAR(100),
    telegram_first_name VARCHAR(200),

    -- نوع الاتصال
    connection_type VARCHAR(20) NOT NULL DEFAULT 'private'
        CHECK (connection_type IN ('private', 'group', 'supergroup', 'channel')),

    -- الصلاحيات تُورَث تلقائياً من user_profiles (RBAC)
    -- لا حاجة لعمود role — البوت يعمل بصلاحيات المستخدم المربوط

    -- حالة الاتصال
    is_active BOOLEAN DEFAULT true,
    verified_at TIMESTAMPTZ,
    verification_code VARCHAR(10),

    -- إعدادات الإشعارات الشخصية (JSONB)
    notification_preferences JSONB DEFAULT '{
        "daily_report": true,
        "workflow_alerts": true,
        "customer_reminders": false,
        "price_updates": false,
        "motivational": true
    }'::jsonb,

    -- الطوابع الزمنية
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),

    -- لا يمكن ربط نفس chat_id بنفس الشركة مرتين
    UNIQUE(company_id, telegram_chat_id)
);

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_tg_conn_tenant ON public.telegram_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tg_conn_company ON public.telegram_connections(company_id);
CREATE INDEX IF NOT EXISTS idx_tg_conn_user ON public.telegram_connections(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tg_conn_chat_id ON public.telegram_connections(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_tg_conn_active ON public.telegram_connections(company_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tg_conn_verification ON public.telegram_connections(verification_code) WHERE verification_code IS NOT NULL;

-- RLS
ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "telegram_connections_select" ON public.telegram_connections
    FOR SELECT USING (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "telegram_connections_insert" ON public.telegram_connections
    FOR INSERT WITH CHECK (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "telegram_connections_update" ON public.telegram_connections
    FOR UPDATE USING (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "telegram_connections_delete" ON public.telegram_connections
    FOR DELETE USING (
        company_id IN (SELECT get_user_company_ids())
    );

-- التريغرات
SELECT apply_auto_tenant_trigger('telegram_connections');
SELECT apply_auto_company_trigger('telegram_connections');


-- ═══════════════════════════════════════════════════════════════
-- 2️⃣ pending_actions — إجراءات معلّقة من المحادثة
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pending_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),

    -- من أنشأ الإجراء
    created_by_user_id UUID REFERENCES auth.users(id),
    created_by_telegram_id BIGINT,

    -- نوع الإجراء
    action_type VARCHAR(50) NOT NULL
        CHECK (action_type IN (
            'payment_received',   -- قبض دفعة
            'payment_made',       -- دفع مبلغ
            'expense',            -- مصروف
            'salary_advance',     -- سلفة راتب
            'invoice_confirm',    -- تأكيد فاتورة
            'container_receive',  -- استلام كونتينر
            'stock_check',        -- فحص مخزون
            'custom'              -- مخصص
        )),

    -- تفاصيل الإجراء (JSONB مرن)
    action_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    /*
     action_data examples:
     payment_received: { "amount": 5000, "currency": "USD", "from_customer": "أحمد", "customer_id": "...", "invoice_ref": "INV-001" }
     payment_made: { "amount": 2000, "currency": "USD", "to_account": "كهرباء", "account_id": "..." }
     expense: { "amount": 150, "description": "وقود سيارة التوصيل" }
     salary_advance: { "amount": 500, "employee_name": "محمد", "employee_id": "..." }
    */

    -- الوصف النصي (كما كتبه المستخدم)
    original_message TEXT,

    -- حالة العملية
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'rejected', 'auto_confirmed', 'expired')),

    -- تأكيد
    confirmed_by UUID REFERENCES auth.users(id),
    confirmed_at TIMESTAMPTZ,
    confirmed_via VARCHAR(20) CHECK (confirmed_via IN ('web', 'telegram', 'auto')),
    rejection_reason TEXT,

    -- ربط بقيد محاسبي (بعد التأكيد)
    journal_entry_id UUID,
    -- REFERENCES public.journal_entries(id), -- uncomment when ready

    -- مجموعة المسودة اليومية
    daily_batch_date DATE DEFAULT CURRENT_DATE,

    -- الطوابع الزمنية
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_pending_actions_tenant ON public.pending_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_company ON public.pending_actions(company_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_status ON public.pending_actions(company_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_actions_batch ON public.pending_actions(company_id, daily_batch_date);
CREATE INDEX IF NOT EXISTS idx_pending_actions_user ON public.pending_actions(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_actions_telegram ON public.pending_actions(created_by_telegram_id) WHERE created_by_telegram_id IS NOT NULL;

-- RLS
ALTER TABLE public.pending_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_actions_select" ON public.pending_actions
    FOR SELECT USING (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "pending_actions_insert" ON public.pending_actions
    FOR INSERT WITH CHECK (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "pending_actions_update" ON public.pending_actions
    FOR UPDATE USING (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "pending_actions_delete" ON public.pending_actions
    FOR DELETE USING (
        company_id IN (SELECT get_user_company_ids())
    );

-- التريغرات
SELECT apply_auto_tenant_trigger('pending_actions');
SELECT apply_auto_company_trigger('pending_actions');


-- ═══════════════════════════════════════════════════════════════
-- 3️⃣ notification_rules — قواعد الإشعارات لكل مشترك
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),

    -- نوع الإشعار
    rule_type VARCHAR(50) NOT NULL
        CHECK (rule_type IN (
            'daily_report',         -- تقرير صباحي
            'workflow_alert',       -- تنبيه workflow
            'customer_reminder',    -- تذكير زبائن
            'price_update',         -- تحديث أسعار
            'motivational',         -- رسائل تحفيزية
            'container_arrival',    -- وصول كونتينر
            'low_stock',            -- نفاد مخزون
            'payment_due',          -- استحقاق دفعة
            'custom'                -- مخصص
        )),

    -- الاستهداف
    target_type VARCHAR(20) NOT NULL DEFAULT 'all'
        CHECK (target_type IN ('all', 'role', 'user', 'group')),
    target_value VARCHAR(100), -- role name, user_id, or group chat_id

    -- القناة
    channel VARCHAR(20) NOT NULL DEFAULT 'telegram'
        CHECK (channel IN ('telegram', 'in_app', 'both')),

    -- الجدولة
    schedule_type VARCHAR(20) DEFAULT 'event'
        CHECK (schedule_type IN ('event', 'daily', 'weekly', 'cron')),
    schedule_time TIME, -- مثال: 08:00 للتقرير الصباحي
    schedule_cron VARCHAR(50), -- cron expression للجدولة المتقدمة
    schedule_timezone VARCHAR(50) DEFAULT 'Asia/Riyadh',

    -- قالب الرسالة
    message_template TEXT,
    message_template_ar TEXT,

    -- الحالة
    is_active BOOLEAN DEFAULT true,

    -- الطوابع الزمنية
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_notif_rules_tenant ON public.notification_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notif_rules_company ON public.notification_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_notif_rules_type ON public.notification_rules(company_id, rule_type);
CREATE INDEX IF NOT EXISTS idx_notif_rules_active ON public.notification_rules(company_id, is_active) WHERE is_active = true;

-- RLS
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_rules_select" ON public.notification_rules
    FOR SELECT USING (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "notification_rules_insert" ON public.notification_rules
    FOR INSERT WITH CHECK (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "notification_rules_update" ON public.notification_rules
    FOR UPDATE USING (
        company_id IN (SELECT get_user_company_ids())
    );

CREATE POLICY "notification_rules_delete" ON public.notification_rules
    FOR DELETE USING (
        company_id IN (SELECT get_user_company_ids())
    );

-- التريغرات
SELECT apply_auto_tenant_trigger('notification_rules');
SELECT apply_auto_company_trigger('notification_rules');


-- ═══════════════════════════════════════════════════════════════
-- 4️⃣ تحديث updated_at trigger لكل الجداول
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- telegram_connections
DROP TRIGGER IF EXISTS set_updated_at_telegram_connections ON public.telegram_connections;
CREATE TRIGGER set_updated_at_telegram_connections
    BEFORE UPDATE ON public.telegram_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- pending_actions
DROP TRIGGER IF EXISTS set_updated_at_pending_actions ON public.pending_actions;
CREATE TRIGGER set_updated_at_pending_actions
    BEFORE UPDATE ON public.pending_actions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- notification_rules
DROP TRIGGER IF EXISTS set_updated_at_notification_rules ON public.notification_rules;
CREATE TRIGGER set_updated_at_notification_rules
    BEFORE UPDATE ON public.notification_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ═══════════════════════════════════════════════════════════════
-- ✅ Done — Verify
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
    RAISE NOTICE '✅ telegram_connections created';
    RAISE NOTICE '✅ pending_actions created';
    RAISE NOTICE '✅ notification_rules created';
    RAISE NOTICE '✅ All RLS policies applied';
    RAISE NOTICE '✅ All triggers applied';
END $$;
