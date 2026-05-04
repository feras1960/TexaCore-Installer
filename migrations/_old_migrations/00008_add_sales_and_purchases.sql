-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة جداول المبيعات والمشتريات
-- Migration: Add Sales and Purchases Tables
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. عروض الأسعار
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    quotation_number VARCHAR(50) NOT NULL,
    quotation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    customer_id UUID REFERENCES customers(id),
    customer_name VARCHAR(200),
    customer_phone VARCHAR(50),
    customer_email VARCHAR(200),
    
    billing_address TEXT,
    shipping_address TEXT,
    
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    
    subtotal DECIMAL(15,2) DEFAULT 0,
    discount_type VARCHAR(20) DEFAULT 'fixed',
    discount_value DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    shipping_amount DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    
    valid_until DATE,
    
    terms TEXT,
    notes TEXT,
    internal_notes TEXT,
    
    status VARCHAR(20) DEFAULT 'draft',
    
    converted_to_order BOOLEAN DEFAULT false,
    order_id UUID,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, quotation_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. أوامر البيع
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    order_number VARCHAR(50) NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    quotation_id UUID REFERENCES quotations(id),
    
    customer_id UUID NOT NULL REFERENCES customers(id),
    customer_name VARCHAR(200),
    
    billing_address TEXT,
    shipping_address TEXT,
    
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    
    subtotal DECIMAL(15,2) DEFAULT 0,
    discount_type VARCHAR(20) DEFAULT 'fixed',
    discount_value DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    shipping_amount DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    
    paid_amount DECIMAL(15,2) DEFAULT 0,
    balance_due DECIMAL(15,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    payment_terms_days INT DEFAULT 0,
    due_date DATE,
    
    expected_delivery_date DATE,
    warehouse_id UUID REFERENCES warehouses(id),
    
    status VARCHAR(20) DEFAULT 'draft',
    payment_status VARCHAR(20) DEFAULT 'unpaid',
    delivery_status VARCHAR(20) DEFAULT 'pending',
    
    terms TEXT,
    notes TEXT,
    internal_notes TEXT,
    
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, order_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. فواتير المبيعات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sales_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    invoice_type VARCHAR(20) DEFAULT 'invoice',
    
    order_id UUID REFERENCES sales_orders(id),
    
    customer_id UUID NOT NULL REFERENCES customers(id),
    customer_name VARCHAR(200),
    customer_tax_number VARCHAR(100),
    
    billing_address TEXT,
    shipping_address TEXT,
    
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    
    subtotal DECIMAL(15,2) DEFAULT 0,
    discount_type VARCHAR(20) DEFAULT 'fixed',
    discount_value DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    taxable_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    shipping_amount DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    
    paid_amount DECIMAL(15,2) DEFAULT 0,
    balance_due DECIMAL(15,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    payment_terms_days INT DEFAULT 0,
    due_date DATE,
    
    status VARCHAR(20) DEFAULT 'draft',
    payment_status VARCHAR(20) DEFAULT 'unpaid',
    
    journal_entry_id UUID,
    is_posted BOOLEAN DEFAULT false,
    posted_at TIMESTAMPTZ,
    
    terms TEXT,
    notes TEXT,
    internal_notes TEXT,
    
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    cancel_reason TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, invoice_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 4. بنود المبيعات (مشترك)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sales_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE,
    order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES sales_invoices(id) ON DELETE CASCADE,
    
    line_number INT DEFAULT 1,
    
    product_id UUID REFERENCES products(id),
    variant_id UUID REFERENCES product_variants(id),
    
    roll_id UUID, -- للأقمشة (سيتم ربطه لاحقاً)
    material_id UUID, -- للأقمشة (سيتم ربطه لاحقاً)
    
    description TEXT NOT NULL,
    
    quantity DECIMAL(15,3) NOT NULL,
    unit_id UUID REFERENCES units_of_measure(id),
    
    unit_price DECIMAL(15,4) NOT NULL,
    
    discount_type VARCHAR(20) DEFAULT 'fixed',
    discount_value DECIMAL(15,4) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    
    tax_rate DECIMAL(5,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    
    subtotal DECIMAL(15,2) NOT NULL,
    total DECIMAL(15,2) NOT NULL,
    
    unit_cost DECIMAL(15,4) DEFAULT 0,
    total_cost DECIMAL(15,2) DEFAULT 0,
    
    delivered_quantity DECIMAL(15,3) DEFAULT 0,
    
    warehouse_id UUID REFERENCES warehouses(id),
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT chk_single_parent CHECK (
        (quotation_id IS NOT NULL)::int + 
        (order_id IS NOT NULL)::int + 
        (invoice_id IS NOT NULL)::int = 1
    )
);

-- ═══════════════════════════════════════════════════════════════
-- 5. أوامر الشراء
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    order_number VARCHAR(50) NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    supplier_name VARCHAR(200),
    
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    
    subtotal DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    shipping_amount DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    
    paid_amount DECIMAL(15,2) DEFAULT 0,
    payment_terms_days INT DEFAULT 0,
    due_date DATE,
    
    expected_delivery_date DATE,
    warehouse_id UUID REFERENCES warehouses(id),
    
    status VARCHAR(20) DEFAULT 'draft',
    payment_status VARCHAR(20) DEFAULT 'unpaid',
    receipt_status VARCHAR(20) DEFAULT 'pending',
    
    terms TEXT,
    notes TEXT,
    internal_notes TEXT,
    
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, order_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 6. فواتير المشتريات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS purchase_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    supplier_invoice_number VARCHAR(100),
    supplier_invoice_date DATE,
    
    order_id UUID REFERENCES purchase_orders(id),
    
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    supplier_name VARCHAR(200),
    supplier_tax_number VARCHAR(100),
    
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    
    subtotal DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    shipping_amount DECIMAL(15,2) DEFAULT 0,
    other_charges DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    
    paid_amount DECIMAL(15,2) DEFAULT 0,
    balance_due DECIMAL(15,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    payment_terms_days INT DEFAULT 0,
    due_date DATE,
    
    status VARCHAR(20) DEFAULT 'draft',
    payment_status VARCHAR(20) DEFAULT 'unpaid',
    
    journal_entry_id UUID,
    is_posted BOOLEAN DEFAULT false,
    posted_at TIMESTAMPTZ,
    
    notes TEXT,
    internal_notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, invoice_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 7. بنود المشتريات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    
    line_number INT DEFAULT 1,
    
    product_id UUID REFERENCES products(id),
    variant_id UUID REFERENCES product_variants(id),
    
    material_id UUID, -- للأقمشة (سيتم ربطه لاحقاً)
    
    description TEXT NOT NULL,
    
    quantity DECIMAL(15,3) NOT NULL,
    unit_id UUID REFERENCES units_of_measure(id),
    received_quantity DECIMAL(15,3) DEFAULT 0,
    
    unit_price DECIMAL(15,4) NOT NULL,
    
    discount_amount DECIMAL(15,2) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    
    subtotal DECIMAL(15,2) NOT NULL,
    total DECIMAL(15,2) NOT NULL,
    
    warehouse_id UUID REFERENCES warehouses(id),
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 8. سندات القبض والصرف
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    receipt_number VARCHAR(50) NOT NULL,
    receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    customer_id UUID NOT NULL REFERENCES customers(id),
    customer_name VARCHAR(200),
    
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    amount_in_base DECIMAL(15,2),
    
    payment_method VARCHAR(50) NOT NULL,
    
    check_number VARCHAR(50),
    check_date DATE,
    bank_name VARCHAR(200),
    
    transfer_reference VARCHAR(100),
    
    status VARCHAR(20) DEFAULT 'confirmed',
    
    journal_entry_id UUID,
    
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, receipt_number)
);

CREATE TABLE IF NOT EXISTS payment_receipt_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    receipt_id UUID NOT NULL REFERENCES payment_receipts(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES sales_invoices(id),
    
    amount DECIMAL(15,2) NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    
    voucher_number VARCHAR(50) NOT NULL,
    voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    supplier_name VARCHAR(200),
    
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(18,8) DEFAULT 1,
    amount_in_base DECIMAL(15,2),
    
    payment_method VARCHAR(50) NOT NULL,
    
    check_number VARCHAR(50),
    check_date DATE,
    bank_name VARCHAR(200),
    
    transfer_reference VARCHAR(100),
    
    status VARCHAR(20) DEFAULT 'confirmed',
    
    journal_entry_id UUID,
    
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, voucher_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 9. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_quotations_tenant ON quotations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_date ON quotations(quotation_date);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);

CREATE INDEX IF NOT EXISTS idx_sales_orders_tenant ON sales_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_tenant ON sales_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_status ON sales_invoices(status);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_payment ON sales_invoices(payment_status);

CREATE INDEX IF NOT EXISTS idx_sales_items_invoice ON sales_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_order ON sales_invoice_items(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_product ON sales_invoice_items(product_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_tenant ON purchase_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON purchase_invoices(supplier_id);

CREATE INDEX IF NOT EXISTS idx_receipts_customer ON payment_receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_supplier ON payment_vouchers(supplier_id);
