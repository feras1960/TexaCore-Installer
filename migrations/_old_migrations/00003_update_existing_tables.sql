-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: تحديث الجداول الموجودة لإضافة tenant_id والحقول الجديدة
-- Migration: Update Existing Tables to Add tenant_id and New Fields
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. تحديث جدول companies
-- ═══════════════════════════════════════════════════════════════

-- الحصول على tenant_id الافتراضي
DO $$
DECLARE
    v_default_tenant_id UUID;
BEGIN
    SELECT id INTO v_default_tenant_id FROM tenants WHERE code = 'default' LIMIT 1;
    
    IF v_default_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Default tenant not found. Please run migration 00002 first.';
    END IF;
    
    -- إضافة tenant_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'companies' AND column_name = 'tenant_id') THEN
        ALTER TABLE companies 
        ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
        
        -- تعيين tenant_id الافتراضي للبيانات الموجودة
        UPDATE companies SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
        
        -- جعل الحقل NOT NULL
        ALTER TABLE companies ALTER COLUMN tenant_id SET NOT NULL;
    END IF;
    
    -- إضافة code إذا لم يكن موجوداً
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'companies' AND column_name = 'code') THEN
        ALTER TABLE companies ADD COLUMN code VARCHAR(50);
        
        -- توليد codes للبيانات الموجودة
        WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER () as rn FROM companies WHERE code IS NULL
        )
        UPDATE companies c
        SET code = 'COMP-' || LPAD(n.rn::TEXT, 4, '0')
        FROM numbered n
        WHERE c.id = n.id;
        
        ALTER TABLE companies ALTER COLUMN code SET NOT NULL;
    END IF;
    
    -- إضافة الحقول الجديدة
    ALTER TABLE companies 
        ADD COLUMN IF NOT EXISTS name_ar VARCHAR(200),
        ADD COLUMN IF NOT EXISTS name_en VARCHAR(200),
        ADD COLUMN IF NOT EXISTS legal_name VARCHAR(300),
        ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
        ADD COLUMN IF NOT EXISTS country VARCHAR(100),
        ADD COLUMN IF NOT EXISTS city VARCHAR(100),
        ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20),
        ADD COLUMN IF NOT EXISTS mobile VARCHAR(50),
        ADD COLUMN IF NOT EXISTS website VARCHAR(200),
        ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3) DEFAULT 'USD',
        ADD COLUMN IF NOT EXISTS fiscal_year_start INT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
    
    -- نسخ name إلى name_ar إذا كان name_ar فارغاً
    UPDATE companies SET name_ar = name WHERE name_ar IS NULL OR name_ar = '';
    
    -- نسخ name إلى name_en إذا كان name_en فارغاً
    UPDATE companies SET name_en = name WHERE name_en IS NULL OR name_en = '';
    
    -- إزالة constraint القديم وإضافة الجديد
    ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_code_key CASCADE;
    CREATE UNIQUE INDEX IF NOT EXISTS companies_tenant_code_unique 
        ON companies(tenant_id, code);
    
    RAISE NOTICE 'Companies table updated successfully';
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. تحديث جدول branches
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_default_tenant_id UUID;
BEGIN
    SELECT id INTO v_default_tenant_id FROM tenants WHERE code = 'default' LIMIT 1;
    
    -- إضافة tenant_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'branches' AND column_name = 'tenant_id') THEN
        ALTER TABLE branches 
        ADD COLUMN tenant_id UUID;
        
        -- تعيين tenant_id من company
        UPDATE branches b
        SET tenant_id = c.tenant_id
        FROM companies c
        WHERE b.company_id = c.id;
        
        ALTER TABLE branches ALTER COLUMN tenant_id SET NOT NULL;
        ALTER TABLE branches ADD CONSTRAINT branches_tenant_fk 
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    END IF;
    
    -- إضافة code إذا لم يكن موجوداً
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'branches' AND column_name = 'code') THEN
        ALTER TABLE branches ADD COLUMN code VARCHAR(50);
        
        -- توليد codes للبيانات الموجودة
        WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at) as rn 
            FROM branches WHERE code IS NULL
        )
        UPDATE branches b
        SET code = 'BR-' || LPAD(n.rn::TEXT, 3, '0')
        FROM numbered n
        WHERE b.id = n.id;
        
        ALTER TABLE branches ALTER COLUMN code SET NOT NULL;
    END IF;
    
    -- إضافة الحقول الجديدة
    ALTER TABLE branches 
        ADD COLUMN IF NOT EXISTS name_ar VARCHAR(200),
        ADD COLUMN IF NOT EXISTS name_en VARCHAR(200),
        ADD COLUMN IF NOT EXISTS branch_type VARCHAR(50) DEFAULT 'branch',
        ADD COLUMN IF NOT EXISTS country VARCHAR(100),
        ADD COLUMN IF NOT EXISTS city VARCHAR(100),
        ADD COLUMN IF NOT EXISTS manager_id UUID,
        ADD COLUMN IF NOT EXISTS default_warehouse_id UUID,
        ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3),
        ADD COLUMN IF NOT EXISTS working_hours JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
    
    -- نسخ name إلى name_ar
    UPDATE branches SET name_ar = name WHERE name_ar IS NULL OR name_ar = '';
    
    -- نسخ name إلى name_en
    UPDATE branches SET name_en = name WHERE name_en IS NULL OR name_en = '';
    
    -- إضافة UNIQUE constraint
    CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_company_code_unique 
        ON branches(tenant_id, company_id, code);
    
    RAISE NOTICE 'Branches table updated successfully';
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. تحديث جدول currencies
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_default_tenant_id UUID;
BEGIN
    SELECT id INTO v_default_tenant_id FROM tenants WHERE code = 'default' LIMIT 1;
    
    -- إضافة tenant_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'currencies' AND column_name = 'tenant_id') THEN
        ALTER TABLE currencies 
        ADD COLUMN tenant_id UUID;
        
        -- تعيين tenant_id الافتراضي للبيانات الموجودة
        UPDATE currencies SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
        
        ALTER TABLE currencies ALTER COLUMN tenant_id SET NOT NULL;
        ALTER TABLE currencies ADD CONSTRAINT currencies_tenant_fk 
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    END IF;
    
    -- إضافة الحقول الجديدة
    ALTER TABLE currencies 
        ADD COLUMN IF NOT EXISTS name_ar VARCHAR(100),
        ADD COLUMN IF NOT EXISTS name_en VARCHAR(100),
        ADD COLUMN IF NOT EXISTS symbol_position VARCHAR(10) DEFAULT 'before',
        ADD COLUMN IF NOT EXISTS decimal_places INT DEFAULT 2,
        ADD COLUMN IF NOT EXISTS thousands_separator VARCHAR(1) DEFAULT ',',
        ADD COLUMN IF NOT EXISTS decimal_separator VARCHAR(1) DEFAULT '.',
        ADD COLUMN IF NOT EXISTS is_base BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(18,8) DEFAULT 1;
    
    -- نسخ name إلى name_ar
    UPDATE currencies SET name_ar = name WHERE name_ar IS NULL OR name_ar = '';
    
    -- نسخ name إلى name_en
    UPDATE currencies SET name_en = name WHERE name_en IS NULL OR name_en = '';
    
    -- تحديث exchange_rate من rate
    UPDATE currencies SET exchange_rate = rate WHERE exchange_rate = 1 AND rate != 1;
    
    -- إزالة constraint القديم وإضافة الجديد
    ALTER TABLE currencies DROP CONSTRAINT IF EXISTS currencies_code_key CASCADE;
    CREATE UNIQUE INDEX IF NOT EXISTS currencies_tenant_code_unique 
        ON currencies(tenant_id, code);
    
    RAISE NOTICE 'Currencies table updated successfully';
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 4. تحديث RLS Policies للجداول المحدثة
-- ═══════════════════════════════════════════════════════════════

