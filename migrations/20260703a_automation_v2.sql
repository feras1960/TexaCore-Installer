-- ═══════════════════════════════════════════════════════════════
-- Order Automation v2
--  1. إعدادات تحكم عامة (kill switch / ساعات هدوء / سقف يومي / نكسا)
--  2. دليل الفريق التشغيلي (عتال/سائق/مجهّز… بقنواتهم)
--  3. سلاسل تصعيد بالمهام (chain: تلغرام → اتصال أولينا → تصعيد)
--  4. قناة nexalive + دور المستلم من الدليل
--  5. حدث الدفع: paid → تقدّم تلقائي + إشعار
--  6. خطّاف نوفا بوشتا: تسليم/إرجاع → إغلاق/تنبيه تلقائي
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Global control settings (صف لكل tenant) ───
CREATE TABLE IF NOT EXISTS ecommerce_automation_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT true,          -- kill switch عام
    quiet_start TIME,                               -- مثال 21:00
    quiet_end TIME,                                 -- مثال 08:00
    timezone TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    daily_message_cap INTEGER NOT NULL DEFAULT 200,
    daily_sent_count INTEGER NOT NULL DEFAULT 0,
    daily_count_date DATE,
    cap_alerted_date DATE,
    nexa_ops_conversation_id UUID,                  -- محادثة «العمليات» بنكسا لايف
    nexa_sender_user_id UUID,                       -- هوية المُرسِل (مستخدم النظام/أولينا)
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ecommerce_automation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "eas_tenant_manage" ON ecommerce_automation_settings;
CREATE POLICY "eas_tenant_manage" ON ecommerce_automation_settings
    FOR ALL TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());
GRANT SELECT, INSERT, UPDATE ON ecommerce_automation_settings TO authenticated;

-- ─── 2. Ops team directory ───
CREATE TABLE IF NOT EXISTS ops_team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,                 -- porter | driver | warehouse | manager | accountant | custom…
    telegram_chat_id TEXT,
    nexa_user_id UUID,
    extension TEXT,                     -- تحويلة المقسم (لاتصال أولينا الداخلي)
    phone TEXT,
    channel_priority TEXT[] DEFAULT ARRAY['telegram','nexalive','call'],
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otm_tenant_role ON ops_team_members(tenant_id, role) WHERE is_active;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS trg_otm_updated ON ops_team_members;
        CREATE TRIGGER trg_otm_updated BEFORE UPDATE ON ops_team_members
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_set_tenant_id') THEN
        DROP TRIGGER IF EXISTS trg_otm_tenant ON ops_team_members;
        CREATE TRIGGER trg_otm_tenant BEFORE INSERT ON ops_team_members
            FOR EACH ROW EXECUTE FUNCTION auto_set_tenant_id();
    END IF;
END $$;

