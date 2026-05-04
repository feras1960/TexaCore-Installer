-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: Inventory Stock FK Removal
-- ═══════════════════════════════════════════════════════════════════════════
-- Problem: 'inventory_stock' enforces FK on 'product_id' to 'products' table.
--          But 'inventory_movements' now contains 'material_id' in 'product_id' column
--          (because materials are the main items).
--          Triggers propagate this to 'inventory_stock', causing FK violations.
-- Solution: Drop the FK constraint on 'inventory_stock.product_id'. 
--           The column 'product_id' will now act as a polymorphic ID (Product OR Material).

DO $$
BEGIN
    -- 1. Drop FK constraint on product_id from inventory_stock
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'inventory_stock_product_id_fkey'
        AND table_name = 'inventory_stock'
    ) THEN
        ALTER TABLE inventory_stock DROP CONSTRAINT inventory_stock_product_id_fkey;
        RAISE NOTICE 'Dropped product_id FK constraint from inventory_stock';
    ELSE
        RAISE NOTICE 'Constraint inventory_stock_product_id_fkey does not exist (already dropped?)';
    END IF;

    -- 2. Add material_id column to inventory_stock (Optional, for future clarity)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'inventory_stock' AND column_name = 'material_id'
    ) THEN
        ALTER TABLE inventory_stock ADD COLUMN material_id UUID;
        RAISE NOTICE 'Added material_id column to inventory_stock';
    END IF;
    
    -- 3. Sync material_id if product_id is provided but material_id is NULL?
    -- No, let's leave data as is. The trigger uses product_id.
    
END $$;
