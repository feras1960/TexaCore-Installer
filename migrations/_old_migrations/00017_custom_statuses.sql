-- =====================================================
-- Custom Statuses System Migration
-- نظام الحالات المخصصة
-- =====================================================

-- 1. Create status_groups table (مجموعات الحالات)
CREATE TABLE IF NOT EXISTS status_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(100) NOT NULL,
  name_en VARCHAR(100),
  sort_order INT DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, doc_type, code)
);

-- 2. Create custom_statuses table (الحالات المخصصة)
CREATE TABLE IF NOT EXISTS custom_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  group_id UUID REFERENCES status_groups(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(100) NOT NULL,
  name_en VARCHAR(100),
  color VARCHAR(20) DEFAULT 'gray',
  icon VARCHAR(50),
  sort_order INT DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  is_initial BOOLEAN DEFAULT false,
  is_final BOOLEAN DEFAULT false,
  time_norm_hours INT,
  
  -- Permissions
  can_view_roles TEXT[] DEFAULT ARRAY['admin', 'manager', 'user'],
  can_set_roles TEXT[] DEFAULT ARRAY['admin', 'manager'],
  
  -- Auto-actions
  auto_actions JSONB DEFAULT '[]',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, doc_type, code)
);

-- 3. Create status_transitions table (انتقالات الحالات)
CREATE TABLE IF NOT EXISTS status_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  from_status_id UUID REFERENCES custom_statuses(id) ON DELETE CASCADE,
  to_status_id UUID REFERENCES custom_statuses(id) ON DELETE CASCADE,
  allowed_roles TEXT[] DEFAULT ARRAY['admin'],
  requires_comment BOOLEAN DEFAULT false,
  requires_approval BOOLEAN DEFAULT false,
  approval_roles TEXT[] DEFAULT ARRAY['admin'],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, doc_type, from_status_id, to_status_id)
);

-- 4. Create status_history table (سجل تغيير الحالات)
CREATE TABLE IF NOT EXISTS status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  doc_id UUID NOT NULL,
  from_status_id UUID REFERENCES custom_statuses(id),
  to_status_id UUID REFERENCES custom_statuses(id) NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  comment TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create sheet_customizations table (تخصيصات الشيتات)
CREATE TABLE IF NOT EXISTS sheet_customizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  customization_name VARCHAR(100),
  layout JSONB NOT NULL DEFAULT '{}',
  fields JSONB NOT NULL DEFAULT '[]',
  visible_tabs TEXT[] DEFAULT ARRAY[]::TEXT[],
  is_default BOOLEAN DEFAULT false,
  is_shared BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, user_id, doc_type, customization_name)
);

-- 6. Create print_templates table (قوالب الطباعة)
CREATE TABLE IF NOT EXISTS print_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  name_ar VARCHAR(100) NOT NULL,
  name_en VARCHAR(100),
  category VARCHAR(50) DEFAULT 'general',
  template_html TEXT NOT NULL,
  template_css TEXT,
  variables JSONB DEFAULT '[]',
  paper_size VARCHAR(20) DEFAULT 'A4',
  orientation VARCHAR(20) DEFAULT 'portrait',
  margins JSONB DEFAULT '{"top": 10, "right": 10, "bottom": 10, "left": 10}',
  include_qr BOOLEAN DEFAULT true,
  include_header BOOLEAN DEFAULT true,
  include_footer BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Create user_preferences table for interface mode (تفضيلات المستخدم)
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  interface_mode VARCHAR(20) DEFAULT 'professional',
  theme VARCHAR(20) DEFAULT 'system',
  language VARCHAR(10) DEFAULT 'ar',
  sidebar_collapsed BOOLEAN DEFAULT false,
  default_view VARCHAR(50),
  notifications JSONB DEFAULT '{"email": true, "push": true, "sms": false}',
  quick_actions TEXT[] DEFAULT ARRAY[]::TEXT[],
  recent_docs JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Create indexes