-- تحديث policy للـ companies
DROP POLICY IF EXISTS "Users can view their company" ON companies;
CREATE POLICY "Users can view their company" ON companies
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

-- تحديث policy للـ branches
DROP POLICY IF EXISTS "Users can view branches of their company" ON branches;
CREATE POLICY "Users can view branches of their company" ON branches
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

-- تحديث policy للـ currencies
DROP POLICY IF EXISTS "Currencies are viewable by all" ON currencies;
CREATE POLICY "Currencies are viewable by all" ON currencies
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        ) OR tenant_id IS NULL
    );

-- Tenants: يمكن للمستخدمين رؤية tenant الخاص بهم فقط (منقولة من 00002)
DROP POLICY IF EXISTS "Users can view their tenant" ON tenants;
CREATE POLICY "Users can view their tenant" ON tenants
    FOR SELECT USING (
        id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );

-- Subscriptions: يمكن للمستخدمين رؤية اشتراكات tenant الخاص بهم (منقولة من 00002)
DROP POLICY IF EXISTS "Users can view tenant subscriptions" ON subscriptions;
CREATE POLICY "Users can view tenant subscriptions" ON subscriptions
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM companies WHERE id IN (
                SELECT company_id FROM user_profiles WHERE id = auth.uid()
            )
        )
    );
