-- ══════════════════════════════════════════════════════════════════════════════
-- CRM MODULE ENHANCEMENT + UCM (Grandstream) Integration
-- TexaCore ERP | Phase 2
-- Date: 2026-02-28
-- ══════════════════════════════════════════════════════════════════════════════
--
-- الجداول الجديدة:
--   1. crm_tasks            — مهام المتابعة
--   2. crm_campaigns        — الحملات التسويقية
--   3. crm_campaign_contacts — جهات التواصل في الحملة
--   4. crm_pipeline_stages  — مراحل المبيعات (قابلة للتخصيص)
--   5. crm_deals            — الصفقات
--   6. ucm_config           — إعدادات Grandstream UCM
--   7. ucm_extensions       — ربط التحويلات بالموظفين
--
-- التحسينات:
--   - توسيع call_logs (حقول UCM)
--   - توسيع call_analyses (تحليل AI أكثر تفصيلاً)
-- ══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- 1. CRM TASKS — مهام المتابعة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    title VARCHAR(255) NOT NULL,
    description TEXT,
    
    task_type VARCHAR(30) DEFAULT 'follow_up'
        CHECK (task_type IN (
            'follow_up', 'call', 'email', 'meeting', 'demo',
            'proposal', 'negotiation', 'site_visit', 'other'
        )),
    
    priority VARCHAR(10) DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    
    status VARCHAR(20) DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled', 'overdue')),
    
    -- الربط
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    deal_id UUID, -- → crm_deals.id (يُضاف بعد إنشاء الجدول)
    call_log_id UUID REFERENCES call_logs(id) ON DELETE SET NULL,
    
    -- التوقيت
    due_date TIMESTAMPTZ,
    reminder_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- التعيين
    assigned_to UUID REFERENCES user_profiles(id),
    assigned_by UUID REFERENCES user_profiles(id),
    
    -- النتيجة
    outcome TEXT,
    outcome_type VARCHAR(20)
        CHECK (outcome_type IN ('successful', 'no_response', 'reschedule', 'not_interested', 'converted')),
    
    tags TEXT[],
    metadata JSONB DEFAULT '{}',
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant ON crm_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_contact ON crm_tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assigned ON crm_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_status ON crm_tasks(status);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks(due_date) WHERE status NOT IN ('completed', 'cancelled');

ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_tasks_tenant_access" ON crm_tasks
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 2. CRM PIPELINE STAGES — مراحل المبيعات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(30) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    stage_type VARCHAR(20) DEFAULT 'active'
        CHECK (stage_type IN ('active', 'won', 'lost')),
    
    probability INTEGER DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
    
    color VARCHAR(7) DEFAULT '#3B82F6',
    icon VARCHAR(50),
    
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_tenant ON crm_pipeline_stages(tenant_id);

ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_stages_tenant_access" ON crm_pipeline_stages
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 3. CRM DEALS — الصفقات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    deal_number VARCHAR(30),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- الربط
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    stage_id UUID REFERENCES crm_pipeline_stages(id),
    
    -- القيم
    amount NUMERIC(15,2),
    currency VARCHAR(3) DEFAULT 'SAR',
    probability INTEGER DEFAULT 0,
    
    -- التوقيت
    expected_close_date DATE,
    actual_close_date DATE,
    
    -- التعيين
    assigned_to UUID REFERENCES user_profiles(id),
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'open'
        CHECK (status IN ('open', 'won', 'lost', 'cancelled')),
    
    lost_reason TEXT,
    won_amount NUMERIC(15,2),
    
    -- المصدر
    source VARCHAR(30)
        CHECK (source IN (
            'website', 'phone', 'email', 'referral', 'social_media',
            'trade_show', 'cold_call', 'online_store', 'agent', 'other'
        )),
    
    tags TEXT[],
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ربط deal_id في crm_tasks
ALTER TABLE crm_tasks ADD CONSTRAINT fk_crm_tasks_deal 
    FOREIGN KEY (deal_id) REFERENCES crm_deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant ON crm_deals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_contact ON crm_deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_assigned ON crm_deals(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON crm_deals(status);

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_deals_tenant_access" ON crm_deals
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 4. CRM CAMPAIGNS — الحملات التسويقية
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    campaign_type VARCHAR(30) DEFAULT 'email'
        CHECK (campaign_type IN (
            'email', 'sms', 'whatsapp', 'phone', 'social_media',
            'event', 'webinar', 'promotion', 'newsletter', 'other'
        )),
    
    status VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled')),
    
    -- التوقيت
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    
    -- الميزانية
    budget NUMERIC(15,2),
    actual_cost NUMERIC(15,2) DEFAULT 0,
    
    -- الأداء
    sent_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    converted_count INTEGER DEFAULT 0,
    unsubscribed_count INTEGER DEFAULT 0,
    bounced_count INTEGER DEFAULT 0,
    
    -- المحتوى
    subject TEXT,
    content TEXT,
    template_id VARCHAR(50),
    
    -- الاستهداف
    target_segment JSONB DEFAULT '{}',
    -- مثال: {"contact_type": "customer", "city": "Kyiv", "tags": ["VIP"]}
    
    assigned_to UUID REFERENCES user_profiles(id),
    
    tags TEXT[],
    metadata JSONB DEFAULT '{}',
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON crm_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON crm_campaigns(status);

ALTER TABLE crm_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_campaigns_tenant_access" ON crm_campaigns
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 5. CRM CAMPAIGN CONTACTS — جهات حملة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_campaign_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    campaign_id UUID NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'opened', 'clicked', 'converted', 'bounced', 'unsubscribed')),
    
    sent_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    converted_at TIMESTAMPTZ,
    
    response TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_contact_unique 
    ON crm_campaign_contacts(campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_tenant ON crm_campaign_contacts(tenant_id);

ALTER TABLE crm_campaign_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_contacts_tenant_access" ON crm_campaign_contacts
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 6. UCM CONFIG — إعدادات Grandstream UCM
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ucm_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    -- الاتصال بجهاز Grandstream
    enabled BOOLEAN DEFAULT false,
    device_type VARCHAR(20) DEFAULT 'grandstream_ucm'
        CHECK (device_type IN ('grandstream_ucm', 'asterisk', 'freepbx', 'other')),
    device_model VARCHAR(50), -- UCM6510, UCM6208...
    
    ip_address VARCHAR(50) NOT NULL,
    port INTEGER DEFAULT 8089,
    protocol VARCHAR(10) DEFAULT 'https'
        CHECK (protocol IN ('http', 'https', 'wss')),
    
    -- المصادقة
    username VARCHAR(100),
    api_key_encrypted TEXT, -- مشفر
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'disconnected'
        CHECK (status IN ('connected', 'disconnected', 'connecting', 'error', 'maintenance')),
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,
    
    -- الإعدادات
    auto_record BOOLEAN DEFAULT true,
    recording_format VARCHAR(10) DEFAULT 'mp3',
    recording_storage VARCHAR(20) DEFAULT 'supabase' -- 'supabase', 'local', 's3'
        CHECK (recording_storage IN ('supabase', 'local', 's3', 'gcs')),
    
    -- تكامل CDR
    cdr_sync_enabled BOOLEAN DEFAULT true,
    cdr_sync_interval_minutes INTEGER DEFAULT 5,
    cdr_last_sync_id VARCHAR(100), -- آخر CDR تم مزامنته
    
    -- Webhook
    webhook_url TEXT,
    webhook_secret TEXT,
    
    -- Call Popup إعدادات
    popup_enabled BOOLEAN DEFAULT true,
    popup_show_customer_info BOOLEAN DEFAULT true,
    popup_show_balance BOOLEAN DEFAULT true,
    popup_show_last_order BOOLEAN DEFAULT true,
    popup_fields_config JSONB DEFAULT '[]', -- ترتيب وإظهار الحقول
    popup_buttons_config JSONB DEFAULT '[]', -- الأزرار المتاحة (عرض سعر، حجز، فاتورة...)
    
    -- AI Analysis
    ai_analysis_enabled BOOLEAN DEFAULT false,
    ai_model VARCHAR(30) DEFAULT 'gpt-4',
    ai_auto_analyze BOOLEAN DEFAULT false,
    
    settings JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ucm_config_unique 
    ON ucm_config(tenant_id, company_id);

ALTER TABLE ucm_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucm_config_tenant_access" ON ucm_config
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 7. UCM EXTENSIONS — ربط التحويلات بالموظفين
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ucm_extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    ucm_config_id UUID NOT NULL REFERENCES ucm_config(id) ON DELETE CASCADE,
    
    extension_number VARCHAR(10) NOT NULL,
    
    -- ربط بالنظام
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    user_profile_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    
    display_name VARCHAR(100),
    department VARCHAR(100),
    
    -- حالة التحويلة
    status VARCHAR(20) DEFAULT 'available'
        CHECK (status IN ('available', 'busy', 'away', 'dnd', 'offline', 'ringing')),
    
    -- إعدادات
    ring_timeout INTEGER DEFAULT 30, -- ثواني
    voicemail_enabled BOOLEAN DEFAULT true,
    call_recording BOOLEAN DEFAULT true,
    
    -- إحصائيات (تُحدث دورياً)
    total_calls_today INTEGER DEFAULT 0,
    answered_calls_today INTEGER DEFAULT 0,
    missed_calls_today INTEGER DEFAULT 0,
    avg_call_duration INTEGER DEFAULT 0, -- ثواني
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ucm_ext_unique 
    ON ucm_extensions(ucm_config_id, extension_number);
CREATE INDEX IF NOT EXISTS idx_ucm_ext_employee ON ucm_extensions(employee_id);
CREATE INDEX IF NOT EXISTS idx_ucm_ext_tenant ON ucm_extensions(tenant_id);

ALTER TABLE ucm_extensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucm_extensions_tenant_access" ON ucm_extensions
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 8. توسيع CALL_LOGS — حقول UCM إضافية
-- ═══════════════════════════════════════════════════════════════

-- التحقق وإضافة الأعمدة المفقودة
DO $$
BEGIN
    -- ربط بالتحويلة
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'extension') THEN
        ALTER TABLE call_logs ADD COLUMN extension VARCHAR(10);
    END IF;
    
    -- نوع المكالمة
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'call_type') THEN
        ALTER TABLE call_logs ADD COLUMN call_type VARCHAR(15) DEFAULT 'external'
            CHECK (call_type IN ('inbound', 'outbound', 'internal', 'missed', 'voicemail'));
    END IF;
    
    -- الموظف
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'employee_id') THEN
        ALTER TABLE call_logs ADD COLUMN employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
    END IF;
    
    -- التسجيل
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'has_recording') THEN
        ALTER TABLE call_logs ADD COLUMN has_recording BOOLEAN DEFAULT false;
    END IF;
    
    -- نتيجة المكالمة
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'result') THEN
        ALTER TABLE call_logs ADD COLUMN result VARCHAR(20)
            CHECK (result IN ('booking', 'purchase', 'quotation', 'inquiry', 'rejected', 'callback', 'support', 'complaint'));
    END IF;
    
    -- tags
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'tags') THEN
        ALTER TABLE call_logs ADD COLUMN tags TEXT[];
    END IF;
    
    -- company_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'company_id') THEN
        ALTER TABLE call_logs ADD COLUMN company_id UUID REFERENCES companies(id);
    END IF;
    
    -- department
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'department') THEN
        ALTER TABLE call_logs ADD COLUMN department VARCHAR(100);
    END IF;
    
    -- انتهاء المكالمة
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'ended_at') THEN
        ALTER TABLE call_logs ADD COLUMN ended_at TIMESTAMPTZ;
    END IF;
    
    -- UCM device reference
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'ucm_config_id') THEN
        ALTER TABLE call_logs ADD COLUMN ucm_config_id UUID REFERENCES ucm_config(id) ON DELETE SET NULL;
    END IF;
    
    RAISE NOTICE '✅ call_logs: extended with UCM fields';
