-- ═══════════════════════════════════════════════════════════════════
-- 🏦 Exchange & Remittance Module — Phase 1: Infrastructure
-- TexaCore ERP — Migration: 2026-03-18
-- 
-- Creates 9 tables + RLS + Triggers + Indexes
-- All tables are Group D (tenant_id + company_id)
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. exchange_agents — وكلاء الصرافة ═══
-- (مختلف عن agents في SaaS — هؤلاء وكلاء خارجيون لتسليم الحوالات)
CREATE TABLE IF NOT EXISTS public.exchange_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    branch_id UUID REFERENCES public.branches(id),
    code TEXT NOT NULL,
    agent_type TEXT CHECK (agent_type IN ('individual', 'company')) DEFAULT 'individual',
    
    -- الأسماء متعددة اللغات
    name_ar TEXT NOT NULL,
    name_en TEXT,
    name_tr TEXT,
    name_ru TEXT,
    name_uk TEXT,
    
    -- التواصل والموقع
    country TEXT,
    city TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    
    -- المالي
    currencies TEXT[] DEFAULT '{}',
    commission_rate NUMERIC(6,4) DEFAULT 0,
    credit_limit NUMERIC(18,4) DEFAULT 0,
    payable_account_id UUID REFERENCES public.chart_of_accounts(id),
    
    -- المطابقة
    last_reconciliation_date TIMESTAMPTZ,
    
    -- الحالة
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    notes TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_agents_tenant ON public.exchange_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exchange_agents_company ON public.exchange_agents(company_id);
CREATE INDEX IF NOT EXISTS idx_exchange_agents_code ON public.exchange_agents(tenant_id, company_id, code);
CREATE INDEX IF NOT EXISTS idx_exchange_agents_status ON public.exchange_agents(status);

