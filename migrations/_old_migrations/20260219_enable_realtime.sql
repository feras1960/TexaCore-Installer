-- ════════════════════════════════════════════════════════════════
-- Enable Supabase Realtime on warehouse-related tables
-- This is required for real-time updates in the Stock Movements page
-- ════════════════════════════════════════════════════════════════

-- Enable Realtime for key warehouse tables
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'inventory_movements') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE inventory_movements;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_invoices') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE purchase_invoices;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_receipts') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE purchase_receipts;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE containers;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'warehouses') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE warehouses;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_orders') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE purchase_orders;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_transactions') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE purchase_transactions;
        END IF;
    ELSE
        RAISE NOTICE 'publication "supabase_realtime" does not exist, skipping Realtime setup';
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Some tables are already in the publication';
END $$;
