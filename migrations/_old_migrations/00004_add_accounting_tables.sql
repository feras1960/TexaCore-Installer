-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة جداول المحاسبة الجديدة
-- Migration: Add New Accounting Tables
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 0. حذف الجداول القديمة إذا وجدت (لإعادة الإنشاء بشكل صحيح)
-- Drop old tables if they exist (to recreate correctly)
-- ═══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS journal_entry_lines CASCADE;
DROP TABLE IF EXISTS journal_entries CASCADE;
DROP TABLE IF EXISTS cash_transactions CASCADE;
DROP TABLE IF EXISTS cash_accounts CASCADE;
DROP TABLE IF EXISTS cost_centers CASCADE;
DROP TABLE IF EXISTS tax_rates CASCADE;
DROP TABLE IF EXISTS accounting_periods CASCADE;
DROP TABLE IF EXISTS fiscal_years CASCADE;
DROP TABLE IF EXISTS chart_of_accounts CASCADE;
DROP TABLE IF EXISTS account_types CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 1. أنواع الحسابات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS account_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    classification VARCHAR(50) NOT NULL,
    normal_balance VARCHAR(10) NOT NULL,
    display_order INT DEFAULT 0,
    is_system BOOLEAN DEFAULT true
);

-- إدراج أنواع الحسابات الافتراضية
INSERT INTO account_types (code, name_ar, name_en, classification, normal_balance, display_order) VALUES
('ASSET', 'الأصول', 'Assets', 'assets', 'debit', 1),
('CURRENT_ASSET', 'الأصول المتداولة', 'Current Assets', 'assets', 'debit', 2),
('FIXED_ASSET', 'الأصول الثابتة', 'Fixed Assets', 'assets', 'debit', 3),
('LIABILITY', 'الالتزامات', 'Liabilities', 'liabilities', 'credit', 10),
('CURRENT_LIABILITY', 'الالتزامات المتداولة', 'Current Liabilities', 'liabilities', 'credit', 11),
('LONG_TERM_LIABILITY', 'الالتزامات طويلة الأجل', 'Long-term Liabilities', 'liabilities', 'credit', 12),
('EQUITY', 'حقوق الملكية', 'Equity', 'equity', 'credit', 20),
('REVENUE', 'الإيرادات', 'Revenue', 'income', 'credit', 30),
('EXPENSE', 'المصروفات', 'Expenses', 'expenses', 'debit', 40),
('COGS', 'تكلفة البضاعة المباعة', 'Cost of Goods Sold', 'expenses', 'debit', 41),
('OTHER_INCOME', 'إيرادات أخرى', 'Other Income', 'income', 'credit', 50),
('OTHER_EXPENSE', 'مصروفات أخرى', 'Other Expenses', 'expenses', 'debit', 51)
;

