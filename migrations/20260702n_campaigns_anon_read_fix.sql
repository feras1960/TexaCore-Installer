-- إصلاح قراءة anon لحملات الخصومات: سياسة tenant_manage (FOR ALL) كانت
-- تُقيَّم للزائر anon وتفشل على get_user_tenant_id() (لا EXECUTE) فتكسر
-- الاستعلام كله. القصر على authenticated يجعل anon يمرّ عبر public_read فقط.
-- (نفس درس 20260613_storefront_anon_read_fix)

DROP POLICY IF EXISTS "esc_tenant_manage" ON ecommerce_sale_campaigns;
CREATE POLICY "esc_tenant_manage" ON ecommerce_sale_campaigns
    FOR ALL TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "ecp_tenant_manage" ON ecommerce_campaign_products;
CREATE POLICY "ecp_tenant_manage" ON ecommerce_campaign_products
    FOR ALL TO authenticated
    USING (
        campaign_id IN (
            SELECT id FROM ecommerce_sale_campaigns
            WHERE is_platform_admin() OR tenant_id = get_user_tenant_id()
        )
    );

-- نفس التحصين للجداول الجديدة الأخرى (بلا anon grants لكن اتساقاً)
DROP POLICY IF EXISTS "eat_tenant_manage" ON ecommerce_agent_tasks;
CREATE POLICY "eat_tenant_manage" ON ecommerce_agent_tasks
    FOR ALL TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "ecs_tenant_manage" ON ecommerce_category_suggestions;
CREATE POLICY "ecs_tenant_manage" ON ecommerce_category_suggestions
    FOR ALL TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());
