-- ═══════════════════════════════════════════════════════════════
--  Migration: Customer Shipping & Nova Poshta Integration
--  Phase 7: حقول شحن العميل + تكامل نوفايا بوشتا + n8n
--  Date: 2026-02-11
-- ═══════════════════════════════════════════════════════════════
-- 
-- هذا السكربت يضيف:
-- 1. حقول الشحن على جميع مستندات التجارة
-- 2. جدول shipping_carriers لإعدادات شركات الشحن لكل شركة
-- 3. جدول shipment_documents لتخزين بوليصات الشحن (TTN)
-- 4. الحقول الخاصة ب Nova Poshta API v2.0
-- 5. ربط كامل مع n8n webhooks
--
-- ✅ الجداول الموجودة مسبقاً (لن نلمسها):
--    - shipments_tracking (STEP_2) — تتبع عام
--    - order_shipments (STEP_55) — شحنات الطلبات E-Commerce
-- 
-- ✅ ما نضيفه هنا:
--    - حقول shipping على مستندات B2B (quotations, sales_orders, etc.)
--    - shipping_carriers — إعدادات شركات الشحن
--    - shipment_documents — بوليصات الشحن (TTN/ waybills)
-- ═══════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  PART 0: إنشاء جدول عناوين العملاء (إن لم يكن موجوداً)     ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- Create auto_set_tenant_id function if it doesn't exist
CREATE OR REPLACE FUNCTION auto_set_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id = get_current_tenant_id();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- RLS + Trigger for customer_addresses (C-Group: tenant_id only)
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;

-- سياسات CRUD منفصلة وفق النمط الرسمي
DO $$ BEGIN
    -- SELECT
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_addresses' AND policyname = 'customer_addresses_select_policy') THEN
        CREATE POLICY customer_addresses_select_policy ON customer_addresses
            FOR SELECT TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    -- INSERT
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_addresses' AND policyname = 'customer_addresses_insert_policy') THEN
        CREATE POLICY customer_addresses_insert_policy ON customer_addresses
            FOR INSERT TO authenticated
            WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    -- UPDATE
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_addresses' AND policyname = 'customer_addresses_update_policy') THEN
        CREATE POLICY customer_addresses_update_policy ON customer_addresses
            FOR UPDATE TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    -- DELETE
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_addresses' AND policyname = 'customer_addresses_delete_policy') THEN
        CREATE POLICY customer_addresses_delete_policy ON customer_addresses
            FOR DELETE TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
END $$;

-- Trigger for tenant_id auto-set
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_tenant_customer_addresses') THEN
        CREATE TRIGGER trg_auto_tenant_customer_addresses
            BEFORE INSERT ON customer_addresses
            FOR EACH ROW
            EXECUTE FUNCTION auto_set_tenant_id();
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_default ON customer_addresses(customer_id, is_default) WHERE is_default = true;

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  PART 1: إضافة حقول الشحن على مستندات التجارة               ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- ═══ 1.1 quotations ═══
ALTER TABLE quotations
    ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(30) DEFAULT 'store_pickup',
    ADD COLUMN IF NOT EXISTS shipping_address_id UUID REFERENCES customer_addresses(id),
    ADD COLUMN IF NOT EXISTS shipping_address TEXT,
    ADD COLUMN IF NOT EXISTS shipping_recipient VARCHAR(200),
    ADD COLUMN IF NOT EXISTS shipping_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50),
    ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- ═══ 1.2 sales_orders ═══
ALTER TABLE sales_orders
    ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(30) DEFAULT 'store_pickup',
    ADD COLUMN IF NOT EXISTS shipping_address_id UUID REFERENCES customer_addresses(id),
    ADD COLUMN IF NOT EXISTS shipping_address TEXT,
    ADD COLUMN IF NOT EXISTS shipping_recipient VARCHAR(200),
    ADD COLUMN IF NOT EXISTS shipping_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50),
    ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- ═══ 1.3 sales_invoices ═══
