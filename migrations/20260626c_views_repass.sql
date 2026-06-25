-- 20260626c — re-create all views AFTER the full schema + column sweep.
-- A view that references a column added by 20260626b's late column-sweep
-- failed to create in-order (e.g. public.materials). Re-running every view
-- once the complete schema exists fixes it. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE VIEW public.accounts_compatibility_view AS
 SELECT coa.id,
    coa.company_id,
    coa.account_code AS code,
    coa.name_ar AS name,
    coa.name_en,
        CASE at.classification
            WHEN 'assets'::text THEN 'asset'::text
            WHEN 'liabilities'::text THEN 'liability'::text
            WHEN 'equity'::text THEN 'equity'::text
            WHEN 'income'::text THEN 'revenue'::text
            WHEN 'expenses'::text THEN 'expense'::text
            ELSE 'asset'::text
        END AS account_type,
    coa.parent_id,
    coa.level,
    coa.is_group,
    coa.is_active,
    coa.currency AS currency_code,
    coa.opening_balance,
    coa.current_balance,
    NULL::text AS account_category,
    coa.created_at,
    coa.updated_at
   FROM (public.chart_of_accounts coa
     JOIN public.account_types at ON ((coa.account_type_id = at.id)));

CREATE OR REPLACE VIEW public.admin_expiring_subscriptions WITH (security_invoker='true') AS
 SELECT t.id AS tenant_id,
    t.name AS tenant_name,
    t.owner_email,
    s.status,
    s.trial_ends_at,
    s.current_period_end,
    sp.name_ar AS plan_name,
        CASE
            WHEN ((s.status)::text = 'trial'::text) THEN (s.trial_ends_at - now())
            ELSE (s.current_period_end - now())
        END AS time_remaining
   FROM ((public.tenants t
     JOIN public.subscriptions s ON ((t.id = s.tenant_id)))
     JOIN public.subscription_plans sp ON ((s.plan_id = sp.id)))
  WHERE (((t.status)::text = 'active'::text) AND ((((s.status)::text = 'trial'::text) AND (s.trial_ends_at < (now() + '7 days'::interval))) OR (((s.status)::text = 'active'::text) AND (s.current_period_end < (now() + '7 days'::interval)))))
  ORDER BY
        CASE
            WHEN ((s.status)::text = 'trial'::text) THEN s.trial_ends_at
            ELSE s.current_period_end
        END;

CREATE OR REPLACE VIEW public.admin_revenue_summary WITH (security_invoker='true') AS
 SELECT date_trunc('month'::text, (bi.invoice_date)::timestamp with time zone) AS month,
    count(DISTINCT bi.tenant_id) AS paying_customers,
    count(*) AS invoices_count,
    sum(bi.total_amount) AS total_invoiced,
    sum(bi.paid_amount) AS total_collected,
    sum(
        CASE
            WHEN ((bi.status)::text = 'paid'::text) THEN bi.total_amount
            ELSE (0)::numeric
        END) AS paid_invoices_amount,
    sum(
        CASE
            WHEN ((bi.status)::text = 'overdue'::text) THEN bi.total_amount
            ELSE (0)::numeric
        END) AS overdue_amount
   FROM public.billing_invoices bi
  GROUP BY (date_trunc('month'::text, (bi.invoice_date)::timestamp with time zone))
  ORDER BY (date_trunc('month'::text, (bi.invoice_date)::timestamp with time zone)) DESC;

CREATE OR REPLACE VIEW public.admin_tenants_summary WITH (security_invoker='true') AS
 SELECT t.id,
    t.code,
    t.name,
    t.owner_email,
    t.status,
    t.country,
    t.created_at,
    t.last_activity_at,
    s.status AS subscription_status,
    sp.name_ar AS plan_name,
    pr.name_ar AS product_name,
    s.trial_ends_at,
    s.current_period_end,
    s.amount AS subscription_amount,
    ( SELECT count(*) AS count
           FROM public.tenant_modules
          WHERE ((tenant_modules.tenant_id = t.id) AND (tenant_modules.is_active = true))) AS modules_count,
    t.users_count,
    t.storage_used_mb
   FROM (((public.tenants t
     LEFT JOIN public.subscriptions s ON ((t.id = s.tenant_id)))
     LEFT JOIN public.subscription_plans sp ON ((s.plan_id = sp.id)))
     LEFT JOIN public.saas_products pr ON ((s.product_id = pr.id)));

