-- ═══════════════════════════════════════════════════════════════
-- Fix RLS Policies for document_activity table
-- Uses the standard check_row_access pattern
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop any existing broken policies
DROP POLICY IF EXISTS "document_activity_select" ON document_activity;
DROP POLICY IF EXISTS "document_activity_insert" ON document_activity;
DROP POLICY IF EXISTS "document_activity_update" ON document_activity;
DROP POLICY IF EXISTS "document_activity_delete" ON document_activity;
DROP POLICY IF EXISTS "tenant_isolation_select" ON document_activity;
DROP POLICY IF EXISTS "tenant_isolation_insert" ON document_activity;
DROP POLICY IF EXISTS "tenant_isolation_update" ON document_activity;
DROP POLICY IF EXISTS "tenant_isolation_delete" ON document_activity;

-- 2. Ensure RLS is enabled
ALTER TABLE document_activity ENABLE ROW LEVEL SECURITY;

-- 3. Create proper policies using check_row_access
-- SELECT: Users can read activities from their tenant
CREATE POLICY "document_activity_select" ON document_activity
    FOR SELECT USING (
        check_row_access(tenant_id, NULL)
    );

-- INSERT: Users can create activities in their tenant
CREATE POLICY "document_activity_insert" ON document_activity
    FOR INSERT WITH CHECK (
        check_row_access(tenant_id, NULL)
    );

-- UPDATE: Users can update activities in their tenant
CREATE POLICY "document_activity_update" ON document_activity
    FOR UPDATE USING (
        check_row_access(tenant_id, NULL)
    );

-- DELETE: Users can delete activities in their tenant
CREATE POLICY "document_activity_delete" ON document_activity
    FOR DELETE USING (
        check_row_access(tenant_id, NULL)
    );
