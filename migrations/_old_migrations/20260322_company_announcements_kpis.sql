-- ════════════════════════════════════════════════════════════════
-- 📢 Company Announcements + Ticker KPIs RPC
-- ════════════════════════════════════════════════════════════════

-- 1. Company Announcements (tenant-level)
CREATE TABLE IF NOT EXISTS company_announcements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    message_ar TEXT NOT NULL DEFAULT '',
    message_en TEXT NOT NULL DEFAULT '',
    announcement_type TEXT NOT NULL DEFAULT 'info' 
        CHECK (announcement_type IN ('urgent', 'notice', 'celebration', 'reminder', 'info')),
    priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    bg_color TEXT DEFAULT '#047857',
    text_color TEXT DEFAULT '#ffffff',
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_dismissable BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_announcements_tenant 
    ON company_announcements(tenant_id, is_active);

ALTER TABLE company_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tenant announcements"
    ON company_announcements FOR SELECT
    USING (tenant_id IN (
        SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
    ) AND is_active = true);

CREATE POLICY "Tenant owners can manage announcements"
    ON company_announcements FOR ALL
    USING (tenant_id IN (
        SELECT tenant_id FROM user_profiles 
        WHERE id = auth.uid() AND role IN ('tenant_owner', 'super_admin')
    ));

CREATE TRIGGER trigger_company_announcements_updated_at
    BEFORE UPDATE ON company_announcements
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_announcements_updated_at();

-- 2. Ticker KPIs RPC
CREATE OR REPLACE FUNCTION get_ticker_kpis(p_tenant_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  today_start TIMESTAMPTZ := date_trunc('day', NOW());
  month_start TIMESTAMPTZ := date_trunc('month', NOW());
BEGIN
  SELECT json_build_object(
    'pending_sales_orders', COALESCE((
      SELECT COUNT(*) FROM sales_orders 
      WHERE tenant_id = p_tenant_id AND status IN ('draft', 'pending', 'confirmed')
    ), 0),
    'today_sales_count', COALESCE((
      SELECT COUNT(*) FROM sales_invoices 
      WHERE tenant_id = p_tenant_id AND created_at >= today_start
    ), 0),
    'month_sales_total', COALESCE((
      SELECT ROUND(COALESCE(SUM(total_amount), 0)::numeric, 2) FROM sales_invoices 
      WHERE tenant_id = p_tenant_id AND created_at >= month_start
    ), 0),
    'unpaid_invoices', COALESCE((
      SELECT COUNT(*) FROM sales_invoices 
      WHERE tenant_id = p_tenant_id AND status IN ('draft', 'pending', 'sent')
    ), 0),
    'pending_purchases', COALESCE((
      SELECT COUNT(*) FROM purchase_orders 
      WHERE tenant_id = p_tenant_id AND status IN ('draft', 'pending', 'approved')
    ), 0),
    'total_materials', COALESCE((
      SELECT COUNT(*) FROM fabric_materials 
      WHERE tenant_id = p_tenant_id AND is_active = true
    ), 0),
    'total_rolls', COALESCE((
      SELECT COUNT(*) FROM fabric_rolls 
      WHERE tenant_id = p_tenant_id AND status = 'available'
    ), 0),
    'total_customers', COALESCE((
      SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id
    ), 0),
    'total_suppliers', COALESCE((
      SELECT COUNT(*) FROM suppliers WHERE tenant_id = p_tenant_id
    ), 0)
  ) INTO result;
  
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticker_kpis(UUID) TO authenticated;
NOTIFY pgrst, 'reload schema';
