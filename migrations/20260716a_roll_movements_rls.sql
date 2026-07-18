-- 20260716a: تفعيل RLS على roll_movements (أُنشئ في مرحلة الحذف الناعم 3 بدون عزل)
-- النمط مطابق لسياسات fabric_rolls: عزل tenant للقراءة، tenant+company للكتابة.
-- الكتابة الفعلية تتم عبر دوال SECURITY DEFINER (doc_log_roll_movement) فلا تتأثر.

ALTER TABLE public.roll_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roll_movements_select_policy ON public.roll_movements;
CREATE POLICY roll_movements_select_policy ON public.roll_movements
    FOR SELECT
    USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));

DROP POLICY IF EXISTS roll_movements_insert_policy ON public.roll_movements;
CREATE POLICY roll_movements_insert_policy ON public.roll_movements
    FOR INSERT TO authenticated
    WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));

DROP POLICY IF EXISTS roll_movements_update_policy ON public.roll_movements;
CREATE POLICY roll_movements_update_policy ON public.roll_movements
    FOR UPDATE TO authenticated
    USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));

DROP POLICY IF EXISTS roll_movements_delete_policy ON public.roll_movements;
CREATE POLICY roll_movements_delete_policy ON public.roll_movements
    FOR DELETE TO authenticated
    USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