-- ═══ 2. exchange_partners — الشركاء ═══
CREATE TABLE IF NOT EXISTS public.exchange_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    code TEXT NOT NULL,
    partner_type TEXT CHECK (partner_type IN (
        'correspondent', 'exchange_house', 'bank', 'fintech', 'agent_network'
    )) DEFAULT 'exchange_house',
    
    -- الأسماء
    name_ar TEXT NOT NULL,
    name_en TEXT,
    name_tr TEXT,
    name_ru TEXT,
    name_uk TEXT,
    
    -- معلومات الشركة
    license_number TEXT,
    countries TEXT[] DEFAULT '{}',
    currencies TEXT[] DEFAULT '{}',
    phone TEXT,
    email TEXT,
    website TEXT,
    address TEXT,
    
    -- الاتفاقية
    agreement_type TEXT CHECK (agreement_type IN (
        'commission', 'flat_fee', 'spread', 'hybrid'
    )) DEFAULT 'commission',
    commission_rate NUMERIC(6,4) DEFAULT 0,
    credit_limit NUMERIC(18,4) DEFAULT 0,
    settlement_period TEXT DEFAULT 'weekly' CHECK (settlement_period IN (
        'daily', 'weekly', 'biweekly', 'monthly'
    )),
    contract_start DATE,
    contract_end DATE,
    
    -- المحاسبة
    payable_account_id UUID REFERENCES public.chart_of_accounts(id),
    
    -- الأداء
    success_rate NUMERIC(5,2) DEFAULT 100,
    avg_processing_hours NUMERIC(6,2) DEFAULT 0,
    
    -- المطابقة والتسوية
    last_reconciliation_date TIMESTAMPTZ,
    last_settlement_date TIMESTAMPTZ,
    next_settlement_date TIMESTAMPTZ,
    
    -- الحالة
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'under_review')),
    notes TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_partners_tenant ON public.exchange_partners(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exchange_partners_company ON public.exchange_partners(company_id);
CREATE INDEX IF NOT EXISTS idx_exchange_partners_code ON public.exchange_partners(tenant_id, company_id, code);

-- ═══ 3. exchange_transactions — عمليات الصرافة ═══
CREATE TABLE IF NOT EXISTS public.exchange_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    branch_id UUID REFERENCES public.branches(id),
    transaction_number TEXT NOT NULL,
    transaction_date TIMESTAMPTZ DEFAULT NOW(),
    transaction_type TEXT CHECK (transaction_type IN ('buy', 'sell')) NOT NULL,
    
    -- الزبون
    customer_id UUID REFERENCES public.customers(id),
    customer_name TEXT,
    customer_phone TEXT,
    customer_id_type TEXT,
    customer_id_number TEXT,
    
    -- تفاصيل الصرف
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    from_amount NUMERIC(18,4) NOT NULL,
    to_amount NUMERIC(18,4) NOT NULL,
    exchange_rate NUMERIC(18,6) NOT NULL,
    market_rate NUMERIC(18,6),
    rate_margin NUMERIC(6,4),
    
    -- العمولة والربح
    commission_amount NUMERIC(18,4) DEFAULT 0,
    profit_amount NUMERIC(18,4) DEFAULT 0,
    
    -- الدفع
    fund_id UUID REFERENCES public.chart_of_accounts(id),
    payment_method TEXT DEFAULT 'cash',
    
    -- المحاسبة
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    
    -- المطابقة
    last_reconciliation_date TIMESTAMPTZ,
    is_reconciled BOOLEAN DEFAULT false,
    
    -- الحالة
    status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled', 'pending')),
    notes TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_txn_tenant ON public.exchange_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exchange_txn_company ON public.exchange_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_exchange_txn_number ON public.exchange_transactions(tenant_id, company_id, transaction_number);
CREATE INDEX IF NOT EXISTS idx_exchange_txn_date ON public.exchange_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_exchange_txn_customer ON public.exchange_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_exchange_txn_branch ON public.exchange_transactions(branch_id);

-- ═══ 4. remittances — الحوالات ═══
CREATE TABLE IF NOT EXISTS public.remittances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    branch_id UUID REFERENCES public.branches(id),
    remittance_number TEXT NOT NULL,
    remittance_type TEXT CHECK (remittance_type IN ('outgoing', 'incoming')) NOT NULL,
    remittance_date TIMESTAMPTZ DEFAULT NOW(),
    
    -- المرسل
    sender_customer_id UUID REFERENCES public.customers(id),
    sender_name TEXT NOT NULL,
    sender_phone TEXT,
    sender_id_type TEXT,
    sender_id_number TEXT,
    sender_country TEXT,
    sender_city TEXT,
    sender_address TEXT,
    
    -- المستلم
    receiver_name TEXT NOT NULL,
    receiver_phone TEXT,
    receiver_id_type TEXT,
    receiver_id_number TEXT,
    receiver_country TEXT,
    receiver_city TEXT,
    receiver_address TEXT,
    receiver_bank_name TEXT,
    receiver_bank_account TEXT,
    receiver_wallet TEXT,
    
    -- تفاصيل الحوالة
    send_currency TEXT NOT NULL,
    send_amount NUMERIC(18,4) NOT NULL,
    receive_currency TEXT NOT NULL,
    receive_amount NUMERIC(18,4) NOT NULL,
    exchange_rate NUMERIC(18,6),
    
    -- الرسوم
    commission_amount NUMERIC(18,4) DEFAULT 0,
    commission_bearer TEXT DEFAULT 'sender' CHECK (commission_bearer IN ('sender', 'receiver', 'split')),
    total_paid NUMERIC(18,4),
    
    -- الوسيط
    agent_id UUID REFERENCES public.exchange_agents(id),
    partner_id UUID REFERENCES public.exchange_partners(id),
    delivery_method TEXT DEFAULT 'branch' CHECK (delivery_method IN ('branch', 'agent', 'bank', 'wallet')),
    
    -- الحالة
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'sent', 'delivered', 'completed', 'cancelled', 'returned'
    )),
    purpose TEXT,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'vip')),
    
    -- المحاسبة
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    fund_id UUID REFERENCES public.chart_of_accounts(id),
    
    -- المطابقة
    last_reconciliation_date TIMESTAMPTZ,
    is_reconciled BOOLEAN DEFAULT false,
    
    notes TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remittances_tenant ON public.remittances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_remittances_company ON public.remittances(company_id);
CREATE INDEX IF NOT EXISTS idx_remittances_number ON public.remittances(tenant_id, company_id, remittance_number);
CREATE INDEX IF NOT EXISTS idx_remittances_date ON public.remittances(remittance_date DESC);
CREATE INDEX IF NOT EXISTS idx_remittances_status ON public.remittances(status);
CREATE INDEX IF NOT EXISTS idx_remittances_sender ON public.remittances(sender_customer_id);
CREATE INDEX IF NOT EXISTS idx_remittances_agent ON public.remittances(agent_id);
CREATE INDEX IF NOT EXISTS idx_remittances_partner ON public.remittances(partner_id);
CREATE INDEX IF NOT EXISTS idx_remittances_branch ON public.remittances(branch_id);

