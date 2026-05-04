-- ════════════════════════════════════════════════════════════════
-- Migration: Add multi-language name columns to warehouses table
-- Adds name_ru, name_uk, name_tr, name_de, name_it, name_ro, name_pl
-- to support all 9 languages (ar + en already exist)
-- ════════════════════════════════════════════════════════════════

ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_ru VARCHAR(200);
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_uk VARCHAR(200);
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_tr VARCHAR(200);
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_de VARCHAR(200);
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_it VARCHAR(200);
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_ro VARCHAR(200);
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_pl VARCHAR(200);

-- Also add to branches table for consistency
ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_ru VARCHAR(200);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_uk VARCHAR(200);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_tr VARCHAR(200);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_de VARCHAR(200);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_it VARCHAR(200);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_ro VARCHAR(200);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_pl VARCHAR(200);
