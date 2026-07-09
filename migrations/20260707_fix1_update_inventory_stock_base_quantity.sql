-- ═══════════════════════════════════════════════════════════════════════════
-- إصلاح 1 — update_inventory_stock يتجاهل base_quantity
-- ─────────────────────────────────────────────────────────────────────────────
-- المشكلة: التريغر كان يخصم/يضيف NEW.quantity (كمية وحدة المعاملة) بينما
--          calculate_base_quantity_trigger يحسب base_quantity = quantity × factor
--          ثم يُهمَل. أول حركة بوحدة بديلة (factor≠1) تُفسد الرصيد والتكلفة.
--
-- الحل: الكمية الموحّدة = COALESCE(NEW.base_quantity, NEW.quantity) [وحدة الأساس].
--       التكلفة الإجمالية ثابتة أياً كانت الوحدة: total = quantity × unit_cost.
--       تكلفة الوحدة الأساس = total / base_quantity.
--
-- توافق البيانات الحالية: base_quantity = quantity (factor=1) ⇒ النتيجة مطابقة
--       حرفياً (v_qty=quantity، v_total_cost/v_qty = unit_cost).
--
-- ترتيب التريغرات: trg_calculate_base_quantity (c) قبل trg_update_inventory_stock (u)
--       أبجدياً ⇒ NEW.base_quantity مضبوطة قبل تشغيل هذه الدالة.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_inventory_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_current_qty   DECIMAL(15,3);
    v_current_cost  DECIMAL(15,4);
    v_new_avg_cost  DECIMAL(15,4);
    v_warehouse_id  UUID;
    v_target_id     UUID;
    v_mt            TEXT;
    v_is_in         BOOLEAN;
    v_is_out        BOOLEAN;
    v_new_qty       DECIMAL(15,3);
    v_allow_negative BOOLEAN := false;
    -- [إصلاح 1] الكمية بوحدة الأساس (المصدر الموحّد) والتكلفة المشتقّة
    v_qty           DECIMAL(15,3);   -- الكمية بوحدة الأساس
    v_base_unit_cost DECIMAL(15,4);  -- تكلفة الوحدة الأساس = total / base_qty
