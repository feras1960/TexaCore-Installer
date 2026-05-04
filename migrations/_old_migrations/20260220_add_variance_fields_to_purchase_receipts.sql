-- ════════════════════════════════════════════════════════════
-- Migration: Add Variance Fields to purchase_receipts
-- Date: 2026-02-20
-- Purpose: Track quantity variance per receipt for accountant/manager review
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_receipts') THEN
        EXECUTE '
        ALTER TABLE purchase_receipts
            ADD COLUMN IF NOT EXISTS variance_status  TEXT    DEFAULT ''ok''   
                CHECK (variance_status IN (''ok'', ''requires_review'', ''reviewed'', ''approved'', ''adjusted'')),
            ADD COLUMN IF NOT EXISTS variance_amount  NUMERIC(12,3) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS variance_pct     NUMERIC(7,4)  DEFAULT 0,
            ADD COLUMN IF NOT EXISTS variance_tolerance_pct NUMERIC(5,2) DEFAULT 1';

        EXECUTE 'COMMENT ON COLUMN purchase_receipts.variance_status IS ''ok=within tolerance, requires_review=out-of-tolerance, reviewed=seen by accountant, approved=accepted, adjusted=credit/debit note created''';
        EXECUTE 'COMMENT ON COLUMN purchase_receipts.variance_amount IS ''Difference in meters: positive=excess, negative=shortage''';
        EXECUTE 'COMMENT ON COLUMN purchase_receipts.variance_pct IS ''Variance as percentage of expected quantity''';
        EXECUTE 'COMMENT ON COLUMN purchase_receipts.variance_tolerance_pct IS ''Tolerance applied at time of receipt (from document or company settings)''';
    END IF;
END $$;

-- 2. Add per-document tolerance override fields
--    (allows each invoice/container to have its own tolerance)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_invoices') THEN
        EXECUTE '
        ALTER TABLE purchase_invoices
            ADD COLUMN IF NOT EXISTS variance_tolerance_pct NUMERIC(5,2) DEFAULT NULL';
        
        EXECUTE 'COMMENT ON COLUMN purchase_invoices.variance_tolerance_pct IS ''Optional tolerance override for this invoice. NULL = use company default (1%)''';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shipment_containers') THEN
        EXECUTE '
        ALTER TABLE shipment_containers
            ADD COLUMN IF NOT EXISTS variance_tolerance_pct NUMERIC(5,2) DEFAULT NULL';
        
        EXECUTE 'COMMENT ON COLUMN shipment_containers.variance_tolerance_pct IS ''Optional tolerance override for this container. NULL = use company default (1%)''';
    END IF;
END $$;

-- 3. Add company-level default tolerance in company_settings
--    (stored in the existing JSONB settings column)
-- No ALTER needed — stored as: settings->'receipt'->>'variance_tolerance_pct'
-- Access via: (settings->'receipt'->>'variance_tolerance_pct')::numeric

-- 4. Index for fast lookup of receipts needing review
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_receipts') THEN
        EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_purchase_receipts_variance_status
            ON purchase_receipts (company_id, variance_status)
            WHERE variance_status = ''requires_review''';
    END IF;
END $$;

-- 5. Helpful view for accountants to see pending variance reviews
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_receipts') AND 
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_invoices') AND 
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_orders') AND 
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shipment_containers') THEN
        EXECUTE '
        CREATE OR REPLACE VIEW v_receipt_variance_review AS
        SELECT
            pr.id,
            pr.receipt_number,
            pr.receipt_date,
            pr.company_id,
            pr.warehouse_id,
            pr.variance_status,
            pr.variance_amount,
            pr.variance_pct,
            pr.variance_tolerance_pct,
            -- Source document info
            COALESCE(pi.document_number, po.order_number, sc.container_number) AS source_doc_number,
            COALESCE(pi.supplier_id,     po.supplier_id,  sc.supplier_id)      AS supplier_id,
            pr.invoice_id,
            pr.order_id,
            pr.container_id,
            pr.created_at
        FROM purchase_receipts pr
        LEFT JOIN purchase_invoices       pi ON pr.invoice_id   = pi.id
        LEFT JOIN purchase_orders         po ON pr.order_id     = po.id
        LEFT JOIN shipment_containers     sc ON pr.container_id = sc.id
        WHERE pr.variance_status = ''requires_review''
          AND pr.status = ''completed''
        ORDER BY pr.created_at DESC';

        EXECUTE 'COMMENT ON VIEW v_receipt_variance_review IS ''Shows completed receipts with out-of-tolerance variance, awaiting accountant/manager action''';
    END IF;
END $$;
