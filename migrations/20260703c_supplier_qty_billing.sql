-- ═══════════════════════════════════════════════════════════════
-- الفوترة على الكمية المحمّلة (مسار البوت)
-- apply_supplier_loaded_qty: صف المورد مربوط ببند محدد
-- (ecommerce_order_suppliers.order_item_id NOT NULL) — نحدّث كمية
-- المورد، نزامن fulfilled_quantity لبنده، ونعيد حساب total_amount
-- للطلب كله (نفس منطق fulfillmentService.recalculateOrderTotals:
-- Σ(fulfilled>0 ? fulfilled : quantity) × unit_price).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_supplier_loaded_qty(
    p_supplier_row_id UUID,
    p_qty NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row RECORD;
    v_original NUMERIC := 0;
    v_actual NUMERIC := 0;
BEGIN
    SELECT * INTO v_row FROM ecommerce_order_suppliers WHERE id = p_supplier_row_id;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'supplier_row_not_found');
    END IF;

    UPDATE ecommerce_order_suppliers
    SET fulfilled_quantity = p_qty, status = 'confirmed', confirmed_at = now()
    WHERE id = p_supplier_row_id;

    -- زامن بند المورد نفسه (الربط المباشر order_item_id)
    IF v_row.order_item_id IS NOT NULL THEN
        UPDATE ecommerce_order_items SET fulfilled_quantity = p_qty
        WHERE id = v_row.order_item_id;
    END IF;

    -- أعد حساب فاتورة الطلب على الكميات الفعلية
    SELECT
        COALESCE(SUM(quantity * unit_price), 0),
        COALESCE(SUM((CASE WHEN COALESCE(fulfilled_quantity, 0) > 0 THEN fulfilled_quantity ELSE quantity END) * unit_price), 0)
    INTO v_original, v_actual
    FROM ecommerce_order_items WHERE order_id = v_row.order_id;

    UPDATE ecommerce_orders SET total_amount = v_actual, updated_at = now()
    WHERE id = v_row.order_id;

    RETURN jsonb_build_object(
        'ok', true,
        'needs_allocation', v_row.order_item_id IS NULL,
        'ordered_qty', v_row.quantity, 'loaded_qty', p_qty,
        'original_total', v_original, 'billed_total', v_actual);
END;
$$;

REVOKE ALL ON FUNCTION apply_supplier_loaded_qty(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_supplier_loaded_qty(UUID, NUMERIC) TO service_role, authenticated;
