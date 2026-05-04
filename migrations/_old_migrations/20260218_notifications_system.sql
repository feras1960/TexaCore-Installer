-- ═══════════════════════════════════════════════════════════════
-- 🔔 NOTIFICATIONS SYSTEM — COMPLETE MIGRATION
-- Feb 18, 2026
-- 
-- ✅ EXECUTED SUCCESSFULLY on 2026-02-18
-- 
-- What this migration does:
-- 0. Add new columns to containers table (warehouse + notification_rules)
-- 1. Create notifications table with proper schema
-- 2. Create trigger on containers for status change → auto-notifications
-- 3. Create helper functions (mark as read)
-- 4. Enable realtime for live notification delivery
-- ═══════════════════════════════════════════════════════════════

-- ─── 0. New columns for containers ─────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        EXECUTE 'ALTER TABLE containers ADD COLUMN IF NOT EXISTS receiving_warehouse_id UUID REFERENCES warehouses(id)';
        EXECUTE 'ALTER TABLE containers ADD COLUMN IF NOT EXISTS warehouse_keeper_id UUID';
        EXECUTE 'ALTER TABLE containers ADD COLUMN IF NOT EXISTS receiving_notes TEXT';
        EXECUTE 'ALTER TABLE containers ADD COLUMN IF NOT EXISTS notification_rules JSONB DEFAULT ''[]''';
    END IF;
END $$;

-- ─── 1. Notifications Table ─────────────────────────────────
DROP TABLE IF EXISTS notifications CASCADE;

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
    source_type TEXT,
    source_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_tenant ON notifications(tenant_id, created_at DESC);
CREATE INDEX idx_notifications_source ON notifications(source_type, source_id);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON notifications
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON notifications
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "notifications_insert_system" ON notifications
    FOR INSERT WITH CHECK (
        tenant_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
    );

CREATE POLICY "notifications_delete_own" ON notifications
    FOR DELETE USING (user_id = auth.uid());

-- Realtime
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    ELSE
        RAISE NOTICE 'publication "supabase_realtime" does not exist, skipping Realtime setup';
    END IF;
END $$;

-- ─── 2. Container Status Change Trigger ──────────────────────
CREATE OR REPLACE FUNCTION fn_container_status_notification()
RETURNS TRIGGER AS $$
DECLARE
    rule JSONB;
    rule_user_id UUID;
    rule_trigger TEXT;
    rule_enabled BOOLEAN;
    rule_role TEXT;
    v_container_name TEXT;
    v_container_number TEXT;
    new_status_label_ar TEXT;
    new_status_label_en TEXT;
    notification_title_ar TEXT;
    notification_title_en TEXT;
    notification_body_ar TEXT;
    notification_body_en TEXT;
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
    IF NEW.notification_rules IS NULL OR NEW.notification_rules = '[]'::JSONB OR jsonb_array_length(NEW.notification_rules) = 0 THEN RETURN NEW; END IF;
    
    v_container_number := COALESCE(NEW.container_number, NEW.shipment_number, 'N/A');
    v_container_name := COALESCE(NEW.container_name, v_container_number);
    
    new_status_label_ar := CASE NEW.status
        WHEN 'draft' THEN 'مسودة' WHEN 'booked' THEN 'تم الحجز' WHEN 'loading' THEN 'جاري التحميل'
        WHEN 'in_transit' THEN 'بالبحر' WHEN 'at_port' THEN 'وصل الميناء' WHEN 'customs' THEN 'بالجمركة'
        WHEN 'cleared' THEN 'تم التخليص' WHEN 'delivered' THEN 'تم التسليم' WHEN 'received' THEN 'تم الاستلام'
        ELSE NEW.status END;
    
    new_status_label_en := CASE NEW.status
        WHEN 'draft' THEN 'Draft' WHEN 'booked' THEN 'Booked' WHEN 'loading' THEN 'Loading'
        WHEN 'in_transit' THEN 'In Transit' WHEN 'at_port' THEN 'At Port' WHEN 'customs' THEN 'At Customs'
        WHEN 'cleared' THEN 'Cleared' WHEN 'delivered' THEN 'Delivered' WHEN 'received' THEN 'Received'
        ELSE NEW.status END;
    
    FOR rule IN SELECT jsonb_array_elements(NEW.notification_rules)
    LOOP
        rule_enabled := COALESCE((rule ->> 'enabled')::BOOLEAN, false);
        rule_trigger := rule ->> 'trigger_status';
        rule_user_id := (rule ->> 'user_id')::UUID;
        rule_role := COALESCE(rule ->> 'role', 'unknown');
        
        IF NOT rule_enabled THEN CONTINUE; END IF;
        IF rule_trigger IS NULL OR rule_trigger != NEW.status THEN CONTINUE; END IF;
        IF rule_user_id IS NULL THEN CONTINUE; END IF;
        
        notification_title_ar := 'كونتينر ' || v_container_number || ' — ' || new_status_label_ar;
        notification_title_en := 'Container ' || v_container_number || ' — ' || new_status_label_en;
        
        IF rule_role = 'warehouse' THEN
            notification_body_ar := 'الكونتينر "' || v_container_name || '" أصبح جاهزاً للاستلام في المستودع';
            notification_body_en := 'Container "' || v_container_name || '" is ready for warehouse receiving';
        ELSIF rule_role = 'sales' THEN
            notification_body_ar := 'الكونتينر "' || v_container_name || '" وصل للحالة: ' || new_status_label_ar;
            notification_body_en := 'Container "' || v_container_name || '" reached status: ' || new_status_label_en;
        ELSE
            notification_body_ar := 'حالة الكونتينر تغيرت إلى: ' || new_status_label_ar;
            notification_body_en := 'Container status changed to: ' || new_status_label_en;
        END IF;
        
        INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
        VALUES (
            NEW.company_id, rule_user_id,
            notification_title_ar || ' | ' || notification_title_en,
            notification_body_ar || ' | ' || notification_body_en,
            CASE WHEN NEW.status IN ('cleared','received','delivered') THEN 'success'
                 WHEN NEW.status = 'customs' THEN 'warning' ELSE 'info' END,
            'container', NEW.id,
            jsonb_build_object(
                'container_number', v_container_number, 'container_name', v_container_name,
                'old_status', OLD.status, 'new_status', NEW.status, 'role', rule_role,
                'status_label_ar', new_status_label_ar, 'status_label_en', new_status_label_en
            )
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_container_status_notification ON containers';
        EXECUTE '
        CREATE TRIGGER trg_container_status_notification
            AFTER UPDATE OF status ON containers
            FOR EACH ROW EXECUTE FUNCTION fn_container_status_notification();';
    END IF;
END $$;

-- ─── 3. Helper Functions ─────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_mark_notifications_read(notification_ids UUID[])
RETURNS INTEGER AS $$
DECLARE affected INTEGER;
BEGIN
    UPDATE notifications SET is_read = true, read_at = now(), updated_at = now()
    WHERE id = ANY(notification_ids) AND user_id = auth.uid() AND is_read = false;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_mark_all_notifications_read()
RETURNS INTEGER AS $$
DECLARE affected INTEGER;
BEGIN
    UPDATE notifications SET is_read = true, read_at = now(), updated_at = now()
    WHERE user_id = auth.uid() AND is_read = false;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══ DONE ═══
