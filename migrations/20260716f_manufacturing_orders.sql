-- 20260716f: موديول التصنيع — أوامر الإنتاج ومستندات التنفيذ — P1a (طبقة القاعدة)
-- ═══════════════════════════════════════════════════════════════════════════
-- ينشئ مخطط التنفيذ الكامل (§2.3 + §3.5 + §3.7 + قرارات §4-ج/1,3,30 + §4-د/11):
--   mfg_production_orders · mfg_order_sales_links · mfg_order_stages ·
--   mfg_material_issues (+lines) · mfg_material_returns (+lines) ·
--   mfg_finished_receipts (+lines) · mfg_material_reservations ·
--   mfg_labor_logs · mfg_downtime_events
-- كل الجداول: tenant_id + company_id + RLS بالنمط القياسي. idempotent بالكامل.
-- لا عمود sales_transaction_id مفرد — يُستعمل جدول الوصل mfg_order_sales_links (§4-ج/30).
-- WIP كمّي في mfg_order_stages فقط، لا في inventory_stock (§4-ج/13).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) أوامر الإنتاج — mfg_production_orders (§2.3 + §4-د/1 لقطة الوصفة)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_production_orders (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   uuid NOT NULL,
    company_id                  uuid NOT NULL,
    branch_id                   uuid,
    order_number                text,                       -- MFG-ORD-2026-00001
    product_id                  uuid REFERENCES public.products(id) ON DELETE SET NULL,
    bom_id                      uuid REFERENCES public.mfg_boms(id) ON DELETE SET NULL,
    bom_version                 int,                         -- نسخة الوصفة المستخدمة (recall)
    bom_snapshot                jsonb,                       -- لقطة مجمّدة (بنود+مخرجات) عند التأكيد
    qty_planned                 numeric DEFAULT 0,
    qty_produced                numeric DEFAULT 0,           -- جيّد مستلَم
    qty_scrapped                numeric DEFAULT 0,
    status                      text DEFAULT 'draft'
        CHECK (status IN ('draft','confirmed','in_progress','completed','terminated','closed','cancelled')),
    -- المستودعات:
    source_warehouse_id         uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,   -- الخام
    wip_warehouse_id            uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,   -- تحت التشغيل
    fg_warehouse_id             uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,   -- التام
    scrap_warehouse_id          uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,   -- الخردة
    workflow_template_id        uuid REFERENCES public.mfg_workflow_templates(id) ON DELETE SET NULL,
    overproduction_pct          numeric DEFAULT 0,           -- حارس تجاوز الكمية (§4-د/21)
    -- التخطيط والتكاليف (مخطط مقابل فعلي — أساس تحليل الانحرافات):
    planned_start_date          date,
    planned_end_date            date,
    actual_start_date           date,
    actual_end_date             date,
    planned_material_cost       numeric DEFAULT 0,
    actual_material_cost        numeric DEFAULT 0,
    planned_labor_cost          numeric DEFAULT 0,
    actual_labor_cost           numeric DEFAULT 0,
    planned_overhead_cost       numeric DEFAULT 0,
    actual_overhead_cost        numeric DEFAULT 0,
    subcontract_cost            numeric DEFAULT 0,           -- فعلي (تعاقد باطن)
    received_cost               numeric DEFAULT 0,           -- المتراكم المسحوب من WIP بالاستلامات
    -- الترحيل المحاسبي (nullable — P2):
    wip_journal_entry_id        uuid,
    completion_journal_entry_id uuid,
    is_deleted                  boolean DEFAULT false,
    deleted_at                  timestamptz,
    custom_data                 jsonb DEFAULT '{}'::jsonb,
    notes                       text,
    created_by                  uuid,
    created_at                  timestamptz DEFAULT now(),
    updated_at                  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_production_orders_tenant_company ON public.mfg_production_orders (tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_production_orders_product        ON public.mfg_production_orders (product_id);
CREATE INDEX IF NOT EXISTS idx_mfg_production_orders_status         ON public.mfg_production_orders (company_id, status) WHERE is_deleted = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) وصلة البيع المتعددة — mfg_order_sales_links (§4-ج/30 — من اليوم الأول)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_order_sales_links (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    order_id              uuid NOT NULL REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    sales_transaction_id  uuid REFERENCES public.sales_transactions(id) ON DELETE CASCADE,
    qty_allocated         numeric,
    created_at            timestamptz DEFAULT now(),
    UNIQUE (order_id, sales_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_mfg_order_sales_links_order          ON public.mfg_order_sales_links (order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_order_sales_links_tenant_company ON public.mfg_order_sales_links (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) مراحل الأمر — mfg_order_stages (نسخ حية من قالب المراحل) (§2.3)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_order_stages (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 uuid NOT NULL,
    company_id                uuid NOT NULL,
    production_order_id        uuid NOT NULL REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    template_stage_id          uuid REFERENCES public.mfg_workflow_stages(id) ON DELETE SET NULL,  -- مرجع فقط
    seq                        int DEFAULT 0,
    name_ar                    text,
    name_en                    text,
    work_center_id             uuid REFERENCES public.mfg_work_centers(id) ON DELETE SET NULL,
    status                     text DEFAULT 'blocked'
        CHECK (status IN ('blocked','ready','in_progress','done','skipped')),
    qty_in                     numeric DEFAULT 0,
    qty_good                   numeric DEFAULT 0,
    qty_scrap                  numeric DEFAULT 0,
    qty_rework                 numeric DEFAULT 0,
    pay_type                   text,
    piece_rate                 numeric,
    expected_minutes_per_unit  numeric,
    fixed_minutes              numeric,
    is_passive                 boolean DEFAULT false,
    min_wait_hours             numeric DEFAULT 0,           -- زمن انتظار بعد المرحلة (§4-د/6)
    wait_until                 timestamptz,                 -- متى تصبح المرحلة التالية جاهزة
    planned_minutes            numeric,
    actual_minutes             numeric,
    started_at                 timestamptz,
    completed_at               timestamptz,
    is_subcontracted           boolean DEFAULT false,
    subcontractor_id           uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
    subcontract_cost           numeric,
    qc_checklist               jsonb DEFAULT '[]'::jsonb,
    qc_results                 jsonb DEFAULT '{}'::jsonb,
    custom_data                jsonb DEFAULT '{}'::jsonb,
    created_at                 timestamptz DEFAULT now(),
    updated_at                 timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_order_stages_order          ON public.mfg_order_stages (production_order_id, seq);
CREATE INDEX IF NOT EXISTS idx_mfg_order_stages_tenant_company ON public.mfg_order_stages (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) صرف المواد — mfg_material_issues (+lines) (§2.3 + §4-ج/12 استبدال)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_material_issues (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    production_order_id    uuid NOT NULL REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    order_stage_id         uuid REFERENCES public.mfg_order_stages(id) ON DELETE SET NULL,
    issue_number          text,
    issue_date            date DEFAULT CURRENT_DATE,
    status                text DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
    is_backflush          boolean DEFAULT false,      -- أُنشئ آلياً من إكمال المرحلة
    movement_batch_ref    text,
    journal_entry_id      uuid,
    custom_data           jsonb DEFAULT '{}'::jsonb,
    posted_at             timestamptz,
    created_by            uuid,
    created_at            timestamptz DEFAULT now(),
    updated_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_material_issues_order          ON public.mfg_material_issues (production_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_material_issues_tenant_company ON public.mfg_material_issues (tenant_id, company_id);

CREATE TABLE IF NOT EXISTS public.mfg_material_issue_lines (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    issue_id              uuid NOT NULL REFERENCES public.mfg_material_issues(id) ON DELETE CASCADE,
    product_id            uuid REFERENCES public.products(id) ON DELETE SET NULL,
    bom_line_id           uuid REFERENCES public.mfg_bom_lines(id) ON DELETE SET NULL,
    qty                   numeric,
    unit_id               uuid REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
    unit_cost             numeric,                     -- من متوسط التكلفة وقت الصرف
    roll_id               uuid REFERENCES public.fabric_rolls(id) ON DELETE SET NULL,
    cut_length            numeric,
    batch_id              uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
    warehouse_id          uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
    is_substitute         boolean DEFAULT false,
    substituted_line_id   uuid REFERENCES public.mfg_bom_lines(id) ON DELETE SET NULL,
    movement_id           uuid,                        -- inventory_movements المولَّدة
    notes                 text,
    created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_material_issue_lines_issue         ON public.mfg_material_issue_lines (issue_id);
CREATE INDEX IF NOT EXISTS idx_mfg_material_issue_lines_tenant_company ON public.mfg_material_issue_lines (tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_material_issue_lines_batch          ON public.mfg_material_issue_lines (batch_id);
CREATE INDEX IF NOT EXISTS idx_mfg_material_issue_lines_roll           ON public.mfg_material_issue_lines (roll_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) مرتجع المواد — mfg_material_returns (+lines) (§4-ج/1 — بتكلفة وقت الصرف)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_material_returns (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    production_order_id    uuid NOT NULL REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    order_stage_id         uuid REFERENCES public.mfg_order_stages(id) ON DELETE SET NULL,
    return_number         text,
    return_date           date DEFAULT CURRENT_DATE,
    status                text DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
    journal_entry_id      uuid,
    custom_data           jsonb DEFAULT '{}'::jsonb,
    posted_at             timestamptz,
    created_by            uuid,
    created_at            timestamptz DEFAULT now(),
    updated_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_material_returns_order          ON public.mfg_material_returns (production_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_material_returns_tenant_company ON public.mfg_material_returns (tenant_id, company_id);

CREATE TABLE IF NOT EXISTS public.mfg_material_return_lines (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    return_id             uuid NOT NULL REFERENCES public.mfg_material_returns(id) ON DELETE CASCADE,
    issue_line_id         uuid REFERENCES public.mfg_material_issue_lines(id) ON DELETE SET NULL,  -- يرجع ما صُرف
    product_id            uuid REFERENCES public.products(id) ON DELETE SET NULL,
    qty                   numeric,
    unit_cost             numeric,                     -- = تكلفة وقت الصرف (من سطر الصرف)
    roll_id               uuid REFERENCES public.fabric_rolls(id) ON DELETE SET NULL,
    batch_id              uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
    warehouse_id          uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
    movement_id           uuid,
    created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_material_return_lines_return        ON public.mfg_material_return_lines (return_id);
CREATE INDEX IF NOT EXISTS idx_mfg_material_return_lines_issue_line    ON public.mfg_material_return_lines (issue_line_id);
CREATE INDEX IF NOT EXISTS idx_mfg_material_return_lines_tenant_company ON public.mfg_material_return_lines (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) استلام المخرجات — mfg_finished_receipts (+lines) (§2.3 — متعدد المنتجات)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_finished_receipts (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    production_order_id    uuid NOT NULL REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    order_stage_id         uuid REFERENCES public.mfg_order_stages(id) ON DELETE SET NULL,
    receipt_number        text,
    receipt_date          date DEFAULT CURRENT_DATE,
    status                text DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
    total_cost            numeric,                     -- المتراكم المسحوب من WIP بهذا الاستلام
    cost_breakdown        jsonb DEFAULT '{}'::jsonb,   -- {material, labor, overhead, subcontract, recovery_credit, pool, share}
    journal_entry_id      uuid,
    custom_data           jsonb DEFAULT '{}'::jsonb,
    posted_at             timestamptz,
    created_by            uuid,
    created_at            timestamptz DEFAULT now(),
    updated_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_finished_receipts_order          ON public.mfg_finished_receipts (production_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_finished_receipts_tenant_company ON public.mfg_finished_receipts (tenant_id, company_id);

CREATE TABLE IF NOT EXISTS public.mfg_finished_receipt_lines (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    receipt_id            uuid NOT NULL REFERENCES public.mfg_finished_receipts(id) ON DELETE CASCADE,
    product_id            uuid REFERENCES public.products(id) ON DELETE SET NULL,
    output_role           text DEFAULT 'primary' CHECK (output_role IN ('primary','co_product','byproduct','scrap')),
    qty                   numeric,
    unit_id               uuid REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
    package_size          numeric,                     -- التعبئة بأحجام متعددة من نفس الدفعة
    cost_share_pct        numeric,
    unit_cost             numeric,                     -- بعد تقسيم التكلفة
    batch_id              uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,  -- دفعة منتَجة
    qc_certificate        jsonb DEFAULT '{}'::jsonb,   -- CoA
    warehouse_id          uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
    movement_id           uuid,
    created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_finished_receipt_lines_receipt        ON public.mfg_finished_receipt_lines (receipt_id);
CREATE INDEX IF NOT EXISTS idx_mfg_finished_receipt_lines_tenant_company ON public.mfg_finished_receipt_lines (tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_finished_receipt_lines_batch          ON public.mfg_finished_receipt_lines (batch_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) حجوزات المواد — mfg_material_reservations (§3.7)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_material_reservations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    production_order_id    uuid NOT NULL REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    product_id            uuid REFERENCES public.products(id) ON DELETE SET NULL,
    warehouse_id          uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
    qty_reserved          numeric,
    roll_id               uuid REFERENCES public.fabric_rolls(id) ON DELETE SET NULL,
    batch_id              uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
    status                text DEFAULT 'active' CHECK (status IN ('active','consumed','released')),
    created_at            timestamptz DEFAULT now(),
    released_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mfg_material_reservations_order          ON public.mfg_material_reservations (production_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_material_reservations_active         ON public.mfg_material_reservations (product_id, warehouse_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_mfg_material_reservations_tenant_company ON public.mfg_material_reservations (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) سجلات العمل/الأجور — mfg_labor_logs (§3.5 + §4-ج/7 اعتماد قبل المسيّر)
--    (المخطط الآن؛ الواجهة والترحيل للمسيّر P2)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_labor_logs (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    production_order_id    uuid NOT NULL REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    order_stage_id         uuid REFERENCES public.mfg_order_stages(id) ON DELETE SET NULL,
    bundle_id             uuid,                        -- mfg_bundles (P4) — بلا FK حتى يُنشأ الجدول
    employee_id           uuid,                        -- FK للموظفين يُضاف أدناه إن وُجد الجدول
    work_date             date DEFAULT CURRENT_DATE,
    minutes               numeric,                     -- للأجر بالساعة
    qty_good              numeric,                     -- للأجر بالقطعة
    qty_reject            numeric,
    pay_type              text,                        -- لقطة وقت التسجيل
    rate                  numeric,
    wage_amount           numeric,                     -- محسوب: rate×qty أو rate×ساعات
    payroll_entry_id      uuid,                        -- يُملأ عند ترحيل المسيّر (P2)
    approved_by           uuid,                        -- اعتماد قبل المسيّر (§4-ج/7)
    approved_at           timestamptz,
    created_by            uuid,
    created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_labor_logs_order          ON public.mfg_labor_logs (production_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_labor_logs_stage          ON public.mfg_labor_logs (order_stage_id);
CREATE INDEX IF NOT EXISTS idx_mfg_labor_logs_tenant_company ON public.mfg_labor_logs (tenant_id, company_id);

-- FK الموظف (حقيقي إن وُجد جدول employees) — دفاعي للتكافؤ محلي/سحابي
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='employees')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_mfg_labor_logs_employee') THEN
        ALTER TABLE public.mfg_labor_logs
            ADD CONSTRAINT fk_mfg_labor_logs_employee
            FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9) أحداث التوقف — mfg_downtime_events (§4-د/11 — جسر OEE لاحقاً)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_downtime_events (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    work_center_id        uuid REFERENCES public.mfg_work_centers(id) ON DELETE SET NULL,
    production_order_id    uuid REFERENCES public.mfg_production_orders(id) ON DELETE SET NULL,
    started_at            timestamptz,
    ended_at              timestamptz,
    reason_code           text,
    notes                 text,
    created_by            uuid,
    created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_downtime_events_wc             ON public.mfg_downtime_events (work_center_id);
CREATE INDEX IF NOT EXISTS idx_mfg_downtime_events_tenant_company ON public.mfg_downtime_events (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — النمط القياسي على كل الجداول.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'mfg_production_orders','mfg_order_sales_links','mfg_order_stages',
        'mfg_material_issues','mfg_material_issue_lines',
        'mfg_material_returns','mfg_material_return_lines',
        'mfg_finished_receipts','mfg_finished_receipt_lines',
        'mfg_material_reservations','mfg_labor_logs','mfg_downtime_events'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()))', tbl || '_select_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_insert_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_update_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_delete_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_delete_policy', tbl);
    END LOOP;
END $$;

COMMIT;