CREATE INDEX IF NOT EXISTS idx_custom_statuses_tenant_doc ON custom_statuses(tenant_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_status_history_doc ON status_history(tenant_id, doc_type, doc_id);
CREATE INDEX IF NOT EXISTS idx_sheet_customizations_user ON sheet_customizations(tenant_id, user_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_print_templates_tenant_doc ON print_templates(tenant_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_status_groups_tenant_doc ON status_groups(tenant_id, doc_type);

-- 9. Enable RLS
ALTER TABLE status_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheet_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- 10. RLS Policies for status_groups
CREATE POLICY "Users can view status groups in their tenant" ON status_groups
  FOR SELECT USING (
    tenant_id IN (SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id WHERE u.id = auth.uid())
    OR tenant_id IS NULL
  );

CREATE POLICY "Admins can manage status groups" ON status_groups
  FOR ALL USING (
    tenant_id IN (
      SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id 
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'owner')
    )
  );

-- 11. RLS Policies for custom_statuses
CREATE POLICY "Users can view custom statuses in their tenant" ON custom_statuses
  FOR SELECT USING (
    tenant_id IN (SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id WHERE u.id = auth.uid())
    OR tenant_id IS NULL
  );

CREATE POLICY "Admins can manage custom statuses" ON custom_statuses
  FOR ALL USING (
    tenant_id IN (
      SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id 
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'owner')
    )
  );

-- 12. RLS Policies for status_history
CREATE POLICY "Users can view status history in their tenant" ON status_history
  FOR SELECT USING (
    tenant_id IN (SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id WHERE u.id = auth.uid())
  );

CREATE POLICY "Users can insert status history" ON status_history
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id WHERE u.id = auth.uid())
  );

-- 13. RLS Policies for sheet_customizations
CREATE POLICY "Users can view their customizations or shared ones" ON sheet_customizations
  FOR SELECT USING (
    user_id = auth.uid() 
    OR (is_shared = true AND tenant_id IN (SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id WHERE u.id = auth.uid()))
  );

CREATE POLICY "Users can manage their customizations" ON sheet_customizations
  FOR ALL USING (user_id = auth.uid());

-- 14. RLS Policies for print_templates
CREATE POLICY "Users can view print templates in their tenant" ON print_templates
  FOR SELECT USING (
    tenant_id IN (SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id WHERE u.id = auth.uid())
    OR tenant_id IS NULL
  );

CREATE POLICY "Admins can manage print templates" ON print_templates
  FOR ALL USING (
    tenant_id IN (
      SELECT c.tenant_id FROM user_profiles u JOIN companies c ON u.company_id = c.id 
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'owner')
    )
  );

-- 15. RLS Policies for user_preferences
CREATE POLICY "Users can view their preferences" ON user_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can manage their preferences" ON user_preferences
  FOR ALL USING (user_id = auth.uid());

-- 16. Insert default status groups
INSERT INTO status_groups (tenant_id, doc_type, code, name_ar, name_en, sort_order, is_system) VALUES
  (NULL, 'invoice', 'new', 'جديد', 'New', 1, true),
  (NULL, 'invoice', 'in_progress', 'قيد المعالجة', 'In Progress', 2, true),
  (NULL, 'invoice', 'paid', 'مدفوع', 'Paid', 3, true),
  (NULL, 'invoice', 'cancelled', 'ملغي', 'Cancelled', 4, true),
  
  (NULL, 'order', 'new', 'جديد', 'New', 1, true),
  (NULL, 'order', 'in_progress', 'قيد العمل', 'In Progress', 2, true),
  (NULL, 'order', 'pending', 'مؤجل', 'Pending', 3, true),
  (NULL, 'order', 'completed', 'مكتمل', 'Completed', 4, true),
  (NULL, 'order', 'delivery', 'توصيل', 'Delivery', 5, true),
  (NULL, 'order', 'closed_success', 'مغلق بنجاح', 'Closed Successfully', 6, true),
  (NULL, 'order', 'closed_fail', 'مغلق بدون نجاح', 'Closed Unsuccessfully', 7, true),
  
  (NULL, 'journal_entry', 'draft', 'مسودة', 'Draft', 1, true),
  (NULL, 'journal_entry', 'posted', 'مؤكد', 'Posted', 2, true),
  (NULL, 'journal_entry', 'cancelled', 'ملغي', 'Cancelled', 3, true),
  
  (NULL, 'payment', 'pending', 'معلق', 'Pending', 1, true),
  (NULL, 'payment', 'approved', 'معتمد', 'Approved', 2, true),
  (NULL, 'payment', 'completed', 'مكتمل', 'Completed', 3, true),
  (NULL, 'payment', 'cancelled', 'ملغي', 'Cancelled', 4, true)
