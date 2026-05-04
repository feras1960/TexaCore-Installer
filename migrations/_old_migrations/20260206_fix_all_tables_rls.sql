-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: All remaining tables RLS policies
-- الزبائن، الموردين، القيود، الحركات
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- CUSTOMERS - الزبائن
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'customers'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON customers';
    END LOOP;
END $$;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_read" ON customers
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "customers_write" ON customers
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- SUPPLIERS - الموردين
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'suppliers'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON suppliers';
    END LOOP;
END $$;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_read" ON suppliers
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "suppliers_write" ON suppliers
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTS - المنتجات
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'products'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON products';
    END LOOP;
END $$;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_read" ON products
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "products_write" ON products
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- WAREHOUSES - المستودعات
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'warehouses'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON warehouses';
    END LOOP;
END $$;

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouses_read" ON warehouses
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "warehouses_write" ON warehouses
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- INVENTORY_MOVEMENTS - حركات المخزون
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'inventory_movements'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON inventory_movements';
    END LOOP;
END $$;

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_mov_read" ON inventory_movements
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "inv_mov_write" ON inventory_movements
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- SALES_INVOICES - فواتير المبيعات
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'sales_invoices'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON sales_invoices';
    END LOOP;
END $$;

ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_inv_read" ON sales_invoices
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "sales_inv_write" ON sales_invoices
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- PURCHASE_INVOICES - فواتير المشتريات
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'purchase_invoices'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON purchase_invoices';
    END LOOP;
END $$;

ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purch_inv_read" ON purchase_invoices
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "purch_inv_write" ON purchase_invoices
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- PAYMENT_RECEIPTS - سندات القبض
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'payment_receipts'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON payment_receipts';
    END LOOP;
END $$;

ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pay_rec_read" ON payment_receipts
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "pay_rec_write" ON payment_receipts
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- PAYMENT_VOUCHERS - سندات الدفع
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'payment_vouchers'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON payment_vouchers';
    END LOOP;
END $$;

ALTER TABLE payment_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pay_vouch_read" ON payment_vouchers
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "pay_vouch_write" ON payment_vouchers
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- EXCHANGE_RATES - أسعار الصرف
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'exchange_rates'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON exchange_rates';
    END LOOP;
END $$;

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exch_read" ON exchange_rates
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "exch_write" ON exchange_rates
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- CURRENCIES - العملات
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'currencies'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON currencies';
    END LOOP;
END $$;

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "curr_read" ON currencies
    FOR SELECT USING (true);  -- Public read for currencies

CREATE POLICY "curr_write" ON currencies
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNDS - الصناديق
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'cash_accounts'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON cash_accounts';
    END LOOP;
END $$;

ALTER TABLE cash_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_accounts_read" ON cash_accounts
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "cash_accounts_write" ON cash_accounts
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- BRANCHES - الفروع (fix again to ensure it works)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'branches'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON branches';
    END LOOP;
END $$;

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches_read" ON branches
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "branches_write" ON branches
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- Reload schema
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

SELECT '✅ All tables RLS fixed!' as status;
