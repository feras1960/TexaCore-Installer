-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة موديول الأقمشة (اختياري)
-- Migration: Add Fabric Module (Optional)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. مجموعات الأقمشة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fabric_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    parent_id UUID REFERENCES fabric_groups(id) ON DELETE CASCADE,
    
    icon VARCHAR(50) DEFAULT '📁',
    color VARCHAR(7),
    
    description TEXT,
    
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. ألوان الأقمشة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fabric_colors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    code VARCHAR(20) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    hex_color VARCHAR(7) NOT NULL,
    
    color_family VARCHAR(50),
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. أنواع الأقمشة (المواد)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fabric_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    
    product_id UUID REFERENCES products(id),
    
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    
    group_id UUID REFERENCES fabric_groups(id),
    
    composition VARCHAR(500),
    category VARCHAR(50) DEFAULT 'mixed',
    
    default_width DECIMAL(10,2) DEFAULT 150,
    weight_per_meter DECIMAL(10,4),
    thread_count INT,
    shrinkage_percent DECIMAL(5,2),
    
    unit VARCHAR(20) DEFAULT 'meter',
    purchase_price DECIMAL(15,4) DEFAULT 0,
    selling_price DECIMAL(15,4) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'USD',
    
    min_stock DECIMAL(15,2) DEFAULT 0,
    reorder_point DECIMAL(15,2) DEFAULT 0,
    
    origin_country VARCHAR(100),
    default_supplier_id UUID REFERENCES suppliers(id),
    
    images JSONB DEFAULT '[]',
    swatch_url TEXT,
    
    slug VARCHAR(200),
    is_visible_online BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS fabric_material_colors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    material_id UUID NOT NULL REFERENCES fabric_materials(id) ON DELETE CASCADE,
    color_id UUID NOT NULL REFERENCES fabric_colors(id) ON DELETE CASCADE,
    
    price_override DECIMAL(15,4),
    
    image_url TEXT,
    
    is_available BOOLEAN DEFAULT true,
    
    UNIQUE(material_id, color_id)
);

