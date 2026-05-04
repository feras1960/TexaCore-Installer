-- ═══════════════════════════════════════════════════════════════
-- Migration: Container Close Lifecycle Fields
-- إضافة حقول إغلاق الحاوية — تسكير دورة الحياة
-- Date: 2026-02-20
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        -- 1. Add closed_at / closed_by columns if not already present
        EXECUTE 'ALTER TABLE containers ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ DEFAULT NULL';
        EXECUTE 'ALTER TABLE containers ADD COLUMN IF NOT EXISTS closed_by UUID DEFAULT NULL REFERENCES auth.users(id) ON DELETE SET NULL';

        -- 3. Update constraint comment (informational)
        EXECUTE 'COMMENT ON COLUMN containers.closed_at IS ''Timestamp when the container lifecycle was closed/archived''';
        EXECUTE 'COMMENT ON COLUMN containers.closed_by IS ''User who closed the container''';
        EXECUTE 'COMMENT ON COLUMN containers.status IS ''Lifecycle status: ordered, in_transit, at_port, in_receiving, received, fully_received, completed, closed''';

        -- 4. Index for report queries (e.g. "show all closed containers")
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_containers_closed_at ON containers(closed_at) WHERE closed_at IS NOT NULL';
    END IF;
END $$;