ALTER TABLE ops_team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "otm_tenant_manage" ON ops_team_members;
CREATE POLICY "otm_tenant_manage" ON ops_team_members
    FOR ALL TO authenticated
    USING (is_platform_admin() OR tenant_id = get_user_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON ops_team_members TO authenticated;

-- ─── 3. Chain support on agent tasks ───
ALTER TABLE ecommerce_agent_tasks ADD COLUMN IF NOT EXISTS chain JSONB;        -- [{channel, wait_minutes, prompt}]
ALTER TABLE ecommerce_agent_tasks ADD COLUMN IF NOT EXISTS chain_index INTEGER DEFAULT 0;
ALTER TABLE ecommerce_agent_tasks ADD COLUMN IF NOT EXISTS role TEXT;          -- دور المستلم من الدليل

ALTER TABLE ecommerce_agent_tasks DROP CONSTRAINT IF EXISTS ecommerce_agent_tasks_task_type_check;
ALTER TABLE ecommerce_agent_tasks ADD CONSTRAINT ecommerce_agent_tasks_task_type_check
    CHECK (task_type IN ('telegram', 'call', 'whatsapp', 'nexalive'));

-- ─── 4. Trigger v2: role resolution من الدليل + بناء السلسلة ───
CREATE OR REPLACE FUNCTION enqueue_order_agent_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stage RECORD;
    v_task JSONB;
    v_sup RECORD;
    v_member RECORD;
    v_recipient JSONB;
    v_chain JSONB;
    v_primary TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_stage FROM ecommerce_workflow_stages
    WHERE code = NEW.status
      AND doc_type = 'ecom_order'
      AND is_active = true
      AND (store_id = NEW.store_id OR store_id IS NULL)
    ORDER BY store_id NULLS LAST
    LIMIT 1;

    IF v_stage IS NULL OR COALESCE((v_stage.automation_config->>'enabled')::boolean, false) = false THEN
        RETURN NEW;
    END IF;

    FOR v_task IN SELECT * FROM jsonb_array_elements(COALESCE(v_stage.automation_config->'tasks', '[]'::jsonb))
    LOOP
        v_primary := COALESCE(v_task->>'task_type', 'telegram');
        -- chain: الخطوة الأساسية + الخطوات الاحتياطية (fallback_steps)
        v_chain := jsonb_build_array(jsonb_build_object(
            'channel', v_primary,
            'wait_minutes', COALESCE((v_task->>'timeout_minutes')::int, 120),
            'prompt', v_task->>'call_prompt'
        )) || COALESCE(v_task->'fallback_steps', '[]'::jsonb);

        IF v_task->>'recipient_type' = 'supplier' THEN
            FOR v_sup IN
                SELECT id, supplier_id, supplier_name, supplier_phone
                FROM ecommerce_order_suppliers
                WHERE order_id = NEW.id AND status IN ('pending')
            LOOP
                INSERT INTO ecommerce_agent_tasks
                    (tenant_id, store_id, order_id, supplier_row_id, stage_code, task_type,
                     recipient_type, recipient, payload, advance_to, chain)
                VALUES
                    (NEW.tenant_id, NEW.store_id, NEW.id, v_sup.id, NEW.status, v_primary,
                     'supplier',
                     jsonb_build_object('name', v_sup.supplier_name, 'phone', v_sup.supplier_phone, 'supplier_id', v_sup.supplier_id),
                     v_task, v_task->>'advance_to', v_chain);
            END LOOP;
        ELSE
            v_recipient := '{}'::jsonb;
            IF v_task->>'recipient_type' = 'customer' THEN
                v_recipient := jsonb_build_object('name', NEW.customer_name, 'phone', NEW.customer_phone, 'email', NEW.customer_email);
            ELSIF v_task->>'role' IS NOT NULL THEN
                -- حل المستلم من دليل الفريق (أول عضو نشط بالدور)
                SELECT * INTO v_member FROM ops_team_members
                WHERE tenant_id = NEW.tenant_id AND role = v_task->>'role' AND is_active = true
                ORDER BY created_at LIMIT 1;
                IF v_member.id IS NOT NULL THEN
                    v_recipient := jsonb_build_object(
                        'name', v_member.name, 'phone', v_member.phone,
                        'chat_id', v_member.telegram_chat_id,
                        'nexa_user_id', v_member.nexa_user_id,
                        'extension', v_member.extension,
                        'member_id', v_member.id);
                END IF;
            ELSIF v_task->>'custom_chat_id' IS NOT NULL THEN
                v_recipient := jsonb_build_object('chat_id', v_task->>'custom_chat_id');
            END IF;

            INSERT INTO ecommerce_agent_tasks
                (tenant_id, store_id, order_id, stage_code, task_type,
                 recipient_type, recipient, payload, advance_to, chain, role)
            VALUES
                (NEW.tenant_id, NEW.store_id, NEW.id, NEW.status, v_primary,
                 v_task->>'recipient_type', v_recipient, v_task,
                 v_task->>'advance_to', v_chain, v_task->>'role');
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

-- ─── 5. Payment event: paid → تقدّم تلقائي + إشعار ───
CREATE OR REPLACE FUNCTION enqueue_order_payment_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stage RECORD;
    v_target TEXT;
BEGIN
    IF NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status OR NEW.payment_status <> 'paid' THEN
        RETURN NEW;
    END IF;

    -- إشعار فوري للإدارة بالدفعة
    INSERT INTO ecommerce_agent_tasks
        (tenant_id, store_id, order_id, stage_code, task_type, recipient_type, recipient, payload, chain)
    VALUES
        (NEW.tenant_id, NEW.store_id, NEW.id, NEW.status, 'telegram', 'admin', '{}'::jsonb,
         jsonb_build_object(
            'template_ar', '💰 دفعة مستلمة — الطلب {order_number}' || E'\n' || 'الزبون: {customer_name}' || E'\n' || 'المبلغ: {total} {currency}',
            'requires_confirmation', false),
         jsonb_build_array(jsonb_build_object('channel', 'telegram', 'wait_minutes', 60)));

    -- تقدّم تلقائي إن ضُبط on_paid_advance_to على مرحلة الطلب الحالية
    SELECT * INTO v_stage FROM ecommerce_workflow_stages
    WHERE code = NEW.status AND doc_type = 'ecom_order' AND is_active = true
      AND (store_id = NEW.store_id OR store_id IS NULL)
    ORDER BY store_id NULLS LAST LIMIT 1;

    v_target := v_stage.automation_config->>'on_paid_advance_to';
    IF v_target IS NOT NULL AND v_target <> NEW.status THEN
        UPDATE ecommerce_orders
        SET status = v_target,
            status_history = COALESCE(status_history, '[]'::jsonb) || jsonb_build_object(
                'from', NEW.status, 'to', v_target, 'status', v_target,
                'comment', 'أتمتة: استلام الدفعة', 'timestamp', now())
        WHERE id = NEW.id AND status = NEW.status;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_payment_event ON ecommerce_orders;
CREATE TRIGGER trg_orders_payment_event
    AFTER UPDATE OF payment_status ON ecommerce_orders
    FOR EACH ROW EXECUTE FUNCTION enqueue_order_payment_event();

-- awaiting_payment: إشعار + تقدّم عند الدفع (حسب سيناريو فراس: الدفعة قبل تأكيد المورد)
UPDATE ecommerce_workflow_stages SET automation_config = '{
  "enabled": true,
  "on_paid_advance_to": "supplier_preparing",
  "tasks": [{
    "task_type": "telegram", "recipient_type": "admin",
    "template_ar": "⏳ الطلب {order_number} بانتظار الدفعة\nالزبون: {customer_name} — {customer_phone}\nالمبلغ: {total} {currency}",
    "requires_confirmation": false
  }]
}'::jsonb
WHERE code = 'awaiting_payment' AND doc_type = 'ecom_order' AND store_id IS NULL;