CREATE OR REPLACE VIEW public.agent_dashboard_view AS
 SELECT a.id,
    a.name,
    a.status,
    a.commission_rate
   FROM public.agents a;

CREATE OR REPLACE VIEW public.agent_tenants_view AS
 SELECT a.id AS agent_id,
    a.name AS agent_name,
    t.id AS tenant_id,
    t.name AS tenant_name
   FROM (public.agents a
     CROSS JOIN public.tenants t)
 LIMIT 0;

CREATE OR REPLACE VIEW public.marketplace_supplier_balances AS
 SELECT marketplace_supplier_ledger.supplier_link_id,
    marketplace_supplier_ledger.currency,
    sum(marketplace_supplier_ledger.amount) AS net_balance,
    count(*) AS entries
   FROM public.marketplace_supplier_ledger
  GROUP BY marketplace_supplier_ledger.supplier_link_id, marketplace_supplier_ledger.currency;

CREATE OR REPLACE VIEW public.materials AS
 SELECT fabric_materials.id,
    fabric_materials.tenant_id,
    fabric_materials.company_id,
    fabric_materials.product_id,
    fabric_materials.code,
    fabric_materials.name_ar,
    fabric_materials.name_en,
    fabric_materials.group_id,
    fabric_materials.composition,
    fabric_materials.category,
    fabric_materials.default_width,
    fabric_materials.weight_per_meter,
    fabric_materials.thread_count,
    fabric_materials.shrinkage_percent,
    fabric_materials.unit,
    fabric_materials.purchase_price,
    fabric_materials.selling_price,
    fabric_materials.currency,
    fabric_materials.min_stock,
    fabric_materials.reorder_point,
    fabric_materials.origin_country,
    fabric_materials.default_supplier_id,
    fabric_materials.images,
    fabric_materials.swatch_url,
    fabric_materials.slug,
    fabric_materials.is_visible_online,
    fabric_materials.is_featured,
    fabric_materials.notes,
    fabric_materials.custom_fields,
    fabric_materials.status,
    fabric_materials.created_at,
    fabric_materials.updated_at,
    fabric_materials.unit_id,
    fabric_materials.color,
    fabric_materials.color_hex,
    fabric_materials.sku,
    fabric_materials.barcode,
    fabric_materials.min_stock_level,
    fabric_materials.max_stock_level,
    fabric_materials.parent_id,
    fabric_materials.is_group,
    fabric_materials.level,
    fabric_materials.path,
    fabric_materials.tax_rate,
    fabric_materials.has_variants,
    fabric_materials.is_variant_parent,
    fabric_materials.parent_material_id,
    fabric_materials.variant_id,
    fabric_materials.current_stock,
    fabric_materials.is_active,
    fabric_materials.name_ru,
    fabric_materials.name_uk,
    fabric_materials.name_tr,
    fabric_materials.default_warehouse_id,
    fabric_materials.season,
    fabric_materials.width,
    fabric_materials.pattern,
    fabric_materials.texture,
    fabric_materials.care_instructions
   FROM public.fabric_materials;

CREATE OR REPLACE VIEW public.parties AS
 SELECT customers.id,
    customers.company_id,
    customers.tenant_id,
    customers.name_ar AS name,
    'customer'::text AS party_type
   FROM public.customers
UNION ALL
 SELECT suppliers.id,
    suppliers.company_id,
    suppliers.tenant_id,
    suppliers.name_ar AS name,
    'supplier'::text AS party_type
   FROM public.suppliers;

CREATE OR REPLACE VIEW public.performance_scores AS
 SELECT performance_ratings.subject_type,
    performance_ratings.subject_id,
    performance_ratings.dimension,
    round((sum((performance_ratings.score * performance_ratings.weight)) / NULLIF(sum(performance_ratings.weight), (0)::numeric)), 2) AS avg_score,
    count(*) AS samples
   FROM public.performance_ratings
  GROUP BY performance_ratings.subject_type, performance_ratings.subject_id, performance_ratings.dimension;

CREATE OR REPLACE VIEW public.profiles AS
 SELECT user_profiles.id,
    user_profiles.full_name,
    user_profiles.email,
    user_profiles.avatar_url,
    user_profiles.role
   FROM public.user_profiles;

