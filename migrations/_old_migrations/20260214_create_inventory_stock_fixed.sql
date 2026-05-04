-- ═══════════════════════════════════════════════════════════════════════════
-- 🛠️ MASTER FIX: Inventory Stock Table Reconstruction (Corrected Syntax)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Create Table (Safe Mode)
CREATE TABLE IF NOT EXISTS inventory_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    company_id UUID,
    
    -- Item Identification (Polymorphic)
    product_id UUID,   -- Can be null if it's a raw material
    material_id UUID,  -- Can be null if it's a finished product
    variant_id UUID,
    
    warehouse_id UUID,
    
    -- Stock Values
    quantity_on_hand DECIMAL(15,3) DEFAULT 0,
    average_cost DECIMAL(15,4) DEFAULT 0,
    last_cost DECIMAL(15,4) DEFAULT 0,
    
    -- Timestamps
    last_movement_date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Legacy Fields (kept for compatibility)
    initial_quantity DECIMAL(15,3) DEFAULT 0,
    current_quantity DECIMAL(15,3) DEFAULT 0,
    batch_number VARCHAR(100) DEFAULT 'N/A'
);

-- 2. Add 'material_id' column if it was missing in an existing table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_stock' AND column_name = 'material_id') THEN
        ALTER TABLE inventory_stock ADD COLUMN material_id UUID;
    END IF;
END $$;

-- 3. Relax Constraints (Avoid Foreign Key Errors)
-- We remove strict FK on product_id to allow materials to exist without a matching product record
DO $$
BEGIN
    ALTER TABLE inventory_stock DROP CONSTRAINT IF EXISTS inventory_stock_product_id_fkey;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 4. Create Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_inv_stock_product_wh ON inventory_stock(product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_material_wh ON inventory_stock(material_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_stock_tenant ON inventory_stock(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 🔄 UPDATE TRIGGER FUNCTION: Smart Material/Product Handling
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_inventory_stock()
RETURNS TRIGGER AS $func$
DECLARE
    v_current_qty DECIMAL(15,3);
    v_current_cost DECIMAL(15,4);
    v_new_avg_cost DECIMAL(15,4);
    v_warehouse_id UUID;
    v_target_id UUID;
BEGIN
    -- Determine Warehouse
    v_warehouse_id := COALESCE(NEW.to_warehouse_id, NEW.from_warehouse_id);
    
    -- Determine Identity: Use material_id if present, otherwise product_id
    v_target_id := COALESCE(NEW.material_id, NEW.product_id);

    -- 1. Get Current Stock Context
    SELECT quantity_on_hand, average_cost
    INTO v_current_qty, v_current_cost
    FROM inventory_stock
    WHERE 
        -- Match EITHER material_id OR product_id
        ((material_id IS NOT NULL AND material_id = v_target_id) 
         OR 
         (product_id IS NOT NULL AND product_id = v_target_id))
        AND warehouse_id = v_warehouse_id
    LIMIT 1;
    
    IF NOT FOUND THEN
        v_current_qty := 0;
        v_current_cost := 0;
    END IF;

    -- 2. Calculate Weighted Average Cost (Only on Receipt/Inbound)
    IF NEW.movement_type IN ('receipt', 'purchase', 'return_in', 'adjustment_in', 'transfer_in') THEN
        IF (v_current_qty + NEW.quantity) > 0 THEN
            v_new_avg_cost := ((v_current_qty * v_current_cost) + (NEW.quantity * COALESCE(NEW.unit_cost, v_current_cost, 0))) / (v_current_qty + NEW.quantity);
        ELSE
            v_new_avg_cost := COALESCE(NEW.unit_cost, v_current_cost, 0);
        END IF;

        -- 3. Update Existing Record or Insert New
        UPDATE inventory_stock
        SET quantity_on_hand = quantity_on_hand + NEW.quantity,
            average_cost = v_new_avg_cost,
            last_cost = COALESCE(NEW.unit_cost, inventory_stock.last_cost),
            last_movement_date = NOW(),
            updated_at = NOW()
        WHERE 
            ((material_id IS NOT NULL AND material_id = v_target_id) OR (product_id IS NOT NULL AND product_id = v_target_id))
            AND warehouse_id = v_warehouse_id;

        IF NOT FOUND THEN
            INSERT INTO inventory_stock (
                tenant_id, company_id, 
                product_id, material_id, 
                warehouse_id,
                quantity_on_hand, average_cost, last_cost, last_movement_date,
                batch_number
            ) VALUES (
                NEW.tenant_id, NEW.company_id, 
                NEW.product_id, NEW.material_id, 
                v_warehouse_id,
                NEW.quantity, v_new_avg_cost, COALESCE(NEW.unit_cost, 0), NOW(),
                'N/A'
            );
        END IF;

    -- 4. Handle Outbound (Sale/Issue)
    ELSIF NEW.movement_type IN ('sale', 'issue', 'return_out', 'adjustment_out', 'transfer_out') THEN
         UPDATE inventory_stock
         SET quantity_on_hand = quantity_on_hand - NEW.quantity,
             last_movement_date = NOW(),
             updated_at = NOW()
         WHERE 
            ((material_id IS NOT NULL AND material_id = v_target_id) OR (product_id IS NOT NULL AND product_id = v_target_id))
            AND warehouse_id = v_warehouse_id;
    END IF;

    -- 5. Snapshot Balances for the Movement Record
    NEW.balance_after := v_current_qty + 
        CASE WHEN NEW.movement_type IN ('receipt', 'purchase', 'return_in', 'adjustment_in', 'transfer_in') THEN NEW.quantity ELSE -NEW.quantity END;
    NEW.balance_before := v_current_qty;

    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- 5. Re-bind Trigger to Inventory Movements
DROP TRIGGER IF EXISTS trg_update_inventory_stock ON inventory_movements;
CREATE TRIGGER trg_update_inventory_stock
    BEFORE INSERT ON inventory_movements
    FOR EACH ROW
    EXECUTE FUNCTION update_inventory_stock();