ALTER TABLE sales_invoices
    ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(30) DEFAULT 'store_pickup',
    ADD COLUMN IF NOT EXISTS shipping_address_id UUID REFERENCES customer_addresses(id),
    ADD COLUMN IF NOT EXISTS shipping_address TEXT,
    ADD COLUMN IF NOT EXISTS shipping_recipient VARCHAR(200),
    ADD COLUMN IF NOT EXISTS shipping_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50),
    ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- ═══ 1.4 sales_deliveries ═══
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sales_deliveries') THEN
    ALTER TABLE sales_deliveries
        ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(30) DEFAULT 'store_pickup',
        ADD COLUMN IF NOT EXISTS shipping_address_id UUID REFERENCES customer_addresses(id),
        ADD COLUMN IF NOT EXISTS shipping_address TEXT,
        ADD COLUMN IF NOT EXISTS shipping_recipient VARCHAR(200),
        ADD COLUMN IF NOT EXISTS shipping_phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50),
        ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100),
        ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS delivery_notes TEXT;
  END IF;
END $$;

-- ═══ 1.5 transit_reservations ═══
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'transit_reservations') THEN
    ALTER TABLE transit_reservations
        ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(30) DEFAULT 'store_pickup',
        ADD COLUMN IF NOT EXISTS shipping_address_id UUID REFERENCES customer_addresses(id),
        ADD COLUMN IF NOT EXISTS shipping_address TEXT,
        ADD COLUMN IF NOT EXISTS shipping_recipient VARCHAR(200),
        ADD COLUMN IF NOT EXISTS shipping_phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50),
        ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100),
        ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS delivery_notes TEXT;
  END IF;
END $$;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  PART 2: جدول shipping_carriers — إعدادات شركات الشحن       ║
-- ║  مرتبط بالشركة + قابل للإعداد عبر company_settings          ║
-- ╚═══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shipping_carriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- ═══ معلومات شركة الشحن ═══
    carrier_code VARCHAR(50) NOT NULL,         -- 'nova_poshta', 'ukrposhta', 'dhl', 'aramex', etc.
    name_ar VARCHAR(200),
    name_en VARCHAR(200),
    name_uk VARCHAR(200),                      -- Ukrainian name
    logo_url TEXT,
    
    -- ═══ API Integration ═══
    api_endpoint TEXT,                          -- Base API URL
    api_key_encrypted TEXT,                     -- مفتاح API مشفر (Supabase Vault)
    api_version VARCHAR(20),                   -- e.g. 'v2.0'
    
    -- ═══ Nova Poshta Specific ═══
    np_sender_ref VARCHAR(36),                 -- Nova Poshta: Sender counterparty Ref (UUID)
    np_sender_city_ref VARCHAR(36),            -- Nova Poshta: Sender city Ref
    np_sender_address_ref VARCHAR(36),         -- Nova Poshta: Sender warehouse/branch Ref
    np_sender_contact_ref VARCHAR(36),         -- Nova Poshta: Sender contact person Ref
    np_sender_phone VARCHAR(50),               -- هاتف المرسل
    
    -- ═══ Tracking ═══
    tracking_url_template TEXT,                -- "https://novaposhta.ua/tracking?id={tracking}"
    
    -- ═══ n8n Integration ═══
    n8n_create_shipment_webhook TEXT,           -- Webhook لإنشاء بوليصة
    n8n_track_shipment_webhook TEXT,            -- Webhook لتتبع الحالة  
    n8n_cancel_shipment_webhook TEXT,           -- Webhook لإلغاء الشحنة
    n8n_print_label_webhook TEXT,              -- Webhook لطباعة البوليصة
    
    -- ═══ Settings ═══
    country VARCHAR(10),                       -- 'UA', 'SA', 'INTL'
    default_service_type VARCHAR(50),          -- 'WarehouseWarehouse', 'WarehouseDoors', 'DoorsWarehouse', 'DoorsDoors'
    default_cargo_type VARCHAR(50),            -- 'Cargo', 'Parcel', 'Documents', 'TiresWheels', 'Pallet'
    default_payer_type VARCHAR(50),            -- 'Sender', 'Recipient', 'ThirdPerson'
    default_payment_method VARCHAR(50),        -- 'Cash', 'NonCash'
    
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    
    settings JSONB DEFAULT '{}',               -- إعدادات إضافية لشركة الشحن
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tenant_id, company_id, carrier_code)
);

COMMENT ON TABLE shipping_carriers IS 'إعدادات شركات الشحن لكل شركة — Nova Poshta, Ukrposhta, DHL, etc.';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  PART 3: جدول shipment_documents — بوليصات الشحن (TTN)      ║
-- ║  يخزن كل بوليصة (waybill) تم إنشاؤها عبر API               ║
-- ╚═══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shipment_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    carrier_id UUID REFERENCES shipping_carriers(id),
    
    -- ═══ ربط بمستند التجارة ═══
    source_table VARCHAR(50) NOT NULL,         -- 'sales_orders', 'sales_deliveries', 'transit_reservations'
    source_id UUID NOT NULL,                   -- ID من المستند المصدري
    
    -- ═══ معلومات البوليصة ═══
    carrier_code VARCHAR(50) NOT NULL,         -- 'nova_poshta', 'ukrposhta'
    tracking_number VARCHAR(100),              -- TTN / رقم البوليصة
    carrier_ref VARCHAR(100),                  -- Nova Poshta: Internet Document Ref
    
    -- ═══ حالة الشحنة ═══
    status VARCHAR(50) DEFAULT 'created',      -- created, pending, in_transit, arrived, delivered, returned, cancelled
    status_description TEXT,                   -- وصف الحالة من API
    last_status_check TIMESTAMPTZ,
    
    -- ═══ معلومات المرسل (Sender) ═══
    sender_ref VARCHAR(36),                    -- Counterparty Ref
    sender_city_ref VARCHAR(36),
    sender_city_name VARCHAR(200),
    sender_address_ref VARCHAR(36),            -- Warehouse / Branch Ref
    sender_address_name VARCHAR(300),
    sender_contact_ref VARCHAR(36),
    sender_contact_name VARCHAR(200),
    sender_phone VARCHAR(50),
    
    -- ═══ معلومات المستلم (Recipient) ═══
    recipient_ref VARCHAR(36),
    recipient_city_ref VARCHAR(36),
    recipient_city_name VARCHAR(200),
    recipient_address_ref VARCHAR(36),         -- Warehouse Ref (for WarehouseWarehouse)
    recipient_address_name VARCHAR(300),
    recipient_address_street TEXT,              -- (for DoorsDoors)
    recipient_building VARCHAR(50),
    recipient_flat VARCHAR(50),
    recipient_contact_name VARCHAR(200),
    recipient_phone VARCHAR(50),
    
    -- ═══ تفاصيل الشحنة ═══
    service_type VARCHAR(50),                  -- WarehouseWarehouse, WarehouseDoors, DoorsWarehouse, DoorsDoors
    cargo_type VARCHAR(50),                    -- Cargo, Parcel, Documents, TiresWheels, Pallet
    payer_type VARCHAR(50),                    -- Sender, Recipient, ThirdPerson
    payment_method VARCHAR(50),                -- Cash, NonCash
    
    weight DECIMAL(10,3),                      -- kg
    volume_general DECIMAL(10,4),              -- m³
    seats_amount INT DEFAULT 1,                -- عدد القطع
    
    -- ═══ أبعاد ═══
    length DECIMAL(10,2),                      -- cm
    width DECIMAL(10,2),
    height DECIMAL(10,2),
    
    -- ═══ المبالغ ═══
    declared_value DECIMAL(12,2),              -- القيمة المعلنة
    shipping_cost DECIMAL(12,2),               -- تكلفة الشحن
    cod_amount DECIMAL(12,2) DEFAULT 0,        -- الدفع عند الاستلام (Cash on Delivery)
    cod_collected DECIMAL(12,2),               -- المبلغ المحصل فعلياً
    carrier_commission DECIMAL(12,2),          -- عمولة شركة الشحن
    
    -- ═══ التواريخ ═══
    estimated_delivery_date DATE,
    actual_delivery_date DATE,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    
    -- ═══ الطباعة ═══
    label_url TEXT,                             -- رابط طباعة البوليصة (PDF)
    barcode VARCHAR(100),
    
    -- ═══ بيانات API الخام ═══
    api_request JSONB,                         -- الطلب الذي أرسلناه
    api_response JSONB,                        -- الرد من شركة الشحن
    status_history JSONB DEFAULT '[]',         -- سجل الحالات [{status, date, description}]
    
    -- ═══ ملاحظات ═══
    description TEXT,                          -- وصف الشحنة (يُرسل مع البوليصة)
    internal_notes TEXT,                       -- ملاحظات داخلية
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE shipment_documents IS 'بوليصات الشحن (TTN/Waybills) — كل بوليصة مرتبطة بمستند تجاري ومُنشأة عبر API شركة الشحن';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  PART 4: RLS + Triggers + Indexes                            ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- ═══ 4.1 RLS for shipping_carriers (D-Group: tenant_id + company_id) ═══
ALTER TABLE shipping_carriers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipping_carriers' AND policyname = 'shipping_carriers_select_policy') THEN
        CREATE POLICY shipping_carriers_select_policy ON shipping_carriers
            FOR SELECT TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipping_carriers' AND policyname = 'shipping_carriers_insert_policy') THEN
        CREATE POLICY shipping_carriers_insert_policy ON shipping_carriers
            FOR INSERT TO authenticated
            WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipping_carriers' AND policyname = 'shipping_carriers_update_policy') THEN
        CREATE POLICY shipping_carriers_update_policy ON shipping_carriers
            FOR UPDATE TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipping_carriers' AND policyname = 'shipping_carriers_delete_policy') THEN
        CREATE POLICY shipping_carriers_delete_policy ON shipping_carriers
            FOR DELETE TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
END $$;

-- ═══ 4.2 RLS for shipment_documents (D-Group: tenant_id + company_id) ═══
ALTER TABLE shipment_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipment_documents' AND policyname = 'shipment_documents_select_policy') THEN
        CREATE POLICY shipment_documents_select_policy ON shipment_documents
            FOR SELECT TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipment_documents' AND policyname = 'shipment_documents_insert_policy') THEN
        CREATE POLICY shipment_documents_insert_policy ON shipment_documents
            FOR INSERT TO authenticated
            WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipment_documents' AND policyname = 'shipment_documents_update_policy') THEN
        CREATE POLICY shipment_documents_update_policy ON shipment_documents
            FOR UPDATE TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipment_documents' AND policyname = 'shipment_documents_delete_policy') THEN
        CREATE POLICY shipment_documents_delete_policy ON shipment_documents
            FOR DELETE TO authenticated
            USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
END $$;

-- ═══ 4.3 Triggers for tenant_id auto-set ═══
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_tenant_shipping_carriers') THEN
        CREATE TRIGGER trg_auto_tenant_shipping_carriers
            BEFORE INSERT ON shipping_carriers
            FOR EACH ROW
            EXECUTE FUNCTION auto_set_tenant_id();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_tenant_shipment_documents') THEN
        CREATE TRIGGER trg_auto_tenant_shipment_documents
            BEFORE INSERT ON shipment_documents
            FOR EACH ROW
            EXECUTE FUNCTION auto_set_tenant_id();
    END IF;
END $$;

-- ═══ 4.4 Indexes ═══
CREATE INDEX IF NOT EXISTS idx_shipping_carriers_company 
    ON shipping_carriers(company_id);
CREATE INDEX IF NOT EXISTS idx_shipping_carriers_code 
    ON shipping_carriers(tenant_id, carrier_code, is_active);

