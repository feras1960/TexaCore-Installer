-- ═══════════════════════════════════════════════════════════════════════════
-- P3 (safe layer) — guarded, dimension-validated unit conversion
-- ═══════════════════════════════════════════════════════════════════════════
-- A NEW function `uom_convert` — it does NOT touch any purchase/sales/inventory
-- flow. It is the reusable primitive those flows will later call (a separate,
-- reviewed step). It fixes the two gaps in the existing convert_material_quantity:
--   1) NO dimensional guard — it never checks the two units share a category.
--   2) NO global fallback — if a material has no explicit conversion row it
--      returns NULL even for standard pairs (meter↔yard, kg↔lb).
--
-- uom_convert resolves in this order:
--   identity → per-material override (variable units: carton/pallet/roll…) →
--   per-material reverse → global units_of_measure factor.
-- Cross-category conversions are REJECTED with a clear Arabic message.
-- Returns jsonb {ok, converted, factor, category, source, error?}.
-- The old convert_material_quantity is left untouched (backward compatible).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.uom_convert(
  p_from_unit_id uuid,
  p_to_unit_id uuid,
  p_quantity numeric,
  p_material_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  f_cat text; f_factor numeric; f_code text;
  t_cat text; t_factor numeric; t_code text;
  v_factor numeric; v_weight numeric; v_volume numeric;
BEGIN
  IF p_from_unit_id IS NULL OR p_to_unit_id IS NULL OR p_quantity IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مدخلات ناقصة (وحدة أو كمية غير محدّدة)');
  END IF;

  SELECT category, conversion_factor, code INTO f_cat, f_factor, f_code
  FROM public.units_of_measure WHERE id = p_from_unit_id;
  SELECT category, conversion_factor, code INTO t_cat, t_factor, t_code
  FROM public.units_of_measure WHERE id = p_to_unit_id;

  IF f_cat IS NULL OR t_cat IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'إحدى الوحدتين غير موجودة في جدول الوحدات');
  END IF;

  -- Same unit → identity.
  IF p_from_unit_id = p_to_unit_id THEN
    RETURN jsonb_build_object('ok', true, 'converted', p_quantity, 'factor', 1,
                              'category', f_cat, 'source', 'identity');
  END IF;

  -- Dimensional guard — the core validation.
  IF f_cat IS DISTINCT FROM t_cat THEN
    RETURN jsonb_build_object('ok', false,
      'error', format('لا يمكن التحويل بين وحدتين من تصنيفين مختلفين: %s (%s) ≠ %s (%s)',
                      f_code, f_cat, t_code, t_cat),
      'from_category', f_cat, 'to_category', t_cat);
  END IF;

  -- Per-material override (variable-capacity units: carton/pallet/roll/…).
  IF p_material_id IS NOT NULL THEN
    SELECT muc.conversion_factor, muc.weight_per_unit, muc.volume_cbm
      INTO v_factor, v_weight, v_volume
    FROM public.material_unit_conversions muc
    WHERE muc.material_id = p_material_id
      AND muc.from_unit_id = p_from_unit_id AND muc.to_unit_id = p_to_unit_id
      AND muc.is_active = true
    LIMIT 1;
    IF v_factor IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'converted', p_quantity * v_factor,
        'factor', v_factor, 'category', f_cat, 'source', 'material',
        'total_weight', CASE WHEN v_weight IS NOT NULL THEN p_quantity * v_weight END,
        'total_volume', CASE WHEN v_volume IS NOT NULL THEN p_quantity * v_volume END);
    END IF;
    -- reverse per-material row
    SELECT muc.conversion_factor INTO v_factor
    FROM public.material_unit_conversions muc
    WHERE muc.material_id = p_material_id
      AND muc.from_unit_id = p_to_unit_id AND muc.to_unit_id = p_from_unit_id
      AND muc.is_active = true
    LIMIT 1;
    IF v_factor IS NOT NULL AND v_factor > 0 THEN
      RETURN jsonb_build_object('ok', true, 'converted', p_quantity / v_factor,
        'factor', 1.0 / v_factor, 'category', f_cat, 'source', 'material_reverse');
    END IF;
  END IF;

  -- Global fallback — both factors are relative to the category base unit.
  IF f_factor IS NULL OR t_factor IS NULL OR t_factor = 0 THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'معامل تحويل عام مفقود لإحدى الوحدتين — عرّف تحويلاً للصنف');
  END IF;
  v_factor := f_factor / t_factor;
  RETURN jsonb_build_object('ok', true, 'converted', p_quantity * v_factor,
    'factor', v_factor, 'category', f_cat, 'source', 'global');
END;
$$;

GRANT EXECUTE ON FUNCTION public.uom_convert(uuid, uuid, numeric, uuid) TO authenticated, service_role;