-- ═══════════════════════════════════════════════════════════════
-- 2. دليل الحسابات (بدلاً من accounts)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    account_code VARCHAR(50) NOT NULL,
    -- Multi-language support (9 languages)
    name_ar VARCHAR(200) NOT NULL,    -- Arabic العربية
    name_en VARCHAR(200),              -- English
    name_ru VARCHAR(200),              -- Russian Русский
    name_uk VARCHAR(200),              -- Ukrainian Українська
    name_ro VARCHAR(200),              -- Romanian Română
    name_pl VARCHAR(200),              -- Polish Polski
    name_tr VARCHAR(200),              -- Turkish Türkçe
    name_de VARCHAR(200),              -- German Deutsch
    name_it VARCHAR(200),              -- Italian Italiano
    
    account_type_id UUID NOT NULL REFERENCES account_types(id),
    parent_id UUID REFERENCES chart_of_accounts(id),
    
    is_group BOOLEAN DEFAULT false,
    is_detail BOOLEAN DEFAULT true,
    level INT DEFAULT 1,
    full_code VARCHAR(200),
    
    currency VARCHAR(3),
    is_multi_currency BOOLEAN DEFAULT false,
    
    is_bank_account BOOLEAN DEFAULT false,
    bank_name VARCHAR(200),
    bank_account_number VARCHAR(100),
    
    is_cash_account BOOLEAN DEFAULT false,
    is_receivable BOOLEAN DEFAULT false,
    is_payable BOOLEAN DEFAULT false,
    
    opening_balance DECIMAL(15,2) DEFAULT 0,
    current_balance DECIMAL(15,2) DEFAULT 0,
    
    description TEXT,
    notes TEXT,
    
    is_system BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, account_code)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. السنوات المالية والفترات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fiscal_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL,
    
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
    is_current BOOLEAN DEFAULT false,
    is_closed BOOLEAN DEFAULT false,
    closed_at TIMESTAMPTZ,
    closed_by UUID,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS accounting_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    period_number INT NOT NULL,
    
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
    is_closed BOOLEAN DEFAULT false,
    closed_at TIMESTAMPTZ,
    closed_by UUID,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(fiscal_year_id, period_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 4. القيود اليومية
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id),
    
    entry_number VARCHAR(50) NOT NULL,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    fiscal_year_id UUID REFERENCES fiscal_years(id),
    period_id UUID REFERENCES accounting_periods(id),
    
    entry_type VARCHAR(30) DEFAULT 'manual',
    
    reference_type VARCHAR(50),
    reference_id UUID,
    reference_number VARCHAR(100),
    
    description TEXT NOT NULL,
    
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    
    total_debit DECIMAL(15,2) DEFAULT 0,
    total_credit DECIMAL(15,2) DEFAULT 0,
    
    status VARCHAR(20) DEFAULT 'draft',
    
    is_posted BOOLEAN DEFAULT false,
    posted_at TIMESTAMPTZ,
    posted_by UUID,
    
    is_reversed BOOLEAN DEFAULT false,
    reversed_at TIMESTAMPTZ,
    reversed_by UUID,
    reversal_entry_id UUID REFERENCES journal_entries(id),
    original_entry_id UUID REFERENCES journal_entries(id),
    
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, entry_number)
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    
    line_number INT DEFAULT 1,
    
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    
    debit DECIMAL(15,2) DEFAULT 0,
    credit DECIMAL(15,2) DEFAULT 0,
    
    currency VARCHAR(3),
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    debit_fc DECIMAL(15,2) DEFAULT 0,
    credit_fc DECIMAL(15,2) DEFAULT 0,
    
    description TEXT,
    
    cost_center_id UUID,
    
    party_type VARCHAR(20),
    party_id UUID,
    
    reference_type VARCHAR(50),
    reference_id UUID,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT chk_debit_or_credit CHECK (
        (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0) OR (debit = 0 AND credit = 0)
    )
);

