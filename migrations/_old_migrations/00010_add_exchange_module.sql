-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة موديول الصرافة والحوالات (اختياري)
-- Migration: Add Exchange and Remittances Module (Optional)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. أسعار الصرف
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    
    buy_rate DECIMAL(18,8) NOT NULL,
    sell_rate DECIMAL(18,8) NOT NULL,
    mid_rate DECIMAL(18,8) GENERATED ALWAYS AS ((buy_rate + sell_rate) / 2) STORED,
    
    margin_percent DECIMAL(5,2) DEFAULT 0,
    
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    
    source VARCHAR(50) DEFAULT 'manual',
    
    is_active BOOLEAN DEFAULT true,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. عمليات الصرف
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS exchange_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    transaction_number VARCHAR(50) NOT NULL,
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    transaction_time TIME DEFAULT CURRENT_TIME,
    
    transaction_type VARCHAR(20) NOT NULL,
    
    customer_id UUID REFERENCES customers(id),
    customer_name VARCHAR(200),
    customer_phone VARCHAR(50),
    customer_id_type VARCHAR(50),
    customer_id_number VARCHAR(100),
    
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    
    from_amount DECIMAL(15,2) NOT NULL,
    to_amount DECIMAL(15,2) NOT NULL,
    
    exchange_rate DECIMAL(18,8) NOT NULL,
    
    commission_amount DECIMAL(15,2) DEFAULT 0,
    commission_percent DECIMAL(5,2) DEFAULT 0,
    
    net_amount DECIMAL(15,2) NOT NULL,
    
    cash_account_id UUID REFERENCES cash_accounts(id),
    
    journal_entry_id UUID REFERENCES journal_entries(id),
    
    status VARCHAR(20) DEFAULT 'completed',
    
    notes TEXT,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, transaction_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. الوكلاء والمراسلين
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS exchange_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    agent_type VARCHAR(20) DEFAULT 'agent',
    
    country VARCHAR(100),
    city VARCHAR(100),
    address TEXT,
    phone VARCHAR(50),
    mobile VARCHAR(50),
    email VARCHAR(200),
    
    supported_currencies JSONB DEFAULT '[]',
    
    default_commission_percent DECIMAL(5,2) DEFAULT 0,
    commission_type VARCHAR(20) DEFAULT 'percent',
    
    gl_account_id UUID REFERENCES chart_of_accounts(id),
    
    balances JSONB DEFAULT '{}',
    
    daily_limit DECIMAL(15,2),
    monthly_limit DECIMAL(15,2),
    single_transaction_limit DECIMAL(15,2),
    
    license_number VARCHAR(100),
    license_expiry DATE,
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 4. الحوالات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS remittances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    remittance_number VARCHAR(50) NOT NULL,
    remittance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    remittance_time TIME DEFAULT CURRENT_TIME,
    
    remittance_type VARCHAR(20) NOT NULL,
    
    agent_id UUID REFERENCES exchange_agents(id),
    agent_name VARCHAR(200),
    
    sender_name VARCHAR(200) NOT NULL,
    sender_phone VARCHAR(50),
    sender_id_type VARCHAR(50),
    sender_id_number VARCHAR(100),
    sender_country VARCHAR(100),
    sender_city VARCHAR(100),
    sender_address TEXT,
    
    receiver_name VARCHAR(200) NOT NULL,
    receiver_phone VARCHAR(50) NOT NULL,
    receiver_id_type VARCHAR(50),
    receiver_id_number VARCHAR(100),
    receiver_country VARCHAR(100),
    receiver_city VARCHAR(100),
    receiver_address TEXT,
    
    send_currency VARCHAR(3) NOT NULL,
    send_amount DECIMAL(15,2) NOT NULL,
    
    receive_currency VARCHAR(3) NOT NULL,
    receive_amount DECIMAL(15,2) NOT NULL,
    
    exchange_rate DECIMAL(18,8) NOT NULL,
    
    commission_amount DECIMAL(15,2) DEFAULT 0,
    transfer_fee DECIMAL(15,2) DEFAULT 0,
    agent_commission DECIMAL(15,2) DEFAULT 0,
    
    total_amount DECIMAL(15,2) NOT NULL,
    
    secret_code VARCHAR(20),
    
    delivery_method VARCHAR(50) DEFAULT 'cash',
    
    bank_name VARCHAR(200),
    bank_branch VARCHAR(200),
    bank_account VARCHAR(100),
    bank_iban VARCHAR(50),
    
    status VARCHAR(20) DEFAULT 'pending',
    
    paid_at TIMESTAMPTZ,
    paid_by UUID,
    paid_amount DECIMAL(15,2),
    paid_currency VARCHAR(3),
    
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    cancel_reason TEXT,
    
    journal_entry_id UUID REFERENCES journal_entries(id),
    
    expires_at TIMESTAMPTZ,
    
    notes TEXT,
    internal_notes TEXT,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, remittance_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 5. خزائن العملات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS currency_vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    currency VARCHAR(3) NOT NULL,
    
    current_balance DECIMAL(15,2) DEFAULT 0,
    
    min_balance DECIMAL(15,2) DEFAULT 0,
    max_balance DECIMAL(15,2),
    
    gl_account_id UUID REFERENCES chart_of_accounts(id),
    custodian_id UUID REFERENCES user_profiles(id),
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS vault_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    vault_id UUID NOT NULL REFERENCES currency_vaults(id) ON DELETE CASCADE,
    
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    movement_time TIME DEFAULT CURRENT_TIME,
    
    movement_type VARCHAR(30) NOT NULL,
    
    amount DECIMAL(15,2) NOT NULL,
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    
    reference_type VARCHAR(50),
    reference_id UUID,
    reference_number VARCHAR(100),
    
    to_vault_id UUID REFERENCES currency_vaults(id),
    
    description TEXT,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 6. أرصدة الوكلاء
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    agent_id UUID NOT NULL REFERENCES exchange_agents(id) ON DELETE CASCADE,
    currency VARCHAR(3) NOT NULL,
    
    current_balance DECIMAL(15,2) DEFAULT 0,
    
    credit_limit DECIMAL(15,2) DEFAULT 0,
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(agent_id, currency)
);

