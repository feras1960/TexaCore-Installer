-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة جداول المخزون والمنتجات
-- Migration: Add Inventory and Products Tables
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. المستودعات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id),
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    warehouse_type VARCHAR(50) DEFAULT 'main',
    
    country VARCHAR(100),
    city VARCHAR(100),
    address TEXT,
    
    phone VARCHAR(50),
    email VARCHAR(200),
    manager_id UUID REFERENCES user_profiles(id),
    
    is_active BOOLEAN DEFAULT true,
    allows_negative_stock BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS warehouse_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100),
    
    aisle VARCHAR(20),
    rack VARCHAR(20),
    shelf VARCHAR(20),
    bin VARCHAR(20),
    
    barcode VARCHAR(100),
    
    capacity DECIMAL(15,3),
    capacity_unit_id UUID,
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(warehouse_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. تصنيفات المنتجات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    
    parent_id UUID REFERENCES product_categories(id),
    
    code VARCHAR(50),
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    description TEXT,
    image_url TEXT,
    
    default_income_account_id UUID,
    default_expense_account_id UUID,
    default_inventory_account_id UUID,
    
    display_order INT DEFAULT 0,
    
    slug VARCHAR(200),
    is_visible_online BOOLEAN DEFAULT true,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    code VARCHAR(50),
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    logo_url TEXT,
    website VARCHAR(200),
    
    description TEXT,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. المنتجات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    
    sku VARCHAR(100) NOT NULL,
    barcode VARCHAR(100),
    
    name_ar VARCHAR(300) NOT NULL,
    name_en VARCHAR(300),
    description TEXT,
    
    category_id UUID REFERENCES product_categories(id),
    brand_id UUID REFERENCES brands(id),
    
    product_type VARCHAR(20) DEFAULT 'stockable',
    
    tracking_type VARCHAR(20) DEFAULT 'none',
    
    base_unit_id UUID NOT NULL REFERENCES units_of_measure(id),
    purchase_unit_id UUID REFERENCES units_of_measure(id),
    sale_unit_id UUID REFERENCES units_of_measure(id),
    
    has_variants BOOLEAN DEFAULT false,
    
    weight DECIMAL(10,3),
    weight_unit VARCHAR(10),
    length DECIMAL(10,2),
    width DECIMAL(10,2),
    height DECIMAL(10,2),
    dimension_unit VARCHAR(10),
    
    default_cost DECIMAL(15,4) DEFAULT 0,
    default_price DECIMAL(15,4) DEFAULT 0,
    
    is_taxable BOOLEAN DEFAULT true,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    
    min_stock DECIMAL(15,3) DEFAULT 0,
    max_stock DECIMAL(15,3),
    reorder_point DECIMAL(15,3) DEFAULT 0,
    reorder_quantity DECIMAL(15,3) DEFAULT 0,
    
    images JSONB DEFAULT '[]',
    
    slug VARCHAR(300),
    meta_title VARCHAR(200),
    meta_description TEXT,
    is_visible_online BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    
    status VARCHAR(20) DEFAULT 'active',
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS product_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    attribute_type VARCHAR(20) DEFAULT 'text',
    
    options JSONB DEFAULT '[]',
    
    display_order INT DEFAULT 0,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    
    sku VARCHAR(100) NOT NULL,
    barcode VARCHAR(100),
    
    name_ar VARCHAR(300),
    name_en VARCHAR(300),
    
    attribute_values JSONB NOT NULL DEFAULT '{}',
    
    cost_override DECIMAL(15,4),
    price_override DECIMAL(15,4),
    
    images JSONB DEFAULT '[]',
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, sku)
);

