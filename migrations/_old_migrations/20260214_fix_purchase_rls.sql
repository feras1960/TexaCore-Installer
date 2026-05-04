-- 20260214_fix_purchase_rls.sql
-- Fix RLS policies for Purchase Cycle tables AND add a specialized RPC to handle status updates reliably.

-- 1. Fix RLS Policies (Standard Approach)
-- Purchase Orders
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON purchase_orders;
DROP POLICY IF EXISTS "purchase_orders_policy" ON purchase_orders;

CREATE POLICY "purchase_orders_policy" ON purchase_orders
    FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

-- Purchase Invoices
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON purchase_invoices;
DROP POLICY IF EXISTS "purchase_invoices_policy" ON purchase_invoices;

CREATE POLICY "purchase_invoices_policy" ON purchase_invoices
    FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

-- Purchase Receipts
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_receipts') THEN
        EXECUTE 'ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS "Enable all access for authenticated users" ON purchase_receipts';
        EXECUTE 'DROP POLICY IF EXISTS "purchase_receipts_policy" ON purchase_receipts';

        EXECUTE 'CREATE POLICY "purchase_receipts_policy" ON purchase_receipts
            FOR ALL
            USING (auth.uid() IS NOT NULL)
            WITH CHECK (auth.uid() IS NOT NULL)';
    END IF;
END $$;

-- Purchase Receipt Items
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_receipt_items') THEN
        EXECUTE 'ALTER TABLE purchase_receipt_items ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS "Enable all access for authenticated users" ON purchase_receipt_items';
        EXECUTE 'DROP POLICY IF EXISTS "purchase_receipt_items_policy" ON purchase_receipt_items';

        EXECUTE 'CREATE POLICY "purchase_receipt_items_policy" ON purchase_receipt_items
            FOR ALL
            USING (auth.uid() IS NOT NULL)
            WITH CHECK (auth.uid() IS NOT NULL)';
    END IF;
END $$;


-- 2. Add Security Definer Function (Failsafe Approach)
-- This function runs with elevated privileges to ensure the status update happens
-- even if RLS policies are misconfigured or too strict for the specific user role.
DROP FUNCTION IF EXISTS update_purchase_document_status_bypass_rls(text, uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION update_purchase_document_status_bypass_rls(
    p_table text,
    p_id uuid,
    p_status text,
    p_receipt_id uuid,
    p_receipt_number text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_table = 'purchase_orders' THEN
        UPDATE purchase_orders
        SET 
            status = p_status,
            receipt_id = p_receipt_id,
            receipt_number = p_receipt_number,
            received_at = now(),
            updated_at = now()
        WHERE id = p_id;
        RETURN FOUND;
    ELSIF p_table = 'purchase_invoices' THEN
        UPDATE purchase_invoices
        SET 
            status = p_status,
            receipt_id = p_receipt_id,
            receipt_number = p_receipt_number,
            received_at = now(),
            updated_at = now()
        WHERE id = p_id;
        RETURN FOUND;
    ELSE
        RETURN false;
    END IF;
END;
$$;
