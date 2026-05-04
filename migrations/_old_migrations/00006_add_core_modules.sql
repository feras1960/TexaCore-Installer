-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة الموديولات الأساسية (العملاء، الموردين، المخزون، المبيعات)
-- Migration: Add Core Modules (Customers, Suppliers, Inventory, Sales)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. وحدات القياس
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS units_of_measure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    symbol VARCHAR(10),
    category VARCHAR(50) DEFAULT 'general',
    base_unit_id UUID REFERENCES units_of_measure(id),
    conversion_factor DECIMAL(15,6) DEFAULT 1,
    is_base_unit BOOLEAN DEFAULT false,
    allows_decimal BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. التسلسلات (للتسلسلات التلقائية)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    sequence_type VARCHAR(50) NOT NULL,
    prefix VARCHAR(20) DEFAULT '',
    suffix VARCHAR(20) DEFAULT '',
    current_value BIGINT DEFAULT 0,
    padding INT DEFAULT 5,
    reset_period VARCHAR(20) DEFAULT 'never',
    last_reset_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, company_id, sequence_type)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. سجل التدقيق
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID,
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 4. العملاء (Customers)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    parent_id UUID REFERENCES customer_groups(id),
    discount_percent DECIMAL(5,2) DEFAULT 0,
    credit_limit DECIMAL(15,2) DEFAULT 0,
    payment_terms_days INT DEFAULT 0,
    price_list_id UUID,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(50) NOT NULL,
    customer_type VARCHAR(20) DEFAULT 'individual',
    
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    gender VARCHAR(10),
    date_of_birth DATE,
    
    company_name VARCHAR(200),
    tax_number VARCHAR(100),
    registration_number VARCHAR(100),
    
    email VARCHAR(200),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    whatsapp VARCHAR(50),
    
    country VARCHAR(100),
    city VARCHAR(100),
    address TEXT,
    postal_code VARCHAR(20),
    
    group_id UUID REFERENCES customer_groups(id),
    tags JSONB DEFAULT '[]',
    
    currency VARCHAR(3) DEFAULT 'USD',
    credit_limit DECIMAL(15,2) DEFAULT 0,
    payment_terms_days INT DEFAULT 0,
    price_list_id UUID,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    
    balance DECIMAL(15,2) DEFAULT 0,
    total_sales DECIMAL(15,2) DEFAULT 0,
    total_payments DECIMAL(15,2) DEFAULT 0,
    
    kyc_level INT DEFAULT 0,
    kyc_verified_at TIMESTAMPTZ,
    id_type VARCHAR(50),
    id_number VARCHAR(100),
    id_expiry_date DATE,
    id_document_url TEXT,
    
    receivable_account_id UUID,
    
    is_b2b BOOLEAN DEFAULT false,
    b2b_approved BOOLEAN DEFAULT false,
    b2b_approved_at TIMESTAMPTZ,
    website_user_id UUID,
    
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    
    status VARCHAR(20) DEFAULT 'active',
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    
    address_type VARCHAR(20) DEFAULT 'shipping',
    label VARCHAR(100),
    
    recipient_name VARCHAR(200),
    phone VARCHAR(50),
    
    country VARCHAR(100),
    city VARCHAR(100),
    district VARCHAR(100),
    street VARCHAR(200),
    building VARCHAR(100),
    floor VARCHAR(20),
    apartment VARCHAR(20),
    postal_code VARCHAR(20),
    
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    
    is_default BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    
    name VARCHAR(200) NOT NULL,
    job_title VARCHAR(100),
    department VARCHAR(100),
    
    email VARCHAR(200),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    
    is_primary BOOLEAN DEFAULT false,
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 5. الموردين (Suppliers)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS supplier_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    parent_id UUID REFERENCES supplier_groups(id),
    payment_terms_days INT DEFAULT 0,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(50) NOT NULL,
    supplier_type VARCHAR(20) DEFAULT 'company',
    
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    company_name VARCHAR(200),
    tax_number VARCHAR(100),
    registration_number VARCHAR(100),
    
    email VARCHAR(200),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    website VARCHAR(200),
    
    country VARCHAR(100),
    city VARCHAR(100),
    address TEXT,
    postal_code VARCHAR(20),
    
    group_id UUID REFERENCES supplier_groups(id),
    tags JSONB DEFAULT '[]',
    
    currency VARCHAR(3) DEFAULT 'USD',
    payment_terms_days INT DEFAULT 0,
    
    balance DECIMAL(15,2) DEFAULT 0,
    total_purchases DECIMAL(15,2) DEFAULT 0,
    total_payments DECIMAL(15,2) DEFAULT 0,
    
    payable_account_id UUID,
    
    bank_name VARCHAR(200),
    bank_branch VARCHAR(200),
    bank_account VARCHAR(100),
    bank_iban VARCHAR(50),
    bank_swift VARCHAR(20),
    
    rating DECIMAL(3,2) DEFAULT 0,
    
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    
    status VARCHAR(20) DEFAULT 'active',
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    
    name VARCHAR(200) NOT NULL,
    job_title VARCHAR(100),
    department VARCHAR(100),
    
    email VARCHAR(200),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    
    is_primary BOOLEAN DEFAULT false,
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 6. قوائم الأسعار
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS price_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    price_type VARCHAR(20) DEFAULT 'selling',
    currency VARCHAR(3) DEFAULT 'USD',
    
    is_tax_inclusive BOOLEAN DEFAULT false,
    
    valid_from DATE,
    valid_to DATE,
    
    min_quantity DECIMAL(15,3) DEFAULT 0,
    
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS price_list_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    price_list_id UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    variant_id UUID,
    
    price DECIMAL(15,4) NOT NULL,
    min_quantity DECIMAL(15,3) DEFAULT 1,
    
    valid_from DATE,
    valid_to DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(price_list_id, product_id, variant_id, min_quantity)
);

-- ═══════════════════════════════════════════════════════════════
-- 7. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_group ON customers(group_id);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_suppliers_group ON suppliers(group_id);

CREATE INDEX IF NOT EXISTS idx_price_lists_tenant ON price_lists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_product ON price_list_items(product_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs(created_at);

-- ═══════════════════════════════════════════════════════════════
-- 8. RLS Policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view customers" ON customers
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can view suppliers" ON suppliers
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );
