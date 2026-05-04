-- ═══════════════════════════════════════════════════════════════
-- Migration: توحيد جدول الكونتينرات — إضافة الأعمدة الناقصة
-- Date: 2026-02-16
-- Purpose: جدول containers كان يفتقر لأعمدة الشحن التي يقرأها 
--          ContainersList. هذا يوحّد الأعمدة ليتطابق مع الواجهة.
-- ═══════════════════════════════════════════════════════════════

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        -- ─── أعمدة الشحن ───
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS shipment_number VARCHAR(50)';
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id)';
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS shipping_company VARCHAR(200)';
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS vessel_name VARCHAR(200)';
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS eta DATE';
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS etd DATE';
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS port_of_loading VARCHAR(200)';
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS port_of_discharge VARCHAR(200)';

        -- ─── أعمدة التكلفة ───
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT ''USD''';
        EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS total_cost DECIMAL(15,2) DEFAULT 0';

        -- ─── ربط الشحنة بالكونتينر (اختياري) ───
        -- We must check if shipments table exists to avoid errors on the FK
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shipments') THEN
            EXECUTE 'ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS shipment_id UUID REFERENCES shipments(id)';
        END IF;

        -- ─── فهرس ───
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_containers_supplier ON containers(supplier_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_containers_shipment_number ON containers(tenant_id, shipment_number)';

        EXECUTE 'COMMENT ON COLUMN public.containers.shipment_number IS ''رقم مرجعي للشحنة''';
        EXECUTE 'COMMENT ON COLUMN public.containers.supplier_id IS ''المورد المرتبط بالكونتينر''';
        EXECUTE 'COMMENT ON COLUMN public.containers.shipping_company IS ''شركة الشحن''';
        EXECUTE 'COMMENT ON COLUMN public.containers.vessel_name IS ''اسم السفينة''';
        EXECUTE 'COMMENT ON COLUMN public.containers.eta IS ''تاريخ الوصول المتوقع''';
        EXECUTE 'COMMENT ON COLUMN public.containers.shipment_id IS ''ربط اختياري بجدول shipments للتكلفة المفصلة''';
    END IF;
END $$;