CREATE OR REPLACE VIEW public.saas_products_stats WITH (security_invoker='true') AS
 SELECT sp.id,
    sp.code,
    sp.name,
    sp.name_ar,
    sp.domain,
    sp.primary_color,
    sp.is_active,
    count(DISTINCT t.id) AS tenant_count,
    count(DISTINCT c.id) AS company_count,
    count(DISTINCT up.id) AS user_count
   FROM (((public.saas_products sp
     LEFT JOIN public.tenants t ON ((t.product_id = sp.id)))
     LEFT JOIN public.companies c ON ((c.tenant_id = t.id)))
     LEFT JOIN public.user_profiles up ON ((up.tenant_id = t.id)))
  GROUP BY sp.id, sp.code, sp.name, sp.name_ar, sp.domain, sp.primary_color, sp.is_active;

CREATE OR REPLACE VIEW public.uom WITH (security_invoker='true') AS
 SELECT units_of_measure.id,
    units_of_measure.code,
    COALESCE(units_of_measure.name_ar, units_of_measure.name_en) AS name,
    units_of_measure.name_ar,
    units_of_measure.type AS uom_type,
    units_of_measure.is_active,
    units_of_measure.tenant_id,
    units_of_measure.created_at,
    units_of_measure.created_at AS updated_at
   FROM public.units_of_measure;

CREATE OR REPLACE VIEW public.user_warehouses WITH (security_invoker='true') AS
 SELECT wa.user_id,
    wa.warehouse_id,
    w.code AS warehouse_code,
    w.name AS warehouse_name,
    w.name_en AS warehouse_name_en,
    w.name_ar AS warehouse_name_ar,
    w.warehouse_type,
    wa.role,
    wa.is_active,
    b.id AS branch_id,
    b.code AS branch_code,
    b.name AS branch_name,
    b.city,
    b.country
   FROM ((public.warehouse_assignments wa
     JOIN public.warehouses w ON ((wa.warehouse_id = w.id)))
     JOIN public.branches b ON ((w.branch_id = b.id)))
  WHERE (wa.is_active = true);

CREATE OR REPLACE VIEW public.v_all_pages AS
 SELECT wp.id,
    wp.tenant_id,
    wp.company_id,
    ws.name AS site_name,
    ws.slug AS site_slug,
    wp.slug AS page_slug,
    wp.page_type,
    wp.page_category,
    wp.title_ar,
    wp.title_en,
    wp.title_uk,
    wp.title_tr,
    wp.seo_title_ar,
    wp.seo_title_en,
    wp.seo_description_ar,
    wp.seo_description_en,
    wp.show_in_nav,
    wp.show_in_footer,
    wp.show_in_header,
    wp.is_published,
    wp.sort_order,
    wp.featured_image,
    wp.store_id,
    wp.created_at,
    wp.updated_at
   FROM (public.website_pages wp
     JOIN public.website_sites ws ON ((ws.id = wp.site_id)))
  WHERE (ws.is_active = true);

CREATE OR REPLACE VIEW public.v_available_for_reservation WITH (security_invoker='true') AS
 SELECT ci.id AS item_id,
    ci.container_id,
    c.container_number,
    c.status AS container_status,
    c.expected_arrival_date,
    ci.material_id,
    ci.color_id,
    ci.item_description,
    COALESCE(ci.expected_quantity, (0)::numeric) AS expected_quantity,
    COALESCE(ci.received_quantity, (0)::numeric) AS received_quantity,
    COALESCE(ci.reserved_quantity, (0)::numeric) AS reserved_quantity,
    COALESCE(ci.sold_quantity, (0)::numeric) AS sold_quantity,
    GREATEST((0)::numeric, ((COALESCE(ci.expected_quantity, (0)::numeric) - COALESCE(ci.reserved_quantity, (0)::numeric)) - COALESCE(ci.sold_quantity, (0)::numeric))) AS available_for_reservation,
    ci.provisional_unit_cost,
    ci.final_unit_cost
   FROM (public.container_items ci
     JOIN public.containers c ON ((c.id = ci.container_id)))
  WHERE ((c.status)::text <> 'cancelled'::text);

