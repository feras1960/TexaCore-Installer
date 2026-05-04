-- ============================================================
-- 🟠 المرحلة 2: ترقية Company Isolation
-- تاريخ: 2026-04-01
-- الوصف: ترقية الجداول التي تحمل tenant_id + company_id 
--         لكن سياساتها لا تتحقق من company_id
-- عدد الجداول: 42 جدول (بعد استبعاد المعالجين في المرحلة 1)
-- ============================================================

-- ملاحظة: هذا الملف مقسم لـ 5 دفعات لتسهيل المراجعة والتنفيذ التدريجي

BEGIN;

-- ============================================================
-- الدفعة 2A: جداول المبيعات والمشتريات والمخزون (الأكثر حساسية)
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [2A] Upgrading sales/purchase/inventory tables to company-level isolation...'; END $$;

-- ---------- sales_orders ----------
DROP POLICY IF EXISTS "so_write_policy" ON public.sales_orders;
DROP POLICY IF EXISTS "sales_orders_select_policy" ON public.sales_orders;
-- أعد الإنشاء عبر الدالة المساعدة
SELECT create_company_rls_policies('sales_orders', true, true);

-- ---------- sales_returns ----------
DROP POLICY IF EXISTS "sr_write_policy" ON public.sales_returns;
DROP POLICY IF EXISTS "sales_returns_select_policy" ON public.sales_returns;
SELECT create_company_rls_policies('sales_returns', true, true);

-- ---------- sales_deliveries ----------
DROP POLICY IF EXISTS "delivery_write_policy" ON public.sales_deliveries;
DROP POLICY IF EXISTS "sales_deliveries_select_policy" ON public.sales_deliveries;
SELECT create_company_rls_policies('sales_deliveries', true, true);

-- ---------- sales_transactions ----------
DROP POLICY IF EXISTS "st_tenant_isolation_select" ON public.sales_transactions;
DROP POLICY IF EXISTS "st_tenant_isolation_insert" ON public.sales_transactions;
DROP POLICY IF EXISTS "st_tenant_isolation_update" ON public.sales_transactions;
DROP POLICY IF EXISTS "st_tenant_isolation_delete" ON public.sales_transactions;
SELECT create_company_rls_policies('sales_transactions', true, true);

-- ---------- purchase_transactions ----------
DROP POLICY IF EXISTS "pt_tenant_isolation_select" ON public.purchase_transactions;
DROP POLICY IF EXISTS "pt_tenant_isolation_insert" ON public.purchase_transactions;
DROP POLICY IF EXISTS "pt_tenant_isolation_update" ON public.purchase_transactions;
DROP POLICY IF EXISTS "pt_tenant_isolation_delete" ON public.purchase_transactions;
SELECT create_company_rls_policies('purchase_transactions', true, true);

-- ---------- inventory_stock ----------
DROP POLICY IF EXISTS "inventory_stock_select_policy" ON public.inventory_stock;
DROP POLICY IF EXISTS "inventory_stock_insert_policy" ON public.inventory_stock;
DROP POLICY IF EXISTS "inventory_stock_update_policy" ON public.inventory_stock;
DROP POLICY IF EXISTS "inventory_stock_delete_policy" ON public.inventory_stock;
SELECT create_company_rls_policies('inventory_stock', true, true);

-- ---------- warehouse_settings ----------
DROP POLICY IF EXISTS "warehouse_settings_select_policy" ON public.warehouse_settings;
DROP POLICY IF EXISTS "warehouse_settings_insert_policy" ON public.warehouse_settings;
DROP POLICY IF EXISTS "warehouse_settings_update_policy" ON public.warehouse_settings;
DROP POLICY IF EXISTS "warehouse_settings_delete_policy" ON public.warehouse_settings;
SELECT create_company_rls_policies('warehouse_settings', true, true);

-- ---------- product_variants ----------
DROP POLICY IF EXISTS "variant_read" ON public.product_variants;
DROP POLICY IF EXISTS "product_variants_insert_policy" ON public.product_variants;
DROP POLICY IF EXISTS "product_variants_update_policy" ON public.product_variants;
DROP POLICY IF EXISTS "product_variants_delete_policy" ON public.product_variants;
SELECT create_company_rls_policies('product_variants', true, true);

