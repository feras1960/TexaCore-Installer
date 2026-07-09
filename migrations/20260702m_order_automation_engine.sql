-- ═══════════════════════════════════════════════════════════════
-- Order Automation Engine — P1
--  1. ecommerce_agent_tasks: طابور مهام وكيل الاتصالات لكل محطة
--  2. automation_config على مراحل الورك فلو (إعدادات لكل محطة)
--  3. تريغر انتقال الحالة → توليد المهام تلقائياً
--  4. Seeds افتراضية (إشعار طلب جديد + حلقة المورد + شحن)
--  5. جدولة الـdispatcher عبر pg_cron + pg_net (كل دقيقة)
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Task queue ───
CREATE TABLE IF NOT EXISTS ecommerce_agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    order_id UUID REFERENCES ecommerce_orders(id) ON DELETE CASCADE,
    supplier_row_id UUID,                -- ecommerce_order_suppliers.id عند مهمة مورد
    stage_code TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK (task_type IN ('telegram', 'call', 'whatsapp')),
    recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'supplier', 'worker', 'admin')),
    recipient JSONB DEFAULT '{}',        -- {name, phone, email, chat_id}
    payload JSONB DEFAULT '{}',          -- {template_ar, template_uk, requires_confirmation, advance_to, ...}
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'sent', 'done', 'failed', 'timeout', 'cancelled', 'skipped')),
    result JSONB DEFAULT '{}',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    next_attempt_at TIMESTAMPTZ DEFAULT now(),
    timeout_at TIMESTAMPTZ,
    escalated BOOLEAN DEFAULT false,
    advance_to TEXT,                     -- كود المرحلة التالية عند التأكيد
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eat_status_next ON ecommerce_agent_tasks(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_eat_order ON ecommerce_agent_tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_eat_store_created ON ecommerce_agent_tasks(store_id, created_at DESC);

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS trg_eat_updated ON ecommerce_agent_tasks;
        CREATE TRIGGER trg_eat_updated BEFORE UPDATE ON ecommerce_agent_tasks
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

ALTER TABLE ecommerce_agent_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "eat_tenant_manage" ON ecommerce_agent_tasks;
CREATE POLICY "eat_tenant_manage" ON ecommerce_agent_tasks
    FOR ALL USING (is_platform_admin() OR tenant_id = get_user_tenant_id());
GRANT SELECT, INSERT, UPDATE ON ecommerce_agent_tasks TO authenticated;

-- ─── 2. Per-station automation settings ───
ALTER TABLE ecommerce_workflow_stages
    ADD COLUMN IF NOT EXISTS automation_config JSONB DEFAULT '{"enabled": false, "tasks": []}';

COMMENT ON COLUMN ecommerce_workflow_stages.automation_config IS
  '{"enabled":bool,"tasks":[{"task_type":"telegram|call|whatsapp","recipient_type":"customer|supplier|worker|admin","template_ar":"…","template_uk":"…","requires_confirmation":bool,"advance_to":"stage_code","timeout_minutes":int,"escalate":bool,"custom_chat_id":"…"}]} — المتغيرات: {order_number} {customer_name} {customer_phone} {total} {currency} {supplier_name} {stage}';

-- ─── 3. Trigger: order created / status changed → enqueue tasks ───
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
    v_timeout TIMESTAMPTZ;
    v_requires BOOLEAN;
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
        v_requires := COALESCE((v_task->>'requires_confirmation')::boolean, false);
        v_timeout := CASE WHEN v_requires AND (v_task->>'timeout_minutes') IS NOT NULL
                          THEN now() + ((v_task->>'timeout_minutes')::int || ' minutes')::interval
                          ELSE NULL END;

        IF v_task->>'recipient_type' = 'supplier' THEN
            -- مهمة لكل مورد مُسنَد للطلب لم يؤكد بعد
            FOR v_sup IN
                SELECT id, supplier_id, supplier_name, supplier_phone
                FROM ecommerce_order_suppliers
                WHERE order_id = NEW.id AND status IN ('pending')
            LOOP
                INSERT INTO ecommerce_agent_tasks
                    (tenant_id, store_id, order_id, supplier_row_id, stage_code, task_type,
                     recipient_type, recipient, payload, timeout_at, advance_to)
                VALUES
                    (NEW.tenant_id, NEW.store_id, NEW.id, v_sup.id, NEW.status, v_task->>'task_type',
                     'supplier',
                     jsonb_build_object('name', v_sup.supplier_name, 'phone', v_sup.supplier_phone, 'supplier_id', v_sup.supplier_id),
                     v_task, v_timeout,
                     v_task->>'advance_to');
            END LOOP;
        ELSE
            INSERT INTO ecommerce_agent_tasks
                (tenant_id, store_id, order_id, stage_code, task_type,
                 recipient_type, recipient, payload, timeout_at, advance_to)
            VALUES
                (NEW.tenant_id, NEW.store_id, NEW.id, NEW.status, v_task->>'task_type',
                 v_task->>'recipient_type',
                 CASE v_task->>'recipient_type'
                     WHEN 'customer' THEN jsonb_build_object('name', NEW.customer_name, 'phone', NEW.customer_phone, 'email', NEW.customer_email)
                     ELSE COALESCE(jsonb_build_object('chat_id', v_task->>'custom_chat_id'), '{}'::jsonb)
                 END,
                 v_task, v_timeout,
                 v_task->>'advance_to');
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_agent_tasks ON ecommerce_orders;
CREATE TRIGGER trg_orders_agent_tasks
    AFTER INSERT OR UPDATE OF status ON ecommerce_orders
    FOR EACH ROW EXECUTE FUNCTION enqueue_order_agent_tasks();

-- ─── 4. Default seeds on the global stages (store_id IS NULL) ───
-- pending: إشعار فوري للإدارة بطلب جديد + أزرار تأكيد/إلغاء (تأكيد → confirmed)
UPDATE ecommerce_workflow_stages SET automation_config = '{
  "enabled": true,
  "tasks": [{
    "task_type": "telegram", "recipient_type": "admin",
    "template_ar": "🛒 طلب جديد {order_number}\nالزبون: {customer_name} — {customer_phone}\nالإجمالي: {total} {currency}\n\nأكّد الطلب أو ألغه:",
    "template_uk": "🛒 Нове замовлення {order_number}\nКлієнт: {customer_name} — {customer_phone}\nСума: {total} {currency}",
    "requires_confirmation": true, "advance_to": "confirmed",
    "timeout_minutes": 180, "escalate": true
  }]
}'::jsonb
WHERE code = 'pending' AND doc_type = 'ecom_order' AND store_id IS NULL;