CREATE OR REPLACE VIEW public.v_company_rounding_settings WITH (security_invoker='true') AS
 SELECT c.id AS company_id,
    c.name AS company_name,
    co.code AS country_code,
    co.name AS country_name,
    c.inherit_country_rounding,
        CASE
            WHEN c.inherit_country_rounding THEN co.rounding_method
            ELSE c.rounding_method
        END AS effective_rounding_method,
        CASE
            WHEN c.inherit_country_rounding THEN co.tax_rounding
            ELSE c.tax_rounding
        END AS effective_tax_rounding,
        CASE
            WHEN c.inherit_country_rounding THEN co.amount_rounding
            ELSE c.amount_rounding
        END AS effective_amount_rounding,
        CASE
            WHEN c.inherit_country_rounding THEN co.unit_price_rounding
            ELSE c.unit_price_rounding
        END AS effective_unit_price_rounding,
        CASE
            WHEN c.inherit_country_rounding THEN co.total_rounding
            ELSE c.total_rounding
        END AS effective_total_rounding
   FROM ((public.companies c
     LEFT JOIN public.company_countries cc ON (((cc.company_id = c.id) AND (cc.is_primary = true))))
     LEFT JOIN public.countries co ON (((co.code)::text = (cc.country_code)::text)));

CREATE OR REPLACE VIEW public.v_container_cost_summary WITH (security_invoker='true') AS
 SELECT c.id,
    c.tenant_id,
    c.company_id,
    c.container_number,
    c.status,
    c.cost_allocation_method,
    c.is_cost_finalized,
    c.finalized_at,
    COALESCE(items.total_items, (0)::bigint) AS total_items,
    COALESCE(items.total_quantity, (0)::numeric) AS total_quantity,
    COALESCE(items.total_goods_value, (0)::numeric) AS total_goods_value,
    COALESCE(expenses.total_expenses_count, (0)::bigint) AS total_expenses_count,
    COALESCE(expenses.total_expected_expenses, (0)::numeric) AS total_expected_expenses,
    COALESCE(expenses.total_actual_expenses, (0)::numeric) AS total_actual_expenses,
    (COALESCE(items.total_goods_value, (0)::numeric) + COALESCE(expenses.total_actual_expenses, (0)::numeric)) AS total_landed_cost,
        CASE
            WHEN (COALESCE(items.total_quantity, (0)::numeric) > (0)::numeric) THEN ((COALESCE(items.total_goods_value, (0)::numeric) + COALESCE(expenses.total_actual_expenses, (0)::numeric)) / items.total_quantity)
            ELSE (0)::numeric
        END AS average_unit_cost,
    (COALESCE(expenses.total_actual_expenses, (0)::numeric) - COALESCE(expenses.total_expected_expenses, (0)::numeric)) AS expense_variance
   FROM ((public.containers c
     LEFT JOIN ( SELECT container_items.container_id,
            count(*) AS total_items,
            sum(container_items.expected_quantity) AS total_quantity,
            sum((container_items.unit_cost * container_items.expected_quantity)) AS total_goods_value
           FROM public.container_items
          GROUP BY container_items.container_id) items ON ((c.id = items.container_id)))
     LEFT JOIN ( SELECT container_expenses.container_id,
            count(*) AS total_expenses_count,
            sum(COALESCE(container_expenses.expected_amount, (0)::numeric)) AS total_expected_expenses,
            sum(COALESCE(container_expenses.actual_amount, container_expenses.expected_amount, container_expenses.amount, (0)::numeric)) AS total_actual_expenses
           FROM public.container_expenses
          GROUP BY container_expenses.container_id) expenses ON ((c.id = expenses.container_id)));

CREATE OR REPLACE VIEW public.v_container_summary WITH (security_invoker='true') AS
 SELECT c.id,
    c.container_number,
    c.status,
    c.supplier_id,
    c.shipping_company,
    c.departure_date,
    c.arrival_date,
    c.expected_arrival_date,
    c.actual_arrival_date,
    c.total_purchase_value,
    c.total_expected_costs,
    c.total_actual_costs,
    c.total_landed_cost,
    c.is_cost_finalized,
    COALESCE(c.total_actual_costs, c.total_expected_costs, (0)::numeric) AS current_costs,
    (COALESCE(c.total_purchase_value, (0)::numeric) + COALESCE(c.total_actual_costs, c.total_expected_costs, (0)::numeric)) AS total_value,
    ( SELECT count(*) AS count
           FROM public.container_items ci
          WHERE (ci.container_id = c.id)) AS items_count,
    ( SELECT COALESCE(sum(cr.reserved_quantity), (0)::numeric) AS "coalesce"
           FROM public.container_reservations cr
          WHERE ((cr.container_id = c.id) AND (cr.status <> 'cancelled'::text))) AS total_reserved
   FROM public.containers c;