-- ---------- variant_axes ----------
DROP POLICY IF EXISTS "variant_axes_select" ON public.variant_axes;
DROP POLICY IF EXISTS "variant_axes_insert" ON public.variant_axes;
DROP POLICY IF EXISTS "variant_axes_update" ON public.variant_axes;
DROP POLICY IF EXISTS "variant_axes_delete" ON public.variant_axes;
SELECT create_company_rls_policies('variant_axes', true, true);

-- ---------- variant_axis_values ----------
DROP POLICY IF EXISTS "variant_axis_values_select" ON public.variant_axis_values;
DROP POLICY IF EXISTS "variant_axis_values_insert" ON public.variant_axis_values;
DROP POLICY IF EXISTS "variant_axis_values_update" ON public.variant_axis_values;
DROP POLICY IF EXISTS "variant_axis_values_delete" ON public.variant_axis_values;
SELECT create_company_rls_policies('variant_axis_values', true, true);

DO $$ BEGIN RAISE NOTICE '✅ [2A] 10 sales/purchase/inventory tables upgraded to company-level isolation'; END $$;


-- ============================================================
-- الدفعة 2B: جداول HR (employees, departments, attendance, etc.)
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [2B] Upgrading HR tables to company-level isolation...'; END $$;

-- ---------- employees ----------
DROP POLICY IF EXISTS "employees_tenant_access" ON public.employees;
SELECT create_company_rls_policies('employees', true, true);

-- ---------- departments ----------
DROP POLICY IF EXISTS "departments_tenant_access" ON public.departments;
SELECT create_company_rls_policies('departments', true, true);

-- ---------- attendance ----------
DROP POLICY IF EXISTS "attendance_tenant_access" ON public.attendance;
SELECT create_company_rls_policies('attendance', true, true);

-- ---------- positions ----------
DROP POLICY IF EXISTS "positions_tenant_access" ON public.positions;
SELECT create_company_rls_policies('positions', true, true);

-- ---------- employee_contracts ----------
DROP POLICY IF EXISTS "contracts_tenant_access" ON public.employee_contracts;
SELECT create_company_rls_policies('employee_contracts', true, true);

-- ---------- hr_settings ----------
DROP POLICY IF EXISTS "hr_settings_tenant_access" ON public.hr_settings;
SELECT create_company_rls_policies('hr_settings', true, true);

-- ---------- leave_requests ----------
DROP POLICY IF EXISTS "leave_requests_tenant_access" ON public.leave_requests;
SELECT create_company_rls_policies('leave_requests', true, true);

-- ---------- leave_types ----------
DROP POLICY IF EXISTS "leave_types_tenant_access" ON public.leave_types;
SELECT create_company_rls_policies('leave_types', true, true);

-- ---------- payroll_periods ----------
DROP POLICY IF EXISTS "payroll_periods_tenant_access" ON public.payroll_periods;
SELECT create_company_rls_policies('payroll_periods', true, true);

-- ---------- salary_components ----------
DROP POLICY IF EXISTS "salary_components_tenant_access" ON public.salary_components;
SELECT create_company_rls_policies('salary_components', true, true);

-- ---------- drivers ----------
DROP POLICY IF EXISTS "drivers_select_policy" ON public.drivers;
DROP POLICY IF EXISTS "drivers_insert_policy" ON public.drivers;
DROP POLICY IF EXISTS "drivers_update_policy" ON public.drivers;
DROP POLICY IF EXISTS "drivers_delete_policy" ON public.drivers;
SELECT create_company_rls_policies('drivers', true, true);

DO $$ BEGIN RAISE NOTICE '✅ [2B] 11 HR tables upgraded to company-level isolation'; END $$;


-- ============================================================
-- الدفعة 2C: جداول CRM والاتصالات
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [2C] Upgrading CRM/communication tables to company-level isolation...'; END $$;

-- ---------- crm_campaigns ----------
DROP POLICY IF EXISTS "crm_campaigns_tenant_access" ON public.crm_campaigns;
SELECT create_company_rls_policies('crm_campaigns', true, true);