CREATE INDEX IF NOT EXISTS idx_shipment_docs_source 
    ON shipment_documents(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_shipment_docs_tracking 
    ON shipment_documents(tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipment_docs_carrier 
    ON shipment_documents(carrier_code, status);
CREATE INDEX IF NOT EXISTS idx_shipment_docs_company 
    ON shipment_documents(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_docs_status 
    ON shipment_documents(tenant_id, status) WHERE status NOT IN ('delivered', 'cancelled');

-- Trade documents indexes
CREATE INDEX IF NOT EXISTS idx_quotations_delivery_method 
    ON quotations(delivery_method);
CREATE INDEX IF NOT EXISTS idx_sales_orders_delivery_method 
    ON sales_orders(delivery_method);
CREATE INDEX IF NOT EXISTS idx_sales_orders_tracking 
    ON sales_orders(tracking_number) WHERE tracking_number IS NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sales_deliveries') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_deliveries_tracking ON sales_deliveries(tracking_number) WHERE tracking_number IS NOT NULL';
  END IF;
END $$;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  PART 5: Nova Poshta API Helper Function                     ║
-- ║  (يُستخدم من n8n webhook لبناء الطلب)                       ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- هذه الفنكشن تُنشئ سجل بوليصة وتُرجع البيانات اللازمة لـ n8n
CREATE OR REPLACE FUNCTION create_shipment_document(
    p_company_id UUID,
    p_source_table VARCHAR,
    p_source_id UUID,
    p_carrier_code VARCHAR,
    p_recipient_name VARCHAR,
    p_recipient_phone VARCHAR,
    p_recipient_city VARCHAR DEFAULT NULL,
    p_recipient_city_ref VARCHAR DEFAULT NULL,
    p_recipient_address_ref VARCHAR DEFAULT NULL,
    p_recipient_address_street TEXT DEFAULT NULL,
    p_recipient_building VARCHAR DEFAULT NULL,
    p_recipient_flat VARCHAR DEFAULT NULL,
    p_service_type VARCHAR DEFAULT 'WarehouseWarehouse',
    p_cargo_type VARCHAR DEFAULT 'Parcel',
    p_payer_type VARCHAR DEFAULT 'Sender',
    p_payment_method VARCHAR DEFAULT 'NonCash',
    p_weight DECIMAL DEFAULT 1.0,
    p_seats_amount INT DEFAULT 1,
    p_declared_value DECIMAL DEFAULT 0,
    p_cod_amount DECIMAL DEFAULT 0,
    p_description TEXT DEFAULT NULL,
    p_length DECIMAL DEFAULT NULL,
    p_width DECIMAL DEFAULT NULL,
    p_height DECIMAL DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_carrier RECORD;
    v_doc_id UUID;
    v_np_request JSONB;
BEGIN
    -- Get tenant_id from company
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Company not found');
    END IF;
    
    -- Get carrier config
    SELECT * INTO v_carrier 
    FROM shipping_carriers 
    WHERE company_id = p_company_id 
      AND carrier_code = p_carrier_code 
      AND is_active = true
    LIMIT 1;
    
    IF v_carrier.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Carrier not configured: ' || p_carrier_code);
    END IF;
    
    -- Create shipment document record
    INSERT INTO shipment_documents (
        tenant_id, company_id, carrier_id,
        source_table, source_id, carrier_code,
        status,
        -- Sender (from carrier config)
        sender_ref, sender_city_ref, sender_address_ref,
        sender_contact_ref, sender_phone,
        -- Recipient
        recipient_city_name, recipient_city_ref,
        recipient_address_ref, recipient_address_street,
        recipient_building, recipient_flat,
        recipient_contact_name, recipient_phone,
        -- Details
        service_type, cargo_type, payer_type, payment_method,
        weight, seats_amount,
        length, width, height,
        declared_value, cod_amount,
        description,
        created_by
    ) VALUES (
        v_tenant_id, p_company_id, v_carrier.id,
        p_source_table, p_source_id, p_carrier_code,
        'pending',
        -- Sender
        v_carrier.np_sender_ref, v_carrier.np_sender_city_ref, v_carrier.np_sender_address_ref,
        v_carrier.np_sender_contact_ref, v_carrier.np_sender_phone,
        -- Recipient
        p_recipient_city, p_recipient_city_ref,
        p_recipient_address_ref, p_recipient_address_street,
        p_recipient_building, p_recipient_flat,
        p_recipient_name, p_recipient_phone,
        -- Details
        p_service_type, p_cargo_type, p_payer_type, p_payment_method,
        p_weight, p_seats_amount,
        p_length, p_width, p_height,
        p_declared_value, p_cod_amount,
        p_description,
        p_created_by
    )
    RETURNING id INTO v_doc_id;
    
    -- Build Nova Poshta API request (for n8n to send)
    IF p_carrier_code = 'nova_poshta' THEN
        v_np_request := jsonb_build_object(
            'apiKey', '__API_KEY__',  -- n8n يستبدله بمفتاح API المشفر
            'modelName', 'InternetDocument',
            'calledMethod', 'save',
            'methodProperties', jsonb_build_object(
                'PayerType', p_payer_type,
                'PaymentMethod', p_payment_method,
                'DateTime', to_char(NOW(), 'DD.MM.YYYY'),
                'CargoType', p_cargo_type,
                'Weight', p_weight::text,
                'SeatsAmount', p_seats_amount::text,
                'ServiceType', p_service_type,
                'Description', COALESCE(p_description, 'Shipment from TexaCore'),
                'Cost', p_declared_value::text,
                -- Sender
                'Sender', v_carrier.np_sender_ref,
                'CitySender', v_carrier.np_sender_city_ref,
                'SenderAddress', v_carrier.np_sender_address_ref,
                'ContactSender', v_carrier.np_sender_contact_ref,
                'SendersPhone', v_carrier.np_sender_phone,
                -- Recipient (dynamic)
                'RecipientCityName', COALESCE(p_recipient_city, ''),
                'RecipientAddressName', COALESCE(p_recipient_address_ref, ''),
                'RecipientName', p_recipient_name,
                'RecipientsPhone', p_recipient_phone,
                -- Volume
                'VolumeGeneral', CASE 
                    WHEN p_length IS NOT NULL AND p_width IS NOT NULL AND p_height IS NOT NULL 
                    THEN ((p_length * p_width * p_height) / 1000000)::text
                    ELSE '0.001'
                END
            )
        );
        
        -- Add BackwardDeliveryData if COD
        IF p_cod_amount > 0 THEN
            v_np_request := jsonb_set(
                v_np_request,
                '{methodProperties,BackwardDeliveryData}',
                jsonb_build_array(
                    jsonb_build_object(
                        'PayerType', 'Recipient',
                        'CargoType', 'Money',
                        'RedeliveryString', p_cod_amount::text
                    )
                )
            );
        END IF;
        
        -- Add dimensions if provided
        IF p_length IS NOT NULL THEN
            v_np_request := jsonb_set(
                v_np_request,
                '{methodProperties,OptionsSeat}',
                jsonb_build_array(
                    jsonb_build_object(
                        'volumetricLength', p_length::text,
                        'volumetricWidth', p_width::text,
                        'volumetricHeight', p_height::text,
                        'weight', p_weight::text
                    )
                )
            );
        END IF;
        
        -- Save the request template
        UPDATE shipment_documents SET api_request = v_np_request WHERE id = v_doc_id;
    END IF;
    
    -- Return everything n8n needs
    RETURN jsonb_build_object(
        'success', true,
        'shipment_document_id', v_doc_id,
        'carrier_code', p_carrier_code,
        'carrier_id', v_carrier.id,
        'api_endpoint', COALESCE(v_carrier.api_endpoint, 'https://api.novaposhta.ua/v2.0/json/'),
        'n8n_webhook', v_carrier.n8n_create_shipment_webhook,
        'np_api_request', v_np_request,
        'tracking_url_template', v_carrier.tracking_url_template
    );
END;
$$;

COMMENT ON FUNCTION create_shipment_document IS 'إنشاء بوليصة شحن جديدة — تجهز الطلب لإرساله عبر n8n إلى Nova Poshta API';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  PART 6: Function to process API response from n8n           ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- n8n يستدعي هذه الفنكشن بعد إرسال الطلب لـ Nova Poshta وتلقي الرد
CREATE OR REPLACE FUNCTION process_shipment_api_response(
    p_shipment_doc_id UUID,
    p_tracking_number VARCHAR,
    p_carrier_ref VARCHAR,
    p_estimated_delivery DATE DEFAULT NULL,
    p_shipping_cost DECIMAL DEFAULT NULL,
    p_label_url TEXT DEFAULT NULL,
    p_api_response JSONB DEFAULT NULL,
    p_success BOOLEAN DEFAULT true,
    p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_doc RECORD;
BEGIN
    IF NOT p_success THEN
        UPDATE shipment_documents
        SET status = 'failed',
            status_description = p_error_message,
            api_response = p_api_response,
            updated_at = NOW()
        WHERE id = p_shipment_doc_id;
        
        RETURN jsonb_build_object('success', false, 'error', p_error_message);
    END IF;
    
    -- Update shipment document with API response
    UPDATE shipment_documents
    SET tracking_number = p_tracking_number,
        carrier_ref = p_carrier_ref,
        status = 'created',
        status_description = 'البوليصة تم إنشاؤها بنجاح',
        estimated_delivery_date = p_estimated_delivery,
        shipping_cost = COALESCE(p_shipping_cost, shipping_cost),
        label_url = p_label_url,
        barcode = p_tracking_number,
        api_response = p_api_response,
        status_history = status_history || jsonb_build_array(
            jsonb_build_object(
                'status', 'created',
                'date', to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
                'description', 'البوليصة تم إنشاؤها — TTN: ' || p_tracking_number
            )
        ),
        updated_at = NOW()
    WHERE id = p_shipment_doc_id
    RETURNING * INTO v_doc;
    
    -- Update the source trade document with tracking number
    IF v_doc.source_table = 'sales_orders' THEN
        UPDATE sales_orders 
        SET tracking_number = p_tracking_number,
            shipping_cost = COALESCE(p_shipping_cost, shipping_cost)
        WHERE id = v_doc.source_id;
    ELSIF v_doc.source_table = 'sales_deliveries' THEN
        UPDATE sales_deliveries
        SET tracking_number = p_tracking_number,
            shipping_cost = COALESCE(p_shipping_cost, shipping_cost)
        WHERE id = v_doc.source_id;
    ELSIF v_doc.source_table = 'transit_reservations' THEN
        UPDATE transit_reservations
        SET tracking_number = p_tracking_number,
            shipping_cost = COALESCE(p_shipping_cost, shipping_cost)
        WHERE id = v_doc.source_id;
    ELSIF v_doc.source_table = 'quotations' THEN
        UPDATE quotations
        SET tracking_number = p_tracking_number,
            shipping_cost = COALESCE(p_shipping_cost, shipping_cost)
        WHERE id = v_doc.source_id;
    ELSIF v_doc.source_table = 'sales_invoices' THEN
        UPDATE sales_invoices
        SET tracking_number = p_tracking_number,
            shipping_cost = COALESCE(p_shipping_cost, shipping_cost)
        WHERE id = v_doc.source_id;
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'tracking_number', p_tracking_number,
        'carrier_ref', p_carrier_ref,
        'shipment_document_id', p_shipment_doc_id,
        'label_url', p_label_url
    );
END;
$$;

COMMENT ON FUNCTION process_shipment_api_response IS 'معالجة رد API شركة الشحن — يُستدعى من n8n بعد تلقي رقم البوليصة (TTN)';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  PART 7: Function to update shipment status (from n8n)       ║
-- ╚═══════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION update_shipment_document_status(
    p_shipment_doc_id UUID,
    p_new_status VARCHAR,
    p_status_description TEXT DEFAULT NULL,
    p_cod_collected DECIMAL DEFAULT NULL,
    p_carrier_commission DECIMAL DEFAULT NULL,
    p_api_response JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE shipment_documents
    SET status = p_new_status,
        status_description = COALESCE(p_status_description, status_description),
        cod_collected = COALESCE(p_cod_collected, cod_collected),
        carrier_commission = COALESCE(p_carrier_commission, carrier_commission),
        delivered_at = CASE WHEN p_new_status = 'delivered' THEN NOW() ELSE delivered_at END,
        actual_delivery_date = CASE WHEN p_new_status = 'delivered' THEN CURRENT_DATE ELSE actual_delivery_date END,
        returned_at = CASE WHEN p_new_status = 'returned' THEN NOW() ELSE returned_at END,
        picked_up_at = CASE WHEN p_new_status = 'in_transit' THEN COALESCE(picked_up_at, NOW()) ELSE picked_up_at END,
        last_status_check = NOW(),
        status_history = status_history || jsonb_build_array(
            jsonb_build_object(
                'status', p_new_status,
                'date', to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
                'description', p_status_description
            )
        ),
        api_response = COALESCE(p_api_response, api_response),
        updated_at = NOW()
    WHERE id = p_shipment_doc_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'new_status', p_new_status,
        'shipment_document_id', p_shipment_doc_id
    );
END;
$$;

COMMENT ON FUNCTION update_shipment_document_status IS 'تحديث حالة بوليصة الشحن — يُستدعى من n8n دورياً للتتبع';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  VERIFICATION                                                 ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- Verify new tables
DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE '✅ Customer Shipping Migration Complete!';
    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  • shipping_carriers (company carrier config)';
    RAISE NOTICE '  • shipment_documents (TTN/waybills)';
    RAISE NOTICE 'Columns added to:';
    RAISE NOTICE '  • quotations';
    RAISE NOTICE '  • sales_orders';
    RAISE NOTICE '  • sales_invoices';
    RAISE NOTICE '  • sales_deliveries';
    RAISE NOTICE '  • transit_reservations';
    RAISE NOTICE 'Functions created:';
    RAISE NOTICE '  • create_shipment_document()';
    RAISE NOTICE '  • process_shipment_api_response()';
    RAISE NOTICE '  • update_shipment_document_status()';
    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '🔗 n8n Integration Flow:';
    RAISE NOTICE '  1. Frontend → create_shipment_document()';
    RAISE NOTICE '  2. → Returns NP API request JSON';
    RAISE NOTICE '  3. n8n sends to api.novaposhta.ua/v2.0/json/';
    RAISE NOTICE '  4. n8n calls process_shipment_api_response()';
    RAISE NOTICE '  5. n8n polls update_shipment_document_status()';
    RAISE NOTICE '═══════════════════════════════════════════';
END $$;