END $$;

-- فهارس إضافية
CREATE INDEX IF NOT EXISTS idx_call_logs_employee ON call_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_extension ON call_logs(extension);
CREATE INDEX IF NOT EXISTS idx_call_logs_result ON call_logs(result);


-- ═══════════════════════════════════════════════════════════════
-- 9. توسيع CALL_ANALYSES — تحليل AI أكثر تفصيلاً
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_analyses' AND column_name = 'tenant_id') THEN
        ALTER TABLE call_analyses ADD COLUMN tenant_id UUID REFERENCES tenants(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_analyses' AND column_name = 'sentiment_score') THEN
        ALTER TABLE call_analyses ADD COLUMN sentiment_score INTEGER CHECK (sentiment_score BETWEEN 0 AND 100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_analyses' AND column_name = 'interest_level') THEN
        ALTER TABLE call_analyses ADD COLUMN interest_level VARCHAR(10)
            CHECK (interest_level IN ('high', 'medium', 'low'));
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_analyses' AND column_name = 'booking_probability') THEN
        ALTER TABLE call_analyses ADD COLUMN booking_probability INTEGER CHECK (booking_probability BETWEEN 0 AND 100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_analyses' AND column_name = 'key_points') THEN
        ALTER TABLE call_analyses ADD COLUMN key_points JSONB DEFAULT '[]';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_analyses' AND column_name = 'recommendations') THEN
        ALTER TABLE call_analyses ADD COLUMN recommendations JSONB DEFAULT '[]';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_analyses' AND column_name = 'topics') THEN
        ALTER TABLE call_analyses ADD COLUMN topics TEXT[];
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_analyses' AND column_name = 'agent_performance') THEN
        ALTER TABLE call_analyses ADD COLUMN agent_performance INTEGER CHECK (agent_performance BETWEEN 0 AND 100);
    END IF;
    
    RAISE NOTICE '✅ call_analyses: extended with AI fields';
END $$;


-- ═══════════════════════════════════════════════════════════════
-- TRIGGERS — تحديث updated_at
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'crm_tasks', 'crm_pipeline_stages', 'crm_deals',
        'crm_campaigns', 'ucm_config', 'ucm_extensions'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER set_%s_updated_at 
             BEFORE UPDATE ON %I 
             FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()',
            tbl, tbl
        );
        RAISE NOTICE 'Created trigger for %', tbl;
    END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- DEFAULT DATA — بيانات افتراضية لمراحل Pipeline
-- ═══════════════════════════════════════════════════════════════
-- ملاحظة: سيتم إنشاؤها لكل tenant عند التسجيل، هنا نموذج فقط

CREATE OR REPLACE FUNCTION create_default_pipeline_stages(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
    INSERT INTO crm_pipeline_stages (tenant_id, code, name_ar, name_en, probability, color, display_order, stage_type)
    VALUES
        (p_tenant_id, 'lead',        'عميل محتمل',    'Lead',           10, '#94A3B8', 1, 'active'),
        (p_tenant_id, 'qualified',   'مؤهل',           'Qualified',      25, '#3B82F6', 2, 'active'),
        (p_tenant_id, 'proposal',    'عرض سعر',        'Proposal',       50, '#8B5CF6', 3, 'active'),
        (p_tenant_id, 'negotiation', 'تفاوض',          'Negotiation',    75, '#F59E0B', 4, 'active'),
        (p_tenant_id, 'won',         'تم الفوز',       'Won',            100, '#10B981', 5, 'won'),
        (p_tenant_id, 'lost',        'خسارة',          'Lost',           0,   '#EF4444', 6, 'lost')
    ON CONFLICT DO NOTHING;
END;
$func$;

-- دالة: Create default leave types
CREATE OR REPLACE FUNCTION create_default_leave_types(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
    INSERT INTO leave_types (tenant_id, code, name_ar, name_en, leave_category, max_days_per_year, is_paid, color)
    VALUES
        (p_tenant_id, 'annual',    'إجازة سنوية',      'Annual Leave',     'annual',    21, true,  '#3B82F6'),
        (p_tenant_id, 'sick',      'إجازة مرضية',      'Sick Leave',       'sick',      15, true,  '#EF4444'),
        (p_tenant_id, 'unpaid',    'إجازة بدون راتب',  'Unpaid Leave',     'unpaid',    30, false, '#94A3B8'),
        (p_tenant_id, 'maternity', 'إجازة أمومة',      'Maternity Leave',  'maternity', 70, true,  '#EC4899'),
        (p_tenant_id, 'paternity', 'إجازة أبوة',       'Paternity Leave',  'paternity', 3,  true,  '#8B5CF6'),
        (p_tenant_id, 'emergency', 'إجازة طارئة',      'Emergency Leave',  'emergency', 5,  true,  '#F59E0B'),
        (p_tenant_id, 'hajj',      'إجازة حج',         'Hajj Leave',       'hajj',      15, true,  '#10B981')
    ON CONFLICT DO NOTHING;
END;
$func$;

-- دالة: Create default salary components
CREATE OR REPLACE FUNCTION create_default_salary_components(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
    INSERT INTO salary_components (tenant_id, code, name_ar, name_en, component_type, calculation_type, is_taxable, display_order)
    VALUES
        -- البدلات
        (p_tenant_id, 'basic',        'الراتب الأساسي',   'Basic Salary',         'earning',    'fixed',      true,  1),
        (p_tenant_id, 'housing',      'بدل سكن',          'Housing Allowance',    'earning',    'percentage', true,  2),
        (p_tenant_id, 'transport',    'بدل نقل',          'Transport Allowance',  'earning',    'fixed',      true,  3),
        (p_tenant_id, 'food',         'بدل أكل',          'Food Allowance',       'earning',    'fixed',      false, 4),
        (p_tenant_id, 'phone',        'بدل هاتف',         'Phone Allowance',      'earning',    'fixed',      false, 5),
        (p_tenant_id, 'overtime',     'ساعات إضافية',     'Overtime',             'earning',    'formula',    true,  6),
        (p_tenant_id, 'commission',   'عمولة',             'Commission',           'earning',    'fixed',      true,  7),
        (p_tenant_id, 'bonus',        'مكافأة',            'Bonus',                'earning',    'fixed',      true,  8),
        -- الخصومات
        (p_tenant_id, 'gosi_emp',     'تأمينات (حصة الموظف)',  'GOSI Employee',  'deduction',              'percentage', false, 10),
        (p_tenant_id, 'absence',      'خصم غياب',         'Absence Deduction',    'deduction',              'formula',    false, 11),
        (p_tenant_id, 'late',         'خصم تأخير',        'Late Deduction',       'deduction',              'formula',    false, 12),
        (p_tenant_id, 'loan',         'قسط سلفة',         'Loan Deduction',       'deduction',              'fixed',      false, 13),
        -- مساهمات صاحب العمل
        (p_tenant_id, 'gosi_empr',    'تأمينات (حصة صاحب العمل)', 'GOSI Employer', 'employer_contribution', 'percentage', false, 20)
    ON CONFLICT DO NOTHING;
END;
$func$;


-- ═══════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════';
    RAISE NOTICE '✅ CRM + UCM MODULE — Phase 2 Complete';
    RAISE NOTICE '   New: crm_tasks, crm_pipeline_stages, crm_deals,';
    RAISE NOTICE '   crm_campaigns, crm_campaign_contacts,';
    RAISE NOTICE '   ucm_config, ucm_extensions';
    RAISE NOTICE '   Extended: call_logs (+10 cols), call_analyses (+8 cols)';
    RAISE NOTICE '   Defaults: pipeline_stages, leave_types, salary_components';
    RAISE NOTICE '══════════════════════════════════════════════════';
END $$;
