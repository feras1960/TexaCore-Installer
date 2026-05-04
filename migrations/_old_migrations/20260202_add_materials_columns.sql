-- ═══════════════════════════════════════════════════════════════
-- ADD MISSING COLUMNS TO MATERIALS TABLE
-- إضافة الأعمدة المفقودة لجدول المواد
-- ═══════════════════════════════════════════════════════════════

DO $$ 
BEGIN
    -- Add unit_id column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'unit_id') THEN
        ALTER TABLE fabric_materials ADD COLUMN unit_id UUID;
    END IF;

    -- Add color column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'color') THEN
        ALTER TABLE fabric_materials ADD COLUMN color VARCHAR(100);
    END IF;

    -- Add color_hex column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'color_hex') THEN
        ALTER TABLE fabric_materials ADD COLUMN color_hex VARCHAR(7);
    END IF;

    -- Add sku column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'sku') THEN
        ALTER TABLE fabric_materials ADD COLUMN sku VARCHAR(100);
    END IF;

    -- Add barcode column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'barcode') THEN
        ALTER TABLE fabric_materials ADD COLUMN barcode VARCHAR(100);
    END IF;

    -- Add min_stock_level column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'min_stock_level') THEN
        ALTER TABLE fabric_materials ADD COLUMN min_stock_level DECIMAL(15,3) DEFAULT 0;
    END IF;

    -- Add max_stock_level column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'max_stock_level') THEN
        ALTER TABLE fabric_materials ADD COLUMN max_stock_level DECIMAL(15,3) DEFAULT 0;
    END IF;

    -- Add parent_id column for tree structure
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'parent_id') THEN
        ALTER TABLE fabric_materials ADD COLUMN parent_id UUID REFERENCES fabric_materials(id) ON DELETE CASCADE;
    END IF;

    -- Add is_group column for tree structure
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'is_group') THEN
        ALTER TABLE fabric_materials ADD COLUMN is_group BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add level column for tree structure
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'level') THEN
        ALTER TABLE fabric_materials ADD COLUMN level INT DEFAULT 0;
    END IF;

    -- Add path column for tree structure
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fabric_materials' AND column_name = 'path') THEN
        ALTER TABLE fabric_materials ADD COLUMN path TEXT;
    END IF;

END $$;

-- Create index on code for faster lookups
CREATE INDEX IF NOT EXISTS idx_fabric_materials_code ON fabric_materials(code);

-- Create index on parent_id for tree queries
CREATE INDEX IF NOT EXISTS idx_fabric_materials_parent_id ON fabric_materials(parent_id);

-- Create index on company_id for filtering
CREATE INDEX IF NOT EXISTS idx_fabric_materials_company_id ON fabric_materials(company_id);

-- Create index on category for filtering
CREATE INDEX IF NOT EXISTS idx_fabric_materials_category ON fabric_materials(category);
