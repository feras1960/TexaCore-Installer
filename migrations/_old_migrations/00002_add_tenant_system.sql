-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة نظام Multi-Tenant (SaaS)
-- Migration: Add Multi-Tenant (SaaS) System
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════
-- 1. SaaS Control Plane Tables
-- ═══════════════════════════════════════════════════════════════

-- المنتجات (TexaCore, FinCore, etc.)
CREATE TABLE IF NOT EXISTS saas_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100),
    domain VARCHAR(200),
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#3B82F6',
    description TEXT,
    default_modules JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- الموديولات المتاحة
CREATE TABLE IF NOT EXISTS system_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    description TEXT,
    icon VARCHAR(50),
    category VARCHAR(50) NOT NULL DEFAULT 'basic',
    dependencies JSONB DEFAULT '[]',
    is_core BOOLEAN DEFAULT false,
    price_monthly DECIMAL(10,2) DEFAULT 0,
    price_yearly DECIMAL(10,2) DEFAULT 0,
    available_in_products JSONB DEFAULT '["*"]',
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- الباقات
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES saas_products(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    description TEXT,
    max_users INT DEFAULT 5,
    max_companies INT DEFAULT 1,
    max_branches INT DEFAULT 3,
    max_warehouses INT DEFAULT 5,
    max_products INT DEFAULT 1000,
    storage_gb INT DEFAULT 5,
    included_modules JSONB DEFAULT '[]',
    features JSONB DEFAULT '{}',
    price_monthly DECIMAL(10,2),
    price_yearly DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'USD',
    trial_days INT DEFAULT 14,
    is_popular BOOLEAN DEFAULT false,
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(product_id, code)
);

-- عملاء SaaS (Tenants)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(200) NOT NULL UNIQUE,
    phone VARCHAR(50),
    country VARCHAR(100),
    timezone VARCHAR(50) DEFAULT 'UTC',
    default_language VARCHAR(5) DEFAULT 'ar',
    database_name VARCHAR(100),
    database_status VARCHAR(20) DEFAULT 'pending',
    status VARCHAR(20) DEFAULT 'active',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- اشتراكات العملاء
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES saas_products(id),
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status VARCHAR(20) DEFAULT 'trial',
    trial_ends_at TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT false,
    cancelled_at TIMESTAMPTZ,
    payment_method VARCHAR(50),
    billing_email VARCHAR(200),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- الموديولات المفعلة لكل عميل
CREATE TABLE IF NOT EXISTS tenant_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    module_code VARCHAR(50) NOT NULL,
    enabled_at TIMESTAMPTZ DEFAULT NOW(),
    enabled_by UUID,
    expires_at TIMESTAMPTZ,
    price_monthly DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    UNIQUE(tenant_id, module_code)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. إنشاء Tenant افتراضي للبيانات الحالية
-- ═══════════════════════════════════════════════════════════════

-- إنشاء tenant افتراضي
DO $$
DECLARE
    v_default_tenant_id UUID;
BEGIN
    -- إنشاء tenant افتراضي
    INSERT INTO tenants (code, name, email, status, default_language)
    VALUES ('default', 'Default Tenant', 'default@erp.local', 'active', 'ar')
    ON CONFLICT (code) DO NOTHING
    RETURNING id INTO v_default_tenant_id;
    
    -- إذا لم يتم إنشاء tenant (موجود مسبقاً)، احصل على ID
    IF v_default_tenant_id IS NULL THEN
        SELECT id INTO v_default_tenant_id FROM tenants WHERE code = 'default';
    END IF;
    
    RAISE NOTICE 'Default tenant ID: %', v_default_tenant_id;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. إدراج البيانات الأساسية
-- ═══════════════════════════════════════════════════════════════

-- المنتجات
INSERT INTO saas_products (code, name, name_ar, domain, default_modules) VALUES
('texacore', 'TexaCore', 'تيكساكور', 'texacore.com', '["core", "inventory", "sales", "purchases", "accounting", "fabric"]'),
('fincore', 'FinCore', 'فين كور', 'fincore.com', '["core", "exchange", "accounting", "customers"]'),
('erpcore', 'ERPCore', 'إي آر بي كور', 'erpcore.com', '["core", "inventory", "sales", "purchases", "accounting"]')
ON CONFLICT (code) DO NOTHING;

-- الموديولات
INSERT INTO system_modules (code, name_ar, name_en, category, is_core, dependencies, display_order) VALUES
('core', 'النظام الأساسي', 'Core System', 'core', true, '[]', 1),
('users', 'المستخدمين والصلاحيات', 'Users & Permissions', 'core', true, '["core"]', 2),
('companies', 'الشركات والفروع', 'Companies & Branches', 'core', true, '["core"]', 3),
('inventory', 'إدارة المخزون', 'Inventory', 'basic', false, '["core"]', 10),
('sales', 'المبيعات', 'Sales', 'basic', false, '["core", "inventory"]', 11),
('purchases', 'المشتريات', 'Purchases', 'basic', false, '["core", "inventory"]', 12),
('accounting', 'المحاسبة', 'Accounting', 'basic', false, '["core"]', 13),
('customers', 'العملاء', 'Customers', 'basic', false, '["core"]', 14),
('suppliers', 'الموردين', 'Suppliers', 'basic', false, '["core"]', 15),
('fabric', 'إدارة الأقمشة', 'Fabric Management', 'specialized', false, '["core", "inventory"]', 20),
('exchange', 'الصرافة والحوالات', 'Exchange & Remittances', 'specialized', false, '["core", "accounting"]', 21)
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 4. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_modules_tenant ON tenant_modules(tenant_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS Policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;

-- Tenants: يمكن للمستخدمين رؤية tenant الخاص بهم فقط
-- سيتم إضافة الصلاحيات لاحقاً بعد إضافة tenant_id إلى جدول companies

-- Subscriptions: يمكن للمستخدمين رؤية اشتراكات tenant الخاص بهم
-- سيتم إضافة الصلاحيات لاحقاً بعد إضافة tenant_id إلى جدول companies
