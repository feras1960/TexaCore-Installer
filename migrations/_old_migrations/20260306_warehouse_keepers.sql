-- ════════════════════════════════════════════════════════════════
-- 👥 أمناء المستودعات — Warehouse Keepers (M:N)
-- يدعم أكثر من أمين لكل مستودع
-- ════════════════════════════════════════════════════════════════

-- ═══ 1. جدول الربط ═══
CREATE TABLE IF NOT EXISTS warehouse_keepers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'keeper' CHECK (role IN ('keeper', 'manager', 'assistant')),
    is_primary BOOLEAN DEFAULT false,
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (warehouse_id, user_id)
);

CREATE INDEX idx_warehouse_keepers_wh ON warehouse_keepers(warehouse_id);
CREATE INDEX idx_warehouse_keepers_user ON warehouse_keepers(user_id);
CREATE INDEX idx_warehouse_keepers_tenant ON warehouse_keepers(tenant_id);

-- ═══ 2. RLS ═══
ALTER TABLE warehouse_keepers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wk_tenant_select" ON warehouse_keepers
    FOR SELECT USING (
        tenant_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
    );

CREATE POLICY "wk_tenant_insert" ON warehouse_keepers
    FOR INSERT WITH CHECK (
        tenant_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
    );

CREATE POLICY "wk_tenant_update" ON warehouse_keepers
    FOR UPDATE USING (
        tenant_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
    );

CREATE POLICY "wk_tenant_delete" ON warehouse_keepers
    FOR DELETE USING (
        tenant_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())
    );

-- ═══ 3. تحديث trigger الإشعارات لاستخدام warehouse_keepers ═══
CREATE OR REPLACE FUNCTION fn_transfer_status_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_transfer_number TEXT;
    v_from_wh_name TEXT;
    v_to_wh_name TEXT;
    v_creator UUID;
    v_title TEXT;
    v_body TEXT;
    v_driver_info TEXT;
    v_tracking TEXT;
    v_keeper RECORD;
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

    v_transfer_number := COALESCE(NEW.transfer_number, NEW.id::TEXT);
    v_creator := NEW.created_by;

    SELECT COALESCE(name_ar, name_en, 'مستودع') INTO v_from_wh_name
    FROM warehouses WHERE id = NEW.from_warehouse_id;

    SELECT COALESCE(name_ar, name_en, 'مستودع') INTO v_to_wh_name
    FROM warehouses WHERE id = NEW.to_warehouse_id;

    -- Build shipping info
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

    -- ══════════════════════════════════════════════════
    -- 1. confirmed → إشعار لكل أمناء المستودع المصدر
    -- ══════════════════════════════════════════════════
    IF NEW.status = 'confirmed' THEN
        FOR v_keeper IN
            SELECT user_id FROM warehouse_keepers 
            WHERE warehouse_id = NEW.from_warehouse_id
        LOOP
            INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
            VALUES (
                NEW.tenant_id, v_keeper.user_id,
                '📋 مناقلة جديدة — ' || v_transfer_number,
                'طلب مناقلة من ' || v_from_wh_name || ' إلى ' || v_to_wh_name || ' — الرجاء تجهيز البضاعة وبدء التحميل',
                'info', 'stock_transfer', NEW.id,
                jsonb_build_object(
                    'transfer_number', v_transfer_number,
                    'from_warehouse', v_from_wh_name,
                    'to_warehouse', v_to_wh_name,
                    'status', 'confirmed',
                    'action', 'prepare_and_load'
                )
            );
        END LOOP;
    END IF;

    -- ══════════════════════════════════════════════════
    -- 2. shipped → إشعار لكل أمناء المستودع الوجهة
    -- ══════════════════════════════════════════════════
    IF NEW.status = 'shipped' THEN
        FOR v_keeper IN
            SELECT user_id FROM warehouse_keepers 
            WHERE warehouse_id = NEW.to_warehouse_id
        LOOP
            INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
            VALUES (
                NEW.tenant_id, v_keeper.user_id,
                '🚚 شحنة في الطريق — ' || v_transfer_number,
                'تم شحن بضاعة من ' || v_from_wh_name || ' إلى ' || v_to_wh_name 
                    || ' — الرجاء الاستعداد للاستلام' || v_driver_info || v_tracking,
                'warning', 'stock_transfer', NEW.id,
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
                    'shipping_carrier', NEW.shipping_carrier
                )
            );
        END LOOP;
    END IF;

    -- ══════════════════════════════════════════════════
    -- 3. received/completed → إشعار لمُنشئ المناقلة
    -- ══════════════════════════════════════════════════
    IF NEW.status IN ('received', 'completed') AND v_creator IS NOT NULL THEN
        INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
        VALUES (
            NEW.tenant_id, v_creator,
            '✅ مناقلة مكتملة — ' || v_transfer_number,
            'تم استلام المناقلة من ' || v_from_wh_name || ' في ' || v_to_wh_name || ' — المناقلة مكتملة بنجاح',
            'success', 'stock_transfer', NEW.id,
            jsonb_build_object(
                'transfer_number', v_transfer_number,
                'from_warehouse', v_from_wh_name,
                'to_warehouse', v_to_wh_name,
                'status', NEW.status,
                'action', 'completed'
            )
        );
    END IF;

    -- ══════════════════════════════════════════════════
    -- 4. cancelled → إشعار لمُنشئ المناقلة
    -- ══════════════════════════════════════════════════
    IF NEW.status = 'cancelled' AND v_creator IS NOT NULL THEN
        INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
        VALUES (
            NEW.tenant_id, v_creator,
            '❌ مناقلة ملغاة — ' || v_transfer_number,
            'تم إلغاء المناقلة من ' || v_from_wh_name || ' إلى ' || v_to_wh_name,
            'error', 'stock_transfer', NEW.id,
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

-- ═══ 4. Migrate existing manager_id data if any ═══
INSERT INTO warehouse_keepers (warehouse_id, user_id, role, is_primary, tenant_id)
SELECT id, manager_id, 'keeper', true, tenant_id
FROM warehouses 
WHERE manager_id IS NOT NULL
ON CONFLICT (warehouse_id, user_id) DO NOTHING;

-- ═══ DONE ═══
SELECT 'warehouse_keepers table created + trigger updated' AS result;
