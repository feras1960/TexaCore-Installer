-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة حقول المندوب والتسعير الذكي لجداول المبيعات
-- Add Salesperson & Smart Pricing Fields to Sales Tables
-- Date: 2026-02-11
-- Author: Unified Trade Sheet V2 — Phase 4
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- Changes:
--   1. salesperson_id → quotations, sales_orders, sales_invoices, sales_returns, sales_deliveries
--   2. due_date, payment_terms_days → quotations (already in orders/invoices)
--   3. exchange_rate → sales_returns, sales_deliveries (already in quotations/orders/invoices)
--   4. discount_percent → quotations, sales_orders, sales_invoices
--   5. price_list_id → quotations, sales_orders, sales_invoices
--   6. Indexes for salesperson lookups
--
-- Compatibility:
--   ✅ All IF NOT EXISTS — safe to re-run
--   ✅ No breaking changes (all nullable columns with defaults)
--   ✅ No RLS changes needed (table policies apply to all columns)
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- 1. حقل المندوب (salesperson_id) — لكل جداول المبيعات
-- ═══════════════════════════════════════════════════════════════

-- quotations — عروض الأسعار
ALTER TABLE quotations 
    ADD COLUMN IF NOT EXISTS salesperson_id UUID;

-- sales_orders — أوامر البيع
ALTER TABLE sales_orders 
    ADD COLUMN IF NOT EXISTS salesperson_id UUID;

-- sales_invoices — فواتير المبيعات
ALTER TABLE sales_invoices 
    ADD COLUMN IF NOT EXISTS salesperson_id UUID;

-- sales_returns — مرتجعات المبيعات
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_returns') THEN
        EXECUTE 'ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS salesperson_id UUID';
    END IF;
END $$;

-- sales_deliveries — أذونات التسليم
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_deliveries') THEN
        EXECUTE 'ALTER TABLE sales_deliveries ADD COLUMN IF NOT EXISTS salesperson_id UUID';
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 2. حقول تاريخ الاستحقاق وشروط الدفع — للعروض
--    (موجود مسبقاً في sales_orders و sales_invoices)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE quotations 
    ADD COLUMN IF NOT EXISTS due_date DATE,
    ADD COLUMN IF NOT EXISTS payment_terms_days INT DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════
-- 3. سعر الصرف — للجداول التي تفتقده
--    (موجود مسبقاً في quotations, sales_orders, sales_invoices)
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_returns') THEN
        EXECUTE 'ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(18,8) DEFAULT 1';
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_deliveries') THEN
        EXECUTE 'ALTER TABLE sales_deliveries ADD COLUMN IF NOT EXISTS currency VARCHAR(3)';
        EXECUTE 'ALTER TABLE sales_deliveries ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(18,8) DEFAULT 1';
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 4. نسبة الخصم على مستوى المستند (من ملف العميل)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE quotations 
    ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) DEFAULT 0;

ALTER TABLE sales_orders 
    ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) DEFAULT 0;

ALTER TABLE sales_invoices 
    ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════
-- 5. رقم قائمة الأسعار المستخدمة (لتتبع المصدر)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE quotations 
    ADD COLUMN IF NOT EXISTS price_list_id UUID;

ALTER TABLE sales_orders 
    ADD COLUMN IF NOT EXISTS price_list_id UUID;

ALTER TABLE sales_invoices 
    ADD COLUMN IF NOT EXISTS price_list_id UUID;


-- ═══════════════════════════════════════════════════════════════
-- 6. الفهارس (Indexes) — لبحث المندوب
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_quotations_salesperson 
    ON quotations(salesperson_id);

CREATE INDEX IF NOT EXISTS idx_sales_orders_salesperson 
    ON sales_orders(salesperson_id);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_salesperson 
    ON sales_invoices(salesperson_id);

-- Conditional indexes for tables that may not exist
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_returns') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_returns_salesperson ON sales_returns(salesperson_id)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_deliveries') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_deliveries_salesperson ON sales_deliveries(salesperson_id)';
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 7. تعليقات (Comments)
-- ═══════════════════════════════════════════════════════════════

COMMENT ON COLUMN quotations.salesperson_id IS 'معرف المندوب / Sales person ID';
COMMENT ON COLUMN sales_orders.salesperson_id IS 'معرف المندوب / Sales person ID';
COMMENT ON COLUMN sales_invoices.salesperson_id IS 'معرف المندوب / Sales person ID';
COMMENT ON COLUMN quotations.discount_percent IS 'نسبة الخصم الموروثة من ملف العميل / Customer profile discount %';
COMMENT ON COLUMN sales_orders.discount_percent IS 'نسبة الخصم الموروثة من ملف العميل / Customer profile discount %';
COMMENT ON COLUMN sales_invoices.discount_percent IS 'نسبة الخصم الموروثة من ملف العميل / Customer profile discount %';
COMMENT ON COLUMN quotations.price_list_id IS 'قائمة الأسعار المستخدمة / Price list used for this document';
COMMENT ON COLUMN sales_orders.price_list_id IS 'قائمة الأسعار المستخدمة / Price list used for this document';
COMMENT ON COLUMN sales_invoices.price_list_id IS 'قائمة الأسعار المستخدمة / Price list used for this document';


-- ═══════════════════════════════════════════════════════════════
-- 8. إعادة تحميل كاش PostgREST
-- ═══════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════
-- 9. التحقق والتقرير
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_count INT := 0;
    v_table TEXT;
    v_col TEXT;
BEGIN
    -- Verify all new columns exist
    FOR v_table, v_col IN VALUES
        ('quotations', 'salesperson_id'),
        ('quotations', 'due_date'),
        ('quotations', 'payment_terms_days'),
        ('quotations', 'discount_percent'),
        ('quotations', 'price_list_id'),
        ('sales_orders', 'salesperson_id'),
        ('sales_orders', 'discount_percent'),
        ('sales_orders', 'price_list_id'),
        ('sales_invoices', 'salesperson_id'),
        ('sales_invoices', 'discount_percent'),
        ('sales_invoices', 'price_list_id')
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = v_table 
            AND column_name = v_col
        ) THEN
            v_count := v_count + 1;
            RAISE NOTICE '  ✅ %.% — exists', v_table, v_col;
        ELSE
            RAISE WARNING '  ❌ %.% — MISSING!', v_table, v_col;
        END IF;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ Migration Complete! % of 11 columns verified.', v_count;
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