-- ═══ 5. remittance_tracking — تتبع حالة الحوالة ═══
CREATE TABLE IF NOT EXISTS public.remittance_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    remittance_id UUID NOT NULL REFERENCES public.remittances(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    notes TEXT,
    location TEXT,
    updated_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remittance_tracking_remittance ON public.remittance_tracking(remittance_id);
CREATE INDEX IF NOT EXISTS idx_remittance_tracking_tenant ON public.remittance_tracking(tenant_id);

-- ═══ 6. exchange_commission_rules — قواعد العمولات ═══
CREATE TABLE IF NOT EXISTS public.exchange_commission_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    rule_type TEXT CHECK (rule_type IN ('remittance', 'exchange', 'agent')) NOT NULL,
    currency TEXT,
    destination_country TEXT,
    min_amount NUMERIC(18,4) DEFAULT 0,
    max_amount NUMERIC(18,4),
    fixed_fee NUMERIC(18,4) DEFAULT 0,
    percentage NUMERIC(6,4) DEFAULT 0,
    description_ar TEXT,
    description_en TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_commission_tenant ON public.exchange_commission_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exchange_commission_company ON public.exchange_commission_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_exchange_commission_type ON public.exchange_commission_rules(rule_type, is_active);

-- ═══ 7. exchange_reconciliations — المطابقات ═══
CREATE TABLE IF NOT EXISTS public.exchange_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('customer', 'agent', 'partner')),
    entity_id UUID NOT NULL,
    reconciliation_date TIMESTAMPTZ DEFAULT NOW(),
    period_from DATE,
    period_to DATE,
    our_balance NUMERIC(18,4),
    their_balance NUMERIC(18,4),
    difference NUMERIC(18,4),
    status TEXT DEFAULT 'matched' CHECK (status IN ('matched', 'discrepancy', 'pending', 'resolved')),
    notes TEXT,
    reconciled_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_recon_tenant ON public.exchange_reconciliations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exchange_recon_company ON public.exchange_reconciliations(company_id);
CREATE INDEX IF NOT EXISTS idx_exchange_recon_entity ON public.exchange_reconciliations(entity_type, entity_id);

-- ═══ 8. exchange_settings — إعدادات القسم ═══
CREATE TABLE IF NOT EXISTS public.exchange_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    
    -- إعدادات عامة
    default_currency TEXT DEFAULT 'USD',
    profit_margin_percent NUMERIC(6,4) DEFAULT 1.0,
    auto_post_transactions BOOLEAN DEFAULT true,
    auto_post_remittances BOOLEAN DEFAULT true,
    
    -- حدود المعاملات
    daily_limit_per_customer NUMERIC(18,4),
    monthly_limit_per_customer NUMERIC(18,4),
    single_transaction_limit NUMERIC(18,4),
    
    -- تسلسل الترقيم
    remittance_numbering_format TEXT DEFAULT 'RM-{YYYY}-{NNNNN}',
    exchange_numbering_format TEXT DEFAULT 'EX-{YYYY}-{NNNNN}',
    exchange_number_counter INTEGER DEFAULT 0,
    remittance_number_counter INTEGER DEFAULT 0,
    
    -- الحسابات المحاسبية الافتراضية
    currency_gain_account_id UUID REFERENCES public.chart_of_accounts(id),
    currency_loss_account_id UUID REFERENCES public.chart_of_accounts(id),
    commission_revenue_account_id UUID REFERENCES public.chart_of_accounts(id),
    agent_payable_account_id UUID REFERENCES public.chart_of_accounts(id),
    partner_payable_account_id UUID REFERENCES public.chart_of_accounts(id),
    remittance_receivable_account_id UUID REFERENCES public.chart_of_accounts(id),
    
    -- تخصيصات
    id_types JSONB DEFAULT '["passport","national_id","residence","driving_license"]',
    purposes JSONB DEFAULT '["family","commercial","education","medical","other"]',
    delivery_methods JSONB DEFAULT '["branch","agent","bank","wallet"]',
    supported_countries JSONB DEFAULT '[]',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_exchange_settings_tenant ON public.exchange_settings(tenant_id);

