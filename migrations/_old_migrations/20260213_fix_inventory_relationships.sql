
-- Fix inventory_movements relationships and ensure schema compatibility

DO $$
BEGIN
    -- 1. Ensure material_id column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_movements' AND column_name = 'material_id') THEN
        ALTER TABLE inventory_movements ADD COLUMN material_id UUID;
    END IF;

    -- 2. inventory_movements -> warehouses (from)
    -- Re-establish constraint with explicit name for PostgREST detection
    ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_from_warehouse_id_fkey;
    ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_from_warehouse_id_fkey 
        FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id);

    -- 3. inventory_movements -> warehouses (to)
    ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_to_warehouse_id_fkey;
    ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_to_warehouse_id_fkey 
        FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id);

    -- 4. Create roll_reservations if not exists (to fix 404s and enable reservations tab)
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'roll_reservations') THEN
        CREATE TABLE roll_reservations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID,
            company_id UUID,
            material_id UUID,
            roll_id UUID,
            customer_id UUID REFERENCES customers(id),
            reserved_at TIMESTAMPTZ DEFAULT NOW(),
            reserved_until DATE,
            status VARCHAR(50) DEFAULT 'active',
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            created_by UUID
        );
        
        ALTER TABLE roll_reservations ENABLE ROW LEVEL SECURITY;
        
        -- Simple policy for now
        execute 'CREATE POLICY "Enable all access for authenticated users" ON roll_reservations FOR ALL TO authenticated USING (true) WITH CHECK (true)';
    END IF;

    -- 5. Reload schema cache
    NOTIFY pgrst, 'reload config';
END $$;
