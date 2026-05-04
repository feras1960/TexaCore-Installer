-- ═══════════════════════════════════════════════════════════════
-- إضافة ربط الفاتورة بالكونتينر مباشرة
-- ═══════════════════════════════════════════════════════════════

DO $$ 
BEGIN
    -- 1. Check if containers table exists
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        -- 2. Add container_id to purchase_transactions without FK initially, or with FK if we use EXECUTE
        EXECUTE 'ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS container_id uuid REFERENCES containers(id)';
        EXECUTE 'COMMENT ON COLUMN purchase_transactions.container_id IS ''الكونتينر المرتبط - يُحدّث تلقائياً عند استيراد الفاتورة للكونتينر''';

        -- 3. Index for fast lookups
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_transactions_container_id ON purchase_transactions(container_id) WHERE container_id IS NOT NULL';

        -- 4. Backfill: Link existing invoices that are already in containers
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'container_items') THEN
            EXECUTE '
            UPDATE purchase_transactions pt
            SET container_id = ci.container_id
            FROM (
                SELECT DISTINCT purchase_invoice_id, container_id
                FROM container_items
                WHERE purchase_invoice_id IS NOT NULL
            ) ci
            WHERE pt.id = ci.purchase_invoice_id
            AND pt.container_id IS NULL';
        END IF;
    END IF;
END $$;
