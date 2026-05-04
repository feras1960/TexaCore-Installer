-- ═══════════════════════════════════════════════════════════════
-- Migration: Add missing container columns
-- Date: 2026-02-12
-- Purpose: Add container_name, container_size, container_type columns
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        -- ─── Add container_name ───
        ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS container_name TEXT;
        COMMENT ON COLUMN public.containers.container_name IS 'User-friendly name for the container (e.g. "أقمشة تركية", "بضائع صيف 2026")';

        -- ─── Add container_size ───
        ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS container_size TEXT DEFAULT '40ft';
        COMMENT ON COLUMN public.containers.container_size IS 'Container size: 20ft, 40ft, 40hc, 45ft';

        -- ─── Add container_type ───
        ALTER TABLE public.containers ADD COLUMN IF NOT EXISTS container_type TEXT DEFAULT 'dry';
        COMMENT ON COLUMN public.containers.container_type IS 'Container type: dry, reefer, open_top, flat_rack, tank';
    END IF;
END $$;