-- ─── 6. Nova Poshta hook: تسليم/إرجاع الشحنة → الطلب + إشعار ───
CREATE OR REPLACE FUNCTION on_shipment_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    SELECT id, tenant_id, store_id, status, order_number INTO v_order
    FROM ecommerce_orders WHERE id = NEW.order_id;
    IF v_order.id IS NULL THEN RETURN NEW; END IF;

    IF NEW.status = 'delivered' THEN
        UPDATE ecommerce_orders
        SET status = 'delivered', delivered_at = now(),
            status_history = COALESCE(status_history, '[]'::jsonb) || jsonb_build_object(
                'from', v_order.status, 'to', 'delivered', 'status', 'delivered',
                'comment', 'أتمتة: نوفا بوشتا — استلم العميل', 'timestamp', now())
        WHERE id = v_order.id AND status IN ('shipped', 'processing', 'supplier_preparing');

        INSERT INTO ecommerce_agent_tasks
            (tenant_id, store_id, order_id, stage_code, task_type, recipient_type, recipient, payload, chain)
        VALUES
            (v_order.tenant_id, v_order.store_id, v_order.id, 'delivered', 'telegram', 'admin', '{}'::jsonb,
             jsonb_build_object('template_ar', '🎉 استلم العميل الطلب {order_number} (نوفا بوشتا). أُغلق الطلب تلقائياً.', 'requires_confirmation', false),
             jsonb_build_array(jsonb_build_object('channel', 'telegram', 'wait_minutes', 60)));

    ELSIF NEW.status = 'returned' THEN
        INSERT INTO ecommerce_agent_tasks
            (tenant_id, store_id, order_id, stage_code, task_type, recipient_type, recipient, payload, chain)
        VALUES
            (v_order.tenant_id, v_order.store_id, v_order.id, v_order.status, 'telegram', 'admin', '{}'::jsonb,
             jsonb_build_object('template_ar', '⚠️ الشحنة {order_number} أُرجعت من نوفا بوشتا — تدخّل مطلوب.', 'requires_confirmation', false),
             jsonb_build_array(jsonb_build_object('channel', 'telegram', 'wait_minutes', 60)));
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipment_status_agent ON ecommerce_shipments;
CREATE TRIGGER trg_shipment_status_agent
    AFTER UPDATE OF status ON ecommerce_shipments
    FOR EACH ROW EXECUTE FUNCTION on_shipment_status_change();
