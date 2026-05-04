-- ══════════════════════════════════════════════════════════════
-- 🚛 Phase 5: Drivers Table (جدول السائقين)
-- ══════════════════════════════════════════════════════════════
-- Links drivers to users, branches, and vehicles
-- Referenced by sales_transactions.driver_id

CREATE TABLE IF NOT EXISTS drivers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID NOT NULL REFERENCES companies(id),
    
    -- الربط مع المستخدم (اختياري — السائق قد يكون موظفاً مسجلاً أو لا)
    user_id UUID REFERENCES auth.users(id),
    
    -- بيانات السائق الأساسية
    name_ar TEXT NOT NULL,
    name_en TEXT,
    phone TEXT,
    id_number TEXT,           -- رقم الهوية / الإقامة / الجواز
    license_number TEXT,      -- رقم رخصة القيادة
    license_expiry DATE,      -- تاريخ انتهاء الرخصة
    
    -- السيارة الحالية
    vehicle_number TEXT,      -- رقم لوحة السيارة
    vehicle_type TEXT,        -- نوع السيارة (شاحنة، فان، سيارة)
    vehicle_model TEXT,       -- موديل السيارة
    
    -- الفرع المرتبط
    branch_id UUID REFERENCES branches(id),
    
    -- الحالة
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave')),
    
    -- ملاحظات
    notes TEXT,
    avatar_url TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    -- Constraints
    UNIQUE(company_id, phone),
    UNIQUE(company_id, id_number)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_drivers_company ON drivers(company_id);
CREATE INDEX IF NOT EXISTS idx_drivers_branch ON drivers(branch_id);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(company_id, status);
CREATE INDEX IF NOT EXISTS idx_drivers_user ON drivers(user_id);

-- Enable RLS
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "drivers_select" ON drivers;
CREATE POLICY "drivers_select" ON drivers FOR SELECT
    USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "drivers_insert" ON drivers;
CREATE POLICY "drivers_insert" ON drivers FOR INSERT
    WITH CHECK (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "drivers_update" ON drivers;
CREATE POLICY "drivers_update" ON drivers FOR UPDATE
    USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "drivers_delete" ON drivers;
CREATE POLICY "drivers_delete" ON drivers FOR DELETE
    USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- Foreign key from sales_transactions to drivers
-- (driver_id column was already added in delivery_workflow_phase1 migration)
-- Just add the foreign key constraint if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_sales_transactions_driver'
    ) THEN
        ALTER TABLE sales_transactions 
        ADD CONSTRAINT fk_sales_transactions_driver 
        FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Comment
COMMENT ON TABLE drivers IS 'سائقي التوصيل — مرتبطون بالفروع والمستخدمين والفواتير';