-- ═══ 9. daily_audits — سجل الجرد اليومي ═══
CREATE TABLE IF NOT EXISTS public.daily_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    branch_id UUID REFERENCES public.branches(id),
    fund_id UUID NOT NULL REFERENCES public.chart_of_accounts(id),
    audit_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- بيانات الجرد لكل عملة (JSONB array)
    -- [{currency: "SAR", opening: 150000, in: 25000, out: 12000, expected: 163000, actual: 162500, diff: -500}]
    audit_lines JSONB NOT NULL DEFAULT '[]',
    
    -- الإجمالي
    total_expected NUMERIC(18,4) DEFAULT 0,
    total_actual NUMERIC(18,4) DEFAULT 0,
    total_difference NUMERIC(18,4) DEFAULT 0,
    
    -- القيد المحاسبي (لتسجيل الفروقات)
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    notes TEXT,
    audited_by UUID REFERENCES auth.users(id),
    confirmed_by UUID REFERENCES auth.users(id),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, fund_id, audit_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_audits_tenant ON public.daily_audits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_daily_audits_company ON public.daily_audits(company_id);
CREATE INDEX IF NOT EXISTS idx_daily_audits_fund ON public.daily_audits(fund_id, audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_audits_branch ON public.daily_audits(branch_id);


-- ═══════════════════════════════════════════════════════════════════
-- RLS — تفعيل وإنشاء السياسات
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.exchange_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittance_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_audits ENABLE ROW LEVEL SECURITY;

-- إنشاء سياسات RLS الموحدة (المجموعة د — tenant + company)
SELECT create_company_rls_policies('exchange_agents', true, true);
SELECT create_company_rls_policies('exchange_partners', true, true);
SELECT create_company_rls_policies('exchange_transactions', true, true);
SELECT create_company_rls_policies('remittances', true, true);
SELECT create_company_rls_policies('remittance_tracking', true, true);
SELECT create_company_rls_policies('exchange_commission_rules', true, true);
SELECT create_company_rls_policies('exchange_reconciliations', true, true);
SELECT create_company_rls_policies('exchange_settings', true, true);
SELECT create_company_rls_policies('daily_audits', true, true);


-- ═══════════════════════════════════════════════════════════════════
-- Triggers — التعيين التلقائي
-- ═══════════════════════════════════════════════════════════════════

SELECT apply_auto_tenant_trigger('exchange_agents');
SELECT apply_auto_tenant_trigger('exchange_partners');
SELECT apply_auto_tenant_trigger('exchange_transactions');
SELECT apply_auto_tenant_trigger('remittances');
SELECT apply_auto_tenant_trigger('remittance_tracking');
SELECT apply_auto_tenant_trigger('exchange_commission_rules');
SELECT apply_auto_tenant_trigger('exchange_reconciliations');
SELECT apply_auto_tenant_trigger('exchange_settings');
SELECT apply_auto_tenant_trigger('daily_audits');

SELECT apply_auto_company_trigger('exchange_agents');
SELECT apply_auto_company_trigger('exchange_partners');
SELECT apply_auto_company_trigger('exchange_transactions');
SELECT apply_auto_company_trigger('remittances');
SELECT apply_auto_company_trigger('remittance_tracking');
SELECT apply_auto_company_trigger('exchange_commission_rules');
SELECT apply_auto_company_trigger('exchange_reconciliations');
SELECT apply_auto_company_trigger('exchange_settings');
SELECT apply_auto_company_trigger('daily_audits');

SELECT apply_brand_isolation_trigger('exchange_agents');
SELECT apply_brand_isolation_trigger('exchange_partners');
SELECT apply_brand_isolation_trigger('exchange_transactions');
SELECT apply_brand_isolation_trigger('remittances');
SELECT apply_brand_isolation_trigger('remittance_tracking');
SELECT apply_brand_isolation_trigger('exchange_commission_rules');
SELECT apply_brand_isolation_trigger('exchange_reconciliations');
SELECT apply_brand_isolation_trigger('exchange_settings');
SELECT apply_brand_isolation_trigger('daily_audits');


-- ═══════════════════════════════════════════════════════════════════
-- ✅ Verification Query
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
    pol_count INT;
    trg_count INT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'exchange_agents', 'exchange_partners', 'exchange_transactions',
        'remittances', 'remittance_tracking', 'exchange_commission_rules',
        'exchange_reconciliations', 'exchange_settings', 'daily_audits'
    ]
    LOOP
        SELECT COUNT(*) INTO pol_count FROM pg_policies WHERE tablename = tbl;
        SELECT COUNT(*) INTO trg_count FROM information_schema.triggers WHERE event_object_table = tbl;
        RAISE NOTICE '✅ % — % policies, % triggers', tbl, pol_count, trg_count;
    END LOOP;
END $$;
