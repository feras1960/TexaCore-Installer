-- ═══════════════════════════════════════════════════════════════
-- 🔄 Make stock_transfers warehouse columns nullable for drafts
-- Drafts can be saved without selecting warehouses.
-- Confirmation (posting) will validate in the application layer.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE stock_transfers 
  ALTER COLUMN from_warehouse_id DROP NOT NULL;

ALTER TABLE stock_transfers 
  ALTER COLUMN to_warehouse_id DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN stock_transfers.from_warehouse_id IS 'Source warehouse. NULL allowed for drafts; required on confirmation.';
COMMENT ON COLUMN stock_transfers.to_warehouse_id IS 'Destination warehouse. NULL allowed for drafts; required on confirmation.';