-- ═══════════════════════════════════════════════════════════════
-- 5. مراكز التكلفة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    parent_id UUID REFERENCES cost_centers(id),
    
    is_group BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 6. الخزائن والصناديق
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cash_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id),
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    account_type VARCHAR(20) NOT NULL,
    
    gl_account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    
    bank_name VARCHAR(200),
    bank_branch VARCHAR(200),
    account_number VARCHAR(100),
    iban VARCHAR(50),
    swift_code VARCHAR(20),
    
    currency VARCHAR(3) DEFAULT 'USD',
    current_balance DECIMAL(15,2) DEFAULT 0,
    
    custodian_id UUID,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS cash_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id),
    
    transaction_number VARCHAR(50) NOT NULL,
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    transaction_type VARCHAR(20) NOT NULL,
    
    cash_account_id UUID NOT NULL REFERENCES cash_accounts(id),
    to_cash_account_id UUID REFERENCES cash_accounts(id),
    
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    
    party_type VARCHAR(20),
    party_id UUID,
    party_name VARCHAR(200),
    
    contra_account_id UUID REFERENCES chart_of_accounts(id),
    
    payment_method VARCHAR(50),
    check_number VARCHAR(50),
    check_date DATE,
    
    reference_type VARCHAR(50),
    reference_id UUID,
    reference_number VARCHAR(100),
    
    description TEXT,
    
    journal_entry_id UUID REFERENCES journal_entries(id),
    
    status VARCHAR(20) DEFAULT 'confirmed',
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, transaction_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 7. إعدادات الضرائب
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tax_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    rate DECIMAL(5,2) NOT NULL,
    tax_type VARCHAR(20) DEFAULT 'vat',
    
    sales_account_id UUID REFERENCES chart_of_accounts(id),
    purchase_account_id UUID REFERENCES chart_of_accounts(id),
    
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 8. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_tenant ON chart_of_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_company ON chart_of_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_code ON chart_of_accounts(tenant_id, company_id, account_code);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_parent ON chart_of_accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_type ON chart_of_accounts(account_type_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant ON journal_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_posted ON journal_entries(is_posted);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reference ON journal_entries(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON journal_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON journal_entry_lines(account_id);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_account ON cash_transactions(cash_account_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_date ON cash_transactions(transaction_date);

-- ═══════════════════════════════════════════════════════════════
-- 9. RLS Policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view chart of accounts" ON chart_of_accounts;
DROP POLICY IF EXISTS "Users can view journal entries" ON journal_entries;
DROP POLICY IF EXISTS "Users can view journal entry lines" ON journal_entry_lines;
DROP POLICY IF EXISTS "Users can view cost centers" ON cost_centers;
DROP POLICY IF EXISTS "Users can view cash accounts" ON cash_accounts;
DROP POLICY IF EXISTS "Users can view cash transactions" ON cash_transactions;
DROP POLICY IF EXISTS "Users can view tax rates" ON tax_rates;
DROP POLICY IF EXISTS "Users can view fiscal years" ON fiscal_years;
DROP POLICY IF EXISTS "Users can view accounting periods" ON accounting_periods;

-- Allow all for authenticated users (simplified for multi-tenant)
DROP POLICY IF EXISTS "Enable all for authenticated users - chart_of_accounts" ON chart_of_accounts;
DROP POLICY IF EXISTS "Enable all for authenticated users - journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "Enable all for authenticated users - journal_entry_lines" ON journal_entry_lines;
DROP POLICY IF EXISTS "Enable all for authenticated users - cost_centers" ON cost_centers;
DROP POLICY IF EXISTS "Enable all for authenticated users - cash_accounts" ON cash_accounts;
DROP POLICY IF EXISTS "Enable all for authenticated users - cash_transactions" ON cash_transactions;
DROP POLICY IF EXISTS "Enable all for authenticated users - tax_rates" ON tax_rates;
DROP POLICY IF EXISTS "Enable all for authenticated users - fiscal_years" ON fiscal_years;
DROP POLICY IF EXISTS "Enable all for authenticated users - accounting_periods" ON accounting_periods;

-- Chart of Accounts - Full access for authenticated users
CREATE POLICY "Enable all for authenticated users - chart_of_accounts" ON chart_of_accounts
    FOR ALL USING (true) WITH CHECK (true);

-- Journal Entries - Full access for authenticated users  
CREATE POLICY "Enable all for authenticated users - journal_entries" ON journal_entries
    FOR ALL USING (true) WITH CHECK (true);

-- Journal Entry Lines - Full access for authenticated users
CREATE POLICY "Enable all for authenticated users - journal_entry_lines" ON journal_entry_lines
    FOR ALL USING (true) WITH CHECK (true);

-- Cost Centers - Full access for authenticated users
CREATE POLICY "Enable all for authenticated users - cost_centers" ON cost_centers
    FOR ALL USING (true) WITH CHECK (true);

-- Cash Accounts - Full access for authenticated users
CREATE POLICY "Enable all for authenticated users - cash_accounts" ON cash_accounts
    FOR ALL USING (true) WITH CHECK (true);

-- Cash Transactions - Full access for authenticated users
CREATE POLICY "Enable all for authenticated users - cash_transactions" ON cash_transactions
    FOR ALL USING (true) WITH CHECK (true);

-- Tax Rates - Full access for authenticated users
CREATE POLICY "Enable all for authenticated users - tax_rates" ON tax_rates
    FOR ALL USING (true) WITH CHECK (true);

-- Fiscal Years - Full access for authenticated users
CREATE POLICY "Enable all for authenticated users - fiscal_years" ON fiscal_years
    FOR ALL USING (true) WITH CHECK (true);

-- Accounting Periods - Full access for authenticated users
CREATE POLICY "Enable all for authenticated users - accounting_periods" ON accounting_periods
    FOR ALL USING (true) WITH CHECK (true);