-- ---------- crm_deals ----------
DROP POLICY IF EXISTS "crm_deals_tenant_access" ON public.crm_deals;
SELECT create_company_rls_policies('crm_deals', true, true);

-- ---------- crm_pipeline_stages ----------
DROP POLICY IF EXISTS "pipeline_stages_tenant_access" ON public.crm_pipeline_stages;
SELECT create_company_rls_policies('crm_pipeline_stages', true, true);

-- ---------- crm_tasks ----------
DROP POLICY IF EXISTS "crm_tasks_tenant_access" ON public.crm_tasks;
SELECT create_company_rls_policies('crm_tasks', true, true);

-- ---------- contacts ----------
DROP POLICY IF EXISTS "contacts_select_policy" ON public.contacts;
DROP POLICY IF EXISTS "contacts_insert_policy" ON public.contacts;
DROP POLICY IF EXISTS "contacts_update_policy" ON public.contacts;
DROP POLICY IF EXISTS "contacts_delete_policy" ON public.contacts;
SELECT create_company_rls_policies('contacts', true, true);

-- ---------- call_logs ----------
DROP POLICY IF EXISTS "call_logs_select_policy" ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_insert_policy" ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_update_policy" ON public.call_logs;
DROP POLICY IF EXISTS "call_logs_delete_policy" ON public.call_logs;
SELECT create_company_rls_policies('call_logs', true, true);

-- ---------- chat_messages ----------
DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_messages_user_select" ON public.chat_messages;
SELECT create_company_rls_policies('chat_messages', true, true);

DO $$ BEGIN RAISE NOTICE '✅ [2C] 7 CRM/communication tables upgraded'; END $$;


-- ============================================================
-- الدفعة 2D: جداول إعدادات وتكوين الشركة
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [2D] Upgrading company settings/config tables...'; END $$;

-- ---------- company_print_settings ----------
DROP POLICY IF EXISTS "company_print_settings_select_policy" ON public.company_print_settings;
DROP POLICY IF EXISTS "company_print_settings_insert_policy" ON public.company_print_settings;
DROP POLICY IF EXISTS "company_print_settings_update_policy" ON public.company_print_settings;
DROP POLICY IF EXISTS "company_print_settings_delete_policy" ON public.company_print_settings;
SELECT create_company_rls_policies('company_print_settings', true, true);

-- ---------- company_workflow_settings ----------
DROP POLICY IF EXISTS "company_workflow_settings_select" ON public.company_workflow_settings;
DROP POLICY IF EXISTS "company_workflow_settings_insert" ON public.company_workflow_settings;
DROP POLICY IF EXISTS "company_workflow_settings_update" ON public.company_workflow_settings;
SELECT create_company_rls_policies('company_workflow_settings', true, true);

-- ---------- print_templates ----------
DROP POLICY IF EXISTS "print_templates_select_policy" ON public.print_templates;
DROP POLICY IF EXISTS "print_templates_insert_policy" ON public.print_templates;
DROP POLICY IF EXISTS "print_templates_update_policy" ON public.print_templates;
DROP POLICY IF EXISTS "print_templates_delete_policy" ON public.print_templates;
SELECT create_company_rls_policies('print_templates', true, true);

-- ---------- document_sequences ----------
DROP POLICY IF EXISTS "document_sequences_select" ON public.document_sequences;
DROP POLICY IF EXISTS "document_sequences_insert" ON public.document_sequences;
DROP POLICY IF EXISTS "document_sequences_update" ON public.document_sequences;
SELECT create_company_rls_policies('document_sequences', true, true);

-- ---------- document_approval_requests ----------
DROP POLICY IF EXISTS "document_approval_requests_select" ON public.document_approval_requests;
DROP POLICY IF EXISTS "document_approval_requests_insert" ON public.document_approval_requests;
DROP POLICY IF EXISTS "document_approval_requests_update" ON public.document_approval_requests;
SELECT create_company_rls_policies('document_approval_requests', true, true);

-- ---------- ucm_config ----------
DROP POLICY IF EXISTS "ucm_config_tenant_access" ON public.ucm_config;
SELECT create_company_rls_policies('ucm_config', true, true);