BEGIN
    v_mt := lower(COALESCE(NEW.movement_type, ''));
    -- [4A] مفردات موحّدة (تشمل الأنواع التي كانت تُهمَل)
    v_is_in  := v_mt IN ('receipt','purchase','return_in','adjustment_in','transfer_in','container_receipt','purchase_receipt');
    v_is_out := v_mt IN ('sale','issue','return_out','adjustment_out','transfer_out','sales_delivery','out');

    -- أنواع غير معروفة: سجل فقط، بلا أثر على الرصيد
    IF NOT (v_is_in OR v_is_out) THEN
        RETURN NEW;
    END IF;

    -- [إصلاح 1] الكمية الموحّدة بوحدة الأساس + التكلفة المشتقّة
    -- للبيانات القديمة (base_quantity=quantity، factor=1): v_qty=quantity حرفياً.
    v_qty := COALESCE(NEW.base_quantity, NEW.quantity);
    -- تكلفة الوحدة الأساس تُحفظ القيمة الإجمالية: (quantity × unit_cost) / base_quantity.
    -- المصدر القديم لتكلفة الوارد كان COALESCE(NEW.unit_cost, v_current_cost, 0)؛
    -- نبقيه احتياطاً حين تكون unit_cost فارغة (NULL) لمطابقة السلوك السابق حرفياً.
    -- ملاحظة: unit_cost=0 صريحة تبقى 0 (لا تسقط على v_current_cost) — كالسابق.
    IF NEW.unit_cost IS NULL THEN
        v_base_unit_cost := COALESCE(v_current_cost, 0);   -- كـ COALESCE(NULL, v_current_cost, 0)
    ELSIF COALESCE(v_qty, 0) <> 0 THEN
        v_base_unit_cost := (NEW.quantity * NEW.unit_cost) / v_qty;
    ELSE
        v_base_unit_cost := NEW.unit_cost;
    END IF;

    -- [4A] اتجاه المستودع حسب نوع الحركة
    IF v_is_out THEN
        v_warehouse_id := COALESCE(NEW.from_warehouse_id, NEW.to_warehouse_id);
    ELSE
        v_warehouse_id := COALESCE(NEW.to_warehouse_id, NEW.from_warehouse_id);
    END IF;

    v_target_id := COALESCE(NEW.material_id, NEW.product_id);

    -- الرصيد الحالي
    SELECT quantity_on_hand, average_cost
    INTO v_current_qty, v_current_cost
    FROM inventory_stock
    WHERE ((material_id IS NOT NULL AND material_id = v_target_id)
        OR (product_id  IS NOT NULL AND product_id  = v_target_id))
      AND warehouse_id = v_warehouse_id
    LIMIT 1;
    IF NOT FOUND THEN
        v_current_qty := 0;
        v_current_cost := 0;
    END IF;

    -- ═══ الإضافة (IN) — متوسط مرجّح (بوحدة الأساس) ═══
    IF v_is_in THEN
        IF (v_current_qty + v_qty) > 0 THEN
            -- القيمة الإجمالية للمخزون الحالي + القيمة الإجمالية للوارد ÷ الكمية الكلية بالأساس
            -- (v_qty × v_base_unit_cost) = القيمة الإجمالية للوارد = NEW.quantity × NEW.unit_cost.
            v_new_avg_cost := ((v_current_qty * v_current_cost)
                               + (v_qty * v_base_unit_cost))
                              / (v_current_qty + v_qty);
        ELSE
            v_new_avg_cost := v_base_unit_cost;
        END IF;

        UPDATE inventory_stock
        SET quantity_on_hand = quantity_on_hand + v_qty,
            average_cost = v_new_avg_cost,
            last_cost = CASE WHEN NEW.unit_cost IS NULL THEN inventory_stock.last_cost
                             ELSE v_base_unit_cost END,
            last_movement_date = NOW(),
            updated_at = NOW()
        WHERE ((material_id IS NOT NULL AND material_id = v_target_id)
            OR (product_id  IS NOT NULL AND product_id  = v_target_id))
          AND warehouse_id = v_warehouse_id;

        IF NOT FOUND THEN
            INSERT INTO inventory_stock (
                tenant_id, company_id, product_id, material_id, warehouse_id,
                quantity_on_hand, average_cost, last_cost, last_movement_date, batch_number
            ) VALUES (
                NEW.tenant_id, NEW.company_id, NEW.product_id, NEW.material_id, v_warehouse_id,
                v_qty, v_new_avg_cost, COALESCE(v_base_unit_cost, 0), NOW(), 'N/A'
            );
        END IF;

        NEW.balance_before := v_current_qty;
        NEW.balance_after  := v_current_qty + v_qty;

    -- ═══ الصرف (OUT) — مع حارس السالب ═══
    ELSE
        v_new_qty := v_current_qty - v_qty;

        IF v_new_qty < 0 THEN
            -- هل تسمح المادة بالرصيد السالب؟
            IF NEW.material_id IS NOT NULL THEN
                SELECT COALESCE(allow_negative_stock, false) INTO v_allow_negative
                FROM fabric_materials WHERE id = NEW.material_id;
            END IF;
            IF NOT COALESCE(v_allow_negative, false) THEN
                RAISE EXCEPTION 'الكمية غير كافية في المستودع: المتاح %، المطلوب % (المادة/المنتج %، المستودع %)',
                    v_current_qty, v_qty, v_target_id, v_warehouse_id
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        UPDATE inventory_stock
        SET quantity_on_hand = quantity_on_hand - v_qty,
            last_movement_date = NOW(),
            updated_at = NOW()
        WHERE ((material_id IS NOT NULL AND material_id = v_target_id)
            OR (product_id  IS NOT NULL AND product_id  = v_target_id))
          AND warehouse_id = v_warehouse_id;

        -- لا صف؟ أنشئه (لئلا يُفقَد الخصم) — يبقى inventory_stock = Σ الحركات
        IF NOT FOUND THEN
            INSERT INTO inventory_stock (
                tenant_id, company_id, product_id, material_id, warehouse_id,
                quantity_on_hand, average_cost, last_cost, last_movement_date, batch_number
            ) VALUES (
                NEW.tenant_id, NEW.company_id, NEW.product_id, NEW.material_id, v_warehouse_id,
                -v_qty, COALESCE(v_current_cost, 0), COALESCE(v_base_unit_cost, 0), NOW(), 'N/A'
            );
        END IF;

        NEW.balance_before := v_current_qty;
        NEW.balance_after  := v_new_qty;
    END IF;

    RETURN NEW;
END;
$function$;
