-- ════════════════════════════════════════════════════════════════
-- 🔔 إشعارات المناقلات — Transfer Notifications System
-- تنفيذ في Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ═══ 1. إضافة أمين المستودع (manager_id) لجدول المستودعات ═══
ALTER TABLE warehouses 
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN warehouses.manager_id IS 'أمين المستودع — المسؤول الذي يستلم الإشعارات';

-- ═══ 2. Trigger Function: إشعارات المناقلات ═══
CREATE OR REPLACE FUNCTION fn_transfer_status_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_transfer_number TEXT;
    v_from_wh_name TEXT;
    v_to_wh_name TEXT;
    v_from_keeper UUID;
    v_to_keeper UUID;
    v_creator UUID;
    v_title TEXT;
    v_body TEXT;
    v_type TEXT;
    v_target_user UUID;
    v_driver_info TEXT;
    v_tracking TEXT;
BEGIN
    -- Skip if status didn't change
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN 
        RETURN NEW; 
    END IF;

    -- Get transfer info
    v_transfer_number := COALESCE(NEW.transfer_number, NEW.id::TEXT);
    v_creator := NEW.created_by;

    -- Get warehouse names and managers
    SELECT COALESCE(name_ar, name_en, 'مستودع'), manager_id
    INTO v_from_wh_name, v_from_keeper
    FROM warehouses WHERE id = NEW.from_warehouse_id;

    SELECT COALESCE(name_ar, name_en, 'مستودع'), manager_id
    INTO v_to_wh_name, v_to_keeper
    FROM warehouses WHERE id = NEW.to_warehouse_id;

    -- Build driver/shipping info for shipped notifications
    v_driver_info := '';
    v_tracking := '';
    IF NEW.status = 'shipped' THEN
        IF NEW.shipping_method = 'company_driver' AND NEW.driver_name IS NOT NULL THEN
            v_driver_info := ' | السائق: ' || NEW.driver_name;
            IF NEW.vehicle_number IS NOT NULL THEN
                v_driver_info := v_driver_info || ' (' || NEW.vehicle_number || ')';
            END IF;
        ELSIF NEW.shipping_method = 'external_truck' AND NEW.driver_name IS NOT NULL THEN
            v_driver_info := ' | سائق خارجي: ' || NEW.driver_name;
        ELSIF NEW.shipping_method = 'shipping_company' AND NEW.shipping_carrier IS NOT NULL THEN
            v_driver_info := ' | شركة شحن: ' || NEW.shipping_carrier;
        END IF;
        IF NEW.tracking_number IS NOT NULL THEN
            v_tracking := ' | رقم التتبع: ' || NEW.tracking_number;
        END IF;
    END IF;

    -- ════════════════════════════════════════
    -- إشعار 1: تأكيد المناقلة → أمين المستودع المصدر
    -- ════════════════════════════════════════
    IF NEW.status = 'confirmed' AND v_from_keeper IS NOT NULL THEN
        v_title := '📋 مناقلة جديدة — ' || v_transfer_number;
        v_body := 'طلب مناقلة من ' || v_from_wh_name || ' إلى ' || v_to_wh_name 
                  || ' — الرجاء تجهيز البضاعة وبدء التحميل';
        
        INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
        VALUES (
            NEW.tenant_id, v_from_keeper, v_title, v_body, 'info',
            'stock_transfer', NEW.id,
            jsonb_build_object(
                'transfer_number', v_transfer_number,
                'from_warehouse', v_from_wh_name,
                'to_warehouse', v_to_wh_name,
                'status', 'confirmed',
                'action', 'prepare_and_load'
            )
        );
    END IF;

    -- ════════════════════════════════════════
    -- إشعار 2: الشحن → أمين المستودع الوجهة
    -- ════════════════════════════════════════
    IF NEW.status = 'shipped' AND v_to_keeper IS NOT NULL THEN
        v_title := '🚚 شحنة في الطريق — ' || v_transfer_number;
        v_body := 'تم شحن بضاعة من ' || v_from_wh_name || ' إلى ' || v_to_wh_name 
                  || ' — الرجاء الاستعداد للاستلام'
                  || v_driver_info || v_tracking;
        
        INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
        VALUES (
            NEW.tenant_id, v_to_keeper, v_title, v_body, 'warning',
            'stock_transfer', NEW.id,
            jsonb_build_object(
                'transfer_number', v_transfer_number,
                'from_warehouse', v_from_wh_name,
                'to_warehouse', v_to_wh_name,
                'status', 'shipped',
                'action', 'receive_goods',
                'shipping_method', NEW.shipping_method,
                'driver_name', NEW.driver_name,
                'vehicle_number', NEW.vehicle_number,
                'tracking_number', NEW.tracking_number,
                'shipping_carrier', NEW.shipping_carrier,
                'shipped_at', NEW.shipped_at
            )
        );
    END IF;

    -- ════════════════════════════════════════
    -- إشعار 3: الاستلام → مُنشئ المناقلة
    -- ════════════════════════════════════════
    IF NEW.status IN ('received', 'completed') AND v_creator IS NOT NULL THEN
        v_title := '✅ مناقلة مكتملة — ' || v_transfer_number;
        v_body := 'تم استلام المناقلة من ' || v_from_wh_name || ' في ' || v_to_wh_name
                  || ' — المناقلة مكتملة بنجاح';
        
        INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
        VALUES (
            NEW.tenant_id, v_creator, v_title, v_body, 'success',
            'stock_transfer', NEW.id,
            jsonb_build_object(
                'transfer_number', v_transfer_number,
                'from_warehouse', v_from_wh_name,
                'to_warehouse', v_to_wh_name,
                'status', NEW.status,
                'action', 'completed',
                'received_at', NEW.received_at
            )
        );
    END IF;

    -- ════════════════════════════════════════
    -- إشعار 4: الإلغاء → مُنشئ المناقلة (إذا لم يكن هو من ألغى)
    -- ════════════════════════════════════════
    IF NEW.status = 'cancelled' AND v_creator IS NOT NULL THEN
        v_title := '❌ مناقلة ملغاة — ' || v_transfer_number;
        v_body := 'تم إلغاء المناقلة من ' || v_from_wh_name || ' إلى ' || v_to_wh_name;
        
        INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
        VALUES (
            NEW.tenant_id, v_creator, v_title, v_body, 'error',
            'stock_transfer', NEW.id,
            jsonb_build_object(
                'transfer_number', v_transfer_number,
                'from_warehouse', v_from_wh_name,
                'to_warehouse', v_to_wh_name,
                'status', 'cancelled',
                'action', 'cancelled'
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══ 3. Create Trigger ═══
DROP TRIGGER IF EXISTS trg_transfer_status_notification ON stock_transfers;
CREATE TRIGGER trg_transfer_status_notification
    AFTER UPDATE OF status ON stock_transfers
    FOR EACH ROW EXECUTE FUNCTION fn_transfer_status_notification();

-- ═══ 4. التحقق ═══
SELECT 
    tgname AS trigger_name,
    tgtype,
    proname AS function_name
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgrelid = 'stock_transfers'::regclass
  AND tgname = 'trg_transfer_status_notification';
