-- ═══════════════════════════════════════════════════════════════
-- Migration: إصلاح جدول الفروع — إضافة tenant_id
-- Fix branches table — Add tenant_id for multi-tenancy
-- Date: 2026-02-12
-- Phase: 23A-1
-- ═══════════════════════════════════════════════════════════════

-- 1. إضافة tenant_id إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'branches' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE branches ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
        RAISE NOTICE '✅ تمت إضافة tenant_id لجدول branches';
    ELSE
        RAISE NOTICE 'ℹ️ العمود tenant_id موجود مسبقاً في branches';
    END IF;
END $$;

-- 2. تعبئة tenant_id من companies لأي بيانات موجودة
UPDATE branches b
SET tenant_id = c.tenant_id
FROM companies c
WHERE b.company_id = c.id
AND b.tenant_id IS NULL;

-- 3. جعل tenant_id مطلوب (بعد التعبئة)
DO $$
BEGIN
    -- تحقق أنه لا يوجد null values
    IF NOT EXISTS (SELECT 1 FROM branches WHERE tenant_id IS NULL) THEN
        ALTER TABLE branches ALTER COLUMN tenant_id SET NOT NULL;
        RAISE NOTICE '✅ تم جعل tenant_id مطلوب في branches';
    ELSE
        RAISE NOTICE '⚠️ يوجد سجلات بدون tenant_id — لم يتم تطبيق NOT NULL';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️ لم يتم تطبيق NOT NULL: %', SQLERRM;
END $$;

-- 4. إضافة أعمدة إدارية إضافية
DO $$
BEGIN
    -- is_active
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'branches' AND column_name = 'is_active'
    ) THEN
        ALTER TABLE branches ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    END IF;

    -- manager_id (مدير الفرع)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'branches' AND column_name = 'manager_id'
    ) THEN
        ALTER TABLE branches ADD COLUMN manager_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
    END IF;

    -- city
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'branches' AND column_name = 'city'
    ) THEN
        ALTER TABLE branches ADD COLUMN city VARCHAR(100);
    END IF;

    -- country
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'branches' AND column_name = 'country'
    ) THEN
        ALTER TABLE branches ADD COLUMN country VARCHAR(100);
    END IF;

    RAISE NOTICE '✅ تمت إضافة الأعمدة الإدارية لجدول branches';
END $$;

-- 5. فهارس
CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_branches_company ON branches(company_id);
CREATE INDEX IF NOT EXISTS idx_branches_active ON branches(is_active);

-- 6. تحديث RLS — إضافة سياسات INSERT/UPDATE/DELETE
-- (سياسة SELECT موجودة أصلاً)

-- سياسة الإضافة
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'branches' 
        AND policyname = 'Admin can insert branches'
    ) THEN
        CREATE POLICY "Admin can insert branches" ON branches
            FOR INSERT WITH CHECK (
                company_id IN (
                    SELECT company_id FROM user_profiles WHERE id = auth.uid()
                )
            );
        RAISE NOTICE '✅ تم إنشاء سياسة INSERT للفروع';
    END IF;
END $$;

-- سياسة التعديل
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'branches' 
        AND policyname = 'Admin can update branches'
    ) THEN
        CREATE POLICY "Admin can update branches" ON branches
            FOR UPDATE USING (
                company_id IN (
                    SELECT company_id FROM user_profiles WHERE id = auth.uid()
                )
            );
        RAISE NOTICE '✅ تم إنشاء سياسة UPDATE للفروع';
    END IF;
END $$;

-- سياسة الحذف
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'branches' 
        AND policyname = 'Admin can delete branches'
    ) THEN
        CREATE POLICY "Admin can delete branches" ON branches
            FOR DELETE USING (
                company_id IN (
                    SELECT company_id FROM user_profiles WHERE id = auth.uid()
                )
            );
        RAISE NOTICE '✅ تم إنشاء سياسة DELETE للفروع';
    END IF;
END $$;

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE '✅ Phase 23A-1: تم إصلاح جدول الفروع بنجاح';
    RAISE NOTICE '═══════════════════════════════════════════════';
END $$;