-- ═══════════════════════════════════════════════════════════════
-- 4. الرولونات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fabric_rolls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    
    material_id UUID NOT NULL REFERENCES fabric_materials(id),
    color_id UUID REFERENCES fabric_colors(id),
    
    roll_number VARCHAR(100) NOT NULL,
    barcode VARCHAR(100),
    qr_code TEXT,
    rfid_tag VARCHAR(100),
    
    initial_length DECIMAL(10,2) NOT NULL,
    current_length DECIMAL(10,2) NOT NULL,
    reserved_length DECIMAL(10,2) DEFAULT 0,
    available_length DECIMAL(10,2) GENERATED ALWAYS AS (current_length - reserved_length) STORED,
    
    width DECIMAL(10,2),
    weight DECIMAL(10,3),
    
    batch_id UUID REFERENCES inventory_batches(id),
    dye_lot VARCHAR(100),
    shade VARCHAR(20) DEFAULT 'medium',
    
    quality_grade VARCHAR(20) DEFAULT 'A',
    defect_rate DECIMAL(5,2) DEFAULT 0,
    defect_notes TEXT,
    
    cost_per_meter DECIMAL(15,4),
    total_cost DECIMAL(15,2),
    
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    location_id UUID REFERENCES warehouse_locations(id),
    location_code VARCHAR(50),
    
    supplier_id UUID REFERENCES suppliers(id),
    purchase_order_id UUID,
    purchase_invoice_id UUID,
    received_date DATE DEFAULT CURRENT_DATE,
    
    status VARCHAR(20) DEFAULT 'available',
    
    images JSONB DEFAULT '[]',
    
    last_movement_date TIMESTAMPTZ,
    last_count_date DATE,
    
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, roll_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 5. حركات الرولونات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS roll_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    roll_id UUID NOT NULL REFERENCES fabric_rolls(id) ON DELETE CASCADE,
    
    movement_number VARCHAR(50),
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    movement_time TIME DEFAULT CURRENT_TIME,
    movement_type VARCHAR(30) NOT NULL,
    
    quantity DECIMAL(10,2) NOT NULL,
    length_before DECIMAL(10,2) NOT NULL,
    length_after DECIMAL(10,2) NOT NULL,
    
    cost_per_meter DECIMAL(15,4),
    total_cost DECIMAL(15,2),
    
    from_warehouse_id UUID REFERENCES warehouses(id),
    from_location_id UUID REFERENCES warehouse_locations(id),
    to_warehouse_id UUID REFERENCES warehouses(id),
    to_location_id UUID REFERENCES warehouse_locations(id),
    
    reference_type VARCHAR(50),
    reference_id UUID,
    reference_number VARCHAR(100),
    
    customer_id UUID REFERENCES customers(id),
    customer_name VARCHAR(200),
    
    cut_type VARCHAR(20),
    cut_purpose VARCHAR(50),
    
    notes TEXT,
    
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 6. عينات الأقمشة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fabric_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    sample_number VARCHAR(50) NOT NULL,
    
    material_id UUID NOT NULL REFERENCES fabric_materials(id),
    color_id UUID REFERENCES fabric_colors(id),
    roll_id UUID REFERENCES fabric_rolls(id),
    
    length DECIMAL(10,2) NOT NULL,
    width DECIMAL(10,2),
    
    purpose VARCHAR(50) DEFAULT 'customer_request',
    
    customer_id UUID REFERENCES customers(id),
    customer_name VARCHAR(200),
    customer_phone VARCHAR(50),
    customer_email VARCHAR(200),
    
    shipping_address TEXT,
    shipping_method VARCHAR(50),
    tracking_number VARCHAR(100),
    
    status VARCHAR(20) DEFAULT 'pending',
    sent_date DATE,
    received_date DATE,
    
    feedback TEXT,
    converted_to_order BOOLEAN DEFAULT false,
    order_id UUID,
    
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 7. حجوزات الرولونات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS roll_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    
    roll_id UUID NOT NULL REFERENCES fabric_rolls(id) ON DELETE CASCADE,
    
    reserved_length DECIMAL(10,2) NOT NULL,
    
    reference_type VARCHAR(50) NOT NULL,
    reference_id UUID NOT NULL,
    reference_number VARCHAR(100),
    
    customer_id UUID REFERENCES customers(id),
    
    reserved_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    
    status VARCHAR(20) DEFAULT 'active',
    
    reserved_by UUID,
    released_by UUID,
    
    notes TEXT
);

-- ═══════════════════════════════════════════════════════════════
-- 8. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_fabric_materials_tenant ON fabric_materials(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fabric_materials_group ON fabric_materials(group_id);
CREATE INDEX IF NOT EXISTS idx_fabric_materials_code ON fabric_materials(tenant_id, code);

CREATE INDEX IF NOT EXISTS idx_fabric_rolls_tenant ON fabric_rolls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_material ON fabric_rolls(material_id);
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_warehouse ON fabric_rolls(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_status ON fabric_rolls(status);
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_number ON fabric_rolls(tenant_id, roll_number);
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_barcode ON fabric_rolls(barcode);
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_rfid ON fabric_rolls(rfid_tag);

CREATE INDEX IF NOT EXISTS idx_roll_movements_roll ON roll_movements(roll_id);
CREATE INDEX IF NOT EXISTS idx_roll_movements_date ON roll_movements(movement_date);
CREATE INDEX IF NOT EXISTS idx_roll_movements_type ON roll_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_roll_movements_reference ON roll_movements(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_roll_reservations_roll ON roll_reservations(roll_id);
CREATE INDEX IF NOT EXISTS idx_roll_reservations_status ON roll_reservations(status);
CREATE INDEX IF NOT EXISTS idx_roll_reservations_reference ON roll_reservations(reference_type, reference_id);