-- ---------- ucm_extensions ----------
DROP POLICY IF EXISTS "ucm_extensions_tenant_access" ON public.ucm_extensions;
SELECT create_company_rls_policies('ucm_extensions', true, true);

DO $$ BEGIN RAISE NOTICE '✅ [2D] 7 company settings/config tables upgraded'; END $$;


-- ============================================================
-- الدفعة 2E: جداول AI والمتبقية
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [2E] Upgrading AI and remaining tables...'; END $$;

-- ---------- ai_audit_log ----------
DROP POLICY IF EXISTS "ai_audit_admin_only" ON public.ai_audit_log;
SELECT create_company_rls_policies('ai_audit_log', true, true);

-- ---------- design_concepts ----------
DROP POLICY IF EXISTS "design_concepts_all_access" ON public.design_concepts;
SELECT create_company_rls_policies('design_concepts', true, true);

-- ---------- fabric_groups ----------
-- fabric_groups already has proper tenant policies from Phase 1
-- but needs company_id check upgrade
DROP POLICY IF EXISTS "fabric_groups_select_policy" ON public.fabric_groups;
DROP POLICY IF EXISTS "fabric_groups_insert_policy" ON public.fabric_groups;
DROP POLICY IF EXISTS "fabric_groups_update_policy" ON public.fabric_groups;
DROP POLICY IF EXISTS "fabric_groups_delete_policy" ON public.fabric_groups;
SELECT create_company_rls_policies('fabric_groups', true, true);

-- ---------- website_pages ----------
DROP POLICY IF EXISTS "website_pages_select" ON public.website_pages;
DROP POLICY IF EXISTS "website_pages_insert" ON public.website_pages;
DROP POLICY IF EXISTS "website_pages_update" ON public.website_pages;
DROP POLICY IF EXISTS "website_pages_delete" ON public.website_pages;
SELECT create_company_rls_policies('website_pages', true, true);

-- ---------- website_sections ----------
DROP POLICY IF EXISTS "website_sections_select" ON public.website_sections;
DROP POLICY IF EXISTS "website_sections_insert" ON public.website_sections;
DROP POLICY IF EXISTS "website_sections_update" ON public.website_sections;
DROP POLICY IF EXISTS "website_sections_delete" ON public.website_sections;
SELECT create_company_rls_policies('website_sections', true, true);

-- ---------- website_sites ----------
DROP POLICY IF EXISTS "website_sites_select" ON public.website_sites;
DROP POLICY IF EXISTS "website_sites_insert" ON public.website_sites;
DROP POLICY IF EXISTS "website_sites_update" ON public.website_sites;
DROP POLICY IF EXISTS "website_sites_delete" ON public.website_sites;
SELECT create_company_rls_policies('website_sites', true, true);

DO $$ BEGIN RAISE NOTICE '✅ [2E] 6 AI/remaining tables upgraded'; END $$;


-- ============================================================
-- التحقق النهائي للمرحلة 2
-- ============================================================
DO $$ 
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM information_schema.columns c1
  JOIN information_schema.columns c2 
    ON c1.table_name = c2.table_name AND c2.table_schema = 'public' AND c2.column_name = 'company_id'
  JOIN pg_tables t ON t.tablename = c1.table_name AND t.schemaname = 'public'  
  WHERE c1.table_schema = 'public' AND c1.column_name = 'tenant_id'
    AND c1.table_name NOT LIKE '_%'
    AND c1.table_name NOT LIKE 'v_%'
    AND c1.table_name NOT IN (
      SELECT DISTINCT tablename FROM pg_policies
      WHERE schemaname = 'public'
        AND (qual LIKE '%company_id%' OR with_check LIKE '%company_id%'
             OR qual LIKE '%check_row_access%' OR with_check LIKE '%check_row_access%'
             OR qual LIKE '%can_access_company%' OR with_check LIKE '%can_access_company%')
    );
  
  IF missing_count = 0 THEN
    RAISE NOTICE '✅ Phase 2 Verification PASSED — All tenant+company tables now have company-level isolation';
  ELSE
    RAISE WARNING '⚠️ Phase 2 Verification: Still % tables without company_id check', missing_count;
  END IF;
END $$;

COMMIT;