-- ═══════════════════════════════════════════════════════════════
-- 4. المخزون
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    location_id UUID REFERENCES warehouse_locations(id),
    
    quantity_on_hand DECIMAL(15,3) DEFAULT 0,
    quantity_reserved DECIMAL(15,3) DEFAULT 0,
    quantity_available DECIMAL(15,3) GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED,
    quantity_on_order DECIMAL(15,3) DEFAULT 0,
    
    average_cost DECIMAL(15,4) DEFAULT 0,
    last_cost DECIMAL(15,4) DEFAULT 0,
    total_value DECIMAL(15,2) GENERATED ALWAYS AS (quantity_on_hand * average_cost) STORED,
    
    last_movement_date TIMESTAMPTZ,
    last_count_date DATE,
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(product_id, variant_id, warehouse_id, location_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    movement_number VARCHAR(50) NOT NULL,
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    movement_time TIME DEFAULT CURRENT_TIME,
    
    movement_type VARCHAR(30) NOT NULL,
    
    product_id UUID NOT NULL REFERENCES products(id),
    variant_id UUID REFERENCES product_variants(id),
    
    from_warehouse_id UUID REFERENCES warehouses(id),
    from_location_id UUID REFERENCES warehouse_locations(id),
    to_warehouse_id UUID REFERENCES warehouses(id),
    to_location_id UUID REFERENCES warehouse_locations(id),
    
    quantity DECIMAL(15,3) NOT NULL,
    unit_id UUID REFERENCES units_of_measure(id),
    
    unit_cost DECIMAL(15,4),
    total_cost DECIMAL(15,2),
    
    balance_before DECIMAL(15,3),
    balance_after DECIMAL(15,3),
    
    reference_type VARCHAR(50),
    reference_id UUID,
    reference_number VARCHAR(100),
    
    notes TEXT,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    
    batch_number VARCHAR(100) NOT NULL,
    
    manufacturing_date DATE,
    expiry_date DATE,
    received_date DATE DEFAULT CURRENT_DATE,
    
    initial_quantity DECIMAL(15,3) NOT NULL,
    current_quantity DECIMAL(15,3) NOT NULL,
    
    unit_cost DECIMAL(15,4),
    
    supplier_id UUID REFERENCES suppliers(id),
    purchase_order_id UUID,
    
    lot_number VARCHAR(100),
    serial_prefix VARCHAR(50),
    
    dye_lot VARCHAR(100),
    shade VARCHAR(20),
    quality_grade VARCHAR(20),
    
    location_id UUID REFERENCES warehouse_locations(id),
    
    status VARCHAR(20) DEFAULT 'available',
    
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, product_id, batch_number)
);

CREATE TABLE IF NOT EXISTS inventory_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id),
    batch_id UUID REFERENCES inventory_batches(id),
    
    serial_number VARCHAR(100) NOT NULL,
    
    warehouse_id UUID REFERENCES warehouses(id),
    location_id UUID REFERENCES warehouse_locations(id),
    
    imei VARCHAR(20),
    imei2 VARCHAR(20),
    mac_address VARCHAR(20),
    
    unit_cost DECIMAL(15,4),
    
    warranty_start_date DATE,
    warranty_end_date DATE,
    
    status VARCHAR(20) DEFAULT 'available',
    
    current_customer_id UUID REFERENCES customers(id),
    sold_date DATE,
    sold_invoice_id UUID,
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, serial_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 5. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(tenant_id, sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(tenant_id, barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(tenant_id, sku);

CREATE INDEX IF NOT EXISTS idx_stock_product ON inventory_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_warehouse ON inventory_stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_tenant ON inventory_stock(tenant_id);

CREATE INDEX IF NOT EXISTS idx_movements_tenant ON inventory_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON inventory_movements(movement_date);
CREATE INDEX IF NOT EXISTS idx_movements_reference ON inventory_movements(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_batches_product ON inventory_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON inventory_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_number ON inventory_batches(tenant_id, batch_number);

CREATE INDEX IF NOT EXISTS idx_serials_product ON inventory_serials(product_id);
CREATE INDEX IF NOT EXISTS idx_serials_number ON inventory_serials(tenant_id, serial_number);
CREATE INDEX IF NOT EXISTS idx_serials_status ON inventory_serials(status);