-- supplier_preparing: تأكيد المورد (لكل مورد مُسنَد) → processing، مع تصعيد
UPDATE ecommerce_workflow_stages SET automation_config = '{
  "enabled": true,
  "tasks": [{
    "task_type": "telegram", "recipient_type": "supplier",
    "template_ar": "📦 حجز جديد {order_number}\nالمورد: {supplier_name}\nالرجاء تأكيد توفر الكمية للطلب.\nالإجمالي: {total} {currency}",
    "template_uk": "📦 Нове бронювання {order_number}\nПостачальник: {supplier_name}\nПідтвердіть наявність.",
    "requires_confirmation": true, "advance_to": "processing",
    "timeout_minutes": 240, "escalate": true
  }]
}'::jsonb
WHERE code = 'supplier_preparing' AND doc_type = 'ecom_order' AND store_id IS NULL;

-- confirmed: مهمة تواصل مع الزبون (شبه-آلية اليوم: بطاقة للإدارة بأزرار «تواصلت وأكّد» → supplier_preparing)
UPDATE ecommerce_workflow_stages SET automation_config = '{
  "enabled": true,
  "tasks": [{
    "task_type": "telegram", "recipient_type": "admin",
    "template_ar": "☎️ تأكيد مع الزبون — {order_number}\n{customer_name} — {customer_phone}\nتواصل مع الزبون لتأكيد التفاصيل ثم اضغط تم:",
    "requires_confirmation": true, "advance_to": "supplier_preparing",
    "timeout_minutes": 240, "escalate": true
  }]
}'::jsonb
WHERE code = 'confirmed' AND doc_type = 'ecom_order' AND store_id IS NULL;

-- shipped: إشعار (بلا تأكيد)
UPDATE ecommerce_workflow_stages SET automation_config = '{
  "enabled": true,
  "tasks": [{
    "task_type": "telegram", "recipient_type": "admin",
    "template_ar": "🚚 شُحن الطلب {order_number} — {customer_name}.",
    "requires_confirmation": false
  }]
}'::jsonb
WHERE code = 'shipped' AND doc_type = 'ecom_order' AND store_id IS NULL;

-- ─── 5. Schedule the dispatcher (pg_cron + pg_net, نفس نمط sync-uah-rate) ───
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('order-agent-dispatcher')
        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'order-agent-dispatcher');

        -- نفس نمط sync-uah-rate: مفتاح anon العلني للمرور عبر verify_jwt
        PERFORM cron.schedule(
            'order-agent-dispatcher',
            '* * * * *',
            $cron$
            SELECT net.http_post(
                url := 'https://wzkklenfsaepegymfxfz.supabase.co/functions/v1/order-agent-dispatcher',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2tsZW5mc2FlcGVneW1meGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTIxNzcsImV4cCI6MjA4NDMyODE3N30.ATYSK_WvOfbqEaInbg5nKau-wgixF0lIGaue3m8AJtI',
                    'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2tsZW5mc2FlcGVneW1meGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTIxNzcsImV4cCI6MjA4NDMyODE3N30.ATYSK_WvOfbqEaInbg5nKau-wgixF0lIGaue3m8AJtI'
                ),
                body := '{}'::jsonb,
                timeout_milliseconds := 30000
            );
            $cron$
        );
    END IF;
END $$;