CREATE TABLE IF NOT EXISTS agent_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    agent_id UUID NOT NULL REFERENCES exchange_agents(id),
    currency VARCHAR(3) NOT NULL,
    
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    movement_type VARCHAR(30) NOT NULL,
    
    amount DECIMAL(15,2) NOT NULL,
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    
    reference_type VARCHAR(50),
    reference_id UUID,
    reference_number VARCHAR(100),
    
    description TEXT,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    
    settlement_number VARCHAR(50) NOT NULL,
    settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    agent_id UUID NOT NULL REFERENCES exchange_agents(id),
    
    currency VARCHAR(3) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    
    settlement_type VARCHAR(20) NOT NULL,
    payment_method VARCHAR(50),
    
    bank_reference VARCHAR(100),
    
    journal_entry_id UUID REFERENCES journal_entries(id),
    
    status VARCHAR(20) DEFAULT 'confirmed',
    
    notes TEXT,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, settlement_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 7. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_exchange_rates_currencies ON exchange_rates(from_currency, to_currency);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_effective ON exchange_rates(effective_from);

CREATE INDEX IF NOT EXISTS idx_exchange_transactions_tenant ON exchange_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exchange_transactions_date ON exchange_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_exchange_transactions_customer ON exchange_transactions(customer_id);

CREATE INDEX IF NOT EXISTS idx_remittances_tenant ON remittances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_remittances_number ON remittances(tenant_id, remittance_number);
CREATE INDEX IF NOT EXISTS idx_remittances_date ON remittances(remittance_date);
CREATE INDEX IF NOT EXISTS idx_remittances_status ON remittances(status);
CREATE INDEX IF NOT EXISTS idx_remittances_agent ON remittances(agent_id);
CREATE INDEX IF NOT EXISTS idx_remittances_secret ON remittances(secret_code);

CREATE INDEX IF NOT EXISTS idx_vault_movements_vault ON vault_movements(vault_id);
CREATE INDEX IF NOT EXISTS idx_vault_movements_date ON vault_movements(movement_date);

CREATE INDEX IF NOT EXISTS idx_agent_movements_agent ON agent_movements(agent_id);