ON CONFLICT DO NOTHING;

-- 17. Insert default statuses
INSERT INTO custom_statuses (tenant_id, group_id, doc_type, code, name_ar, name_en, color, sort_order, is_system, is_initial, is_final) 
SELECT 
  NULL,
  sg.id,
  'invoice',
  CASE sg.code
    WHEN 'new' THEN 'draft'
    WHEN 'in_progress' THEN 'sent'
    WHEN 'paid' THEN 'paid'
    WHEN 'cancelled' THEN 'cancelled'
  END,
  CASE sg.code
    WHEN 'new' THEN 'مسودة'
    WHEN 'in_progress' THEN 'مرسلة'
    WHEN 'paid' THEN 'مدفوعة'
    WHEN 'cancelled' THEN 'ملغاة'
  END,
  CASE sg.code
    WHEN 'new' THEN 'Draft'
    WHEN 'in_progress' THEN 'Sent'
    WHEN 'paid' THEN 'Paid'
    WHEN 'cancelled' THEN 'Cancelled'
  END,
  CASE sg.code
    WHEN 'new' THEN 'gray'
    WHEN 'in_progress' THEN 'blue'
    WHEN 'paid' THEN 'green'
    WHEN 'cancelled' THEN 'red'
  END,
  sg.sort_order,
  true,
  sg.code = 'new',
  sg.code IN ('paid', 'cancelled')
FROM status_groups sg
WHERE sg.doc_type = 'invoice' AND sg.tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- 18. Function to get status color class
CREATE OR REPLACE FUNCTION get_status_color_class(color VARCHAR)
RETURNS VARCHAR AS $$
BEGIN
  RETURN CASE color
    WHEN 'gray' THEN 'bg-gray-100 text-gray-700'
    WHEN 'blue' THEN 'bg-blue-100 text-blue-700'
    WHEN 'green' THEN 'bg-green-100 text-green-700'
    WHEN 'red' THEN 'bg-red-100 text-red-700'
    WHEN 'yellow' THEN 'bg-yellow-100 text-yellow-700'
    WHEN 'orange' THEN 'bg-orange-100 text-orange-700'
    WHEN 'purple' THEN 'bg-purple-100 text-purple-700'
    WHEN 'pink' THEN 'bg-pink-100 text-pink-700'
    WHEN 'indigo' THEN 'bg-indigo-100 text-indigo-700'
    WHEN 'teal' THEN 'bg-teal-100 text-teal-700'
    ELSE 'bg-gray-100 text-gray-700'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 19. Function to change document status
CREATE OR REPLACE FUNCTION change_document_status(
  p_tenant_id UUID,
  p_doc_type VARCHAR,
  p_doc_id UUID,
  p_new_status_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_current_status_id UUID;
  v_history_id UUID;
BEGIN
  -- Get current status from the document (you'd need to adjust this based on your schema)
  -- This is a placeholder - implement based on your actual document tables
  
  -- Insert history record
  INSERT INTO status_history (tenant_id, doc_type, doc_id, from_status_id, to_status_id, changed_by, comment)
  VALUES (p_tenant_id, p_doc_type, p_doc_id, v_current_status_id, p_new_status_id, auth.uid(), p_comment)
  RETURNING id INTO v_history_id;
  
  RETURN v_history_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE status_groups IS 'مجموعات الحالات - Status Groups';
COMMENT ON TABLE custom_statuses IS 'الحالات المخصصة - Custom Statuses';
COMMENT ON TABLE status_transitions IS 'انتقالات الحالات المسموحة - Status Transitions';
COMMENT ON TABLE status_history IS 'سجل تغيير الحالات - Status Change History';
COMMENT ON TABLE sheet_customizations IS 'تخصيصات الشيتات - Sheet Customizations';
COMMENT ON TABLE print_templates IS 'قوالب الطباعة - Print Templates';
COMMENT ON TABLE user_preferences IS 'تفضيلات المستخدم - User Preferences';
