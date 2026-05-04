-- ═══════════════════════════════════════════════════════════════════════════
-- إصلاح سياسات RLS لجداول القيود المتكررة
-- ═══════════════════════════════════════════════════════════════════════════
-- المشكلة: السياسات القديمة تستعمل current_setting('app.current_tenant_id')
-- الحل: استعمال نفس نمط journal_entries (get_user_tenant_id + can_access_company)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1️⃣ recurring_entries
DROP POLICY IF EXISTS recurring_entries_tenant_isolation ON recurring_entries;
DROP POLICY IF EXISTS recurring_entries_select_policy ON recurring_entries;
DROP POLICY IF EXISTS recurring_entries_insert_policy ON recurring_entries;
DROP POLICY IF EXISTS recurring_entries_update_policy ON recurring_entries;
DROP POLICY IF EXISTS recurring_entries_delete_policy ON recurring_entries;

CREATE POLICY recurring_entries_select_policy ON recurring_entries
    FOR SELECT TO authenticated
    USING (is_platform_admin() OR check_row_access(tenant_id, company_id));

CREATE POLICY recurring_entries_insert_policy ON recurring_entries
    FOR INSERT TO authenticated
    WITH CHECK (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id)));

CREATE POLICY recurring_entries_update_policy ON recurring_entries
    FOR UPDATE TO authenticated
    USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id)));

CREATE POLICY recurring_entries_delete_policy ON recurring_entries
    FOR DELETE TO authenticated
    USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id)));

-- 2️⃣ recurring_entry_lines
DROP POLICY IF EXISTS recurring_entry_lines_tenant_isolation ON recurring_entry_lines;
DROP POLICY IF EXISTS recurring_entry_lines_select_policy ON recurring_entry_lines;
DROP POLICY IF EXISTS recurring_entry_lines_insert_policy ON recurring_entry_lines;
DROP POLICY IF EXISTS recurring_entry_lines_update_policy ON recurring_entry_lines;
DROP POLICY IF EXISTS recurring_entry_lines_delete_policy ON recurring_entry_lines;

CREATE POLICY recurring_entry_lines_select_policy ON recurring_entry_lines
    FOR SELECT TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY recurring_entry_lines_insert_policy ON recurring_entry_lines
    FOR INSERT TO authenticated
    WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY recurring_entry_lines_update_policy ON recurring_entry_lines
    FOR UPDATE TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY recurring_entry_lines_delete_policy ON recurring_entry_lines
    FOR DELETE TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

-- 3️⃣ recurring_entry_history
DROP POLICY IF EXISTS recurring_entry_history_tenant_isolation ON recurring_entry_history;
DROP POLICY IF EXISTS recurring_entry_history_select_policy ON recurring_entry_history;
DROP POLICY IF EXISTS recurring_entry_history_insert_policy ON recurring_entry_history;
DROP POLICY IF EXISTS recurring_entry_history_update_policy ON recurring_entry_history;
DROP POLICY IF EXISTS recurring_entry_history_delete_policy ON recurring_entry_history;

CREATE POLICY recurring_entry_history_select_policy ON recurring_entry_history
    FOR SELECT TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY recurring_entry_history_insert_policy ON recurring_entry_history
    FOR INSERT TO authenticated
    WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY recurring_entry_history_update_policy ON recurring_entry_history
    FOR UPDATE TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY recurring_entry_history_delete_policy ON recurring_entry_history
    FOR DELETE TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

-- ═══════════════════════════════════════════════════════════════════════════
-- تم! الآن القيود المتكررة ستعمل بنفس نمط journal_entries
-- ═══════════════════════════════════════════════════════════════════════════