CREATE OR REPLACE VIEW public.v_cost_center_summary WITH (security_invoker='true') AS
 SELECT cc.id,
    cc.tenant_id,
    cc.company_id,
    cc.code,
    cc.full_code,
    cc.name_ar,
    cc.name_en,
    cc.cost_center_type,
    cc.level,
    cc.is_group,
    cc.is_active,
    p.name_ar AS parent_name,
    cc.budget_limit,
    cc.current_spending,
        CASE
            WHEN (cc.budget_limit > (0)::numeric) THEN (cc.budget_limit - COALESCE(cc.current_spending, (0)::numeric))
            ELSE NULL::numeric
        END AS remaining_budget,
        CASE
            WHEN (cc.budget_limit > (0)::numeric) THEN round(((COALESCE(cc.current_spending, (0)::numeric) / cc.budget_limit) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS utilization_percent,
        CASE
            WHEN ((cc.budget_limit > (0)::numeric) AND (cc.current_spending > cc.budget_limit)) THEN 'exceeded'::text
            WHEN ((cc.budget_limit > (0)::numeric) AND (cc.current_spending > (cc.budget_limit * 0.9))) THEN 'warning'::text
            WHEN ((cc.budget_limit > (0)::numeric) AND (cc.current_spending > (cc.budget_limit * 0.75))) THEN 'caution'::text
            ELSE 'ok'::text
        END AS budget_status
   FROM (public.cost_centers cc
     LEFT JOIN public.cost_centers p ON ((cc.parent_id = p.id)))
  WHERE (cc.is_active = true);

CREATE OR REPLACE VIEW public.v_receipt_variance_review WITH (security_invoker='true') AS
 SELECT pr.id,
    pr.receipt_number,
    pr.receipt_date,
    pr.company_id,
    pr.warehouse_id,
    pr.variance_status,
    pr.variance_amount,
    pr.variance_pct,
    pr.variance_tolerance_pct,
    COALESCE(pi.invoice_number, po.order_number, c.container_number) AS source_doc_number,
    COALESCE(pi.supplier_id, po.supplier_id) AS supplier_id,
    pr.invoice_id,
    pr.order_id,
    pr.container_id,
    pr.created_at
   FROM (((public.purchase_receipts pr
     LEFT JOIN public.purchase_invoices pi ON ((pr.invoice_id = pi.id)))
     LEFT JOIN public.purchase_orders po ON ((pr.order_id = po.id)))
     LEFT JOIN public.containers c ON ((pr.container_id = c.id)))
  WHERE ((pr.variance_status = 'requires_review'::text) AND (pr.status = 'completed'::text))
  ORDER BY pr.created_at DESC;

CREATE OR REPLACE VIEW public.v_shipment_items_full WITH (security_invoker='true') AS
 SELECT si.id,
    si.tenant_id,
    si.shipment_id,
    si.material_id,
    si.color_id,
    si.product_id,
    si.purchase_invoice_id,
    si.supplier_id,
    si.item_description AS item_name,
    si.material_code,
    si.color_name,
    si.supplier_name,
    COALESCE(si.invoice_number, ''::character varying) AS invoice_number,
    si.expected_rolls,
    si.received_rolls,
    si.expected_quantity,
    si.received_quantity,
    si.unit,
    si.reserved_quantity,
    si.sold_quantity,
    ((COALESCE(si.expected_quantity, (0)::numeric) - COALESCE(si.reserved_quantity, (0)::numeric)) - COALESCE(si.sold_quantity, (0)::numeric)) AS available_quantity,
    si.unit_price,
    si.total_price,
    si.provisional_unit_cost,
    si.final_unit_cost,
    si.allocated_costs,
    si.total_provisional_cost,
    si.total_final_cost,
    si.expected_sell_price,
    si.weight_kg,
    si.notes,
    si.created_at
   FROM public._archived_shipment_items si;

CREATE OR REPLACE VIEW public.white_label_summary_view AS
 SELECT wlc.id,
    wlc.tenant_id,
    wlc.brand_name,
    wlc.logo_url,
    wlc.primary_color,
    wlc.domain,
    wlc.is_active,
    wlc.config,
    wlc.created_at,
    wlc.updated_at,
    ( SELECT count(*) AS count
           FROM public.white_label_domains d
          WHERE (d.config_id = wlc.id)) AS domain_count
   FROM public.white_label_configs wlc;

