-- ═══════════════════════════════════════════════════════════════════════════
-- P5 — sector calculators (server-side, IMMUTABLE)
-- ═══════════════════════════════════════════════════════════════════════════
-- SQL mirrors of src/lib/uom/calculators.ts, so RPCs / storefront / the EuroFix
-- quantity calculator can compute server-side. Pure math, IMMUTABLE, NULL-safe
-- (return NULL on non-positive gsm/width/pack instead of raising).
-- ═══════════════════════════════════════════════════════════════════════════

-- Grams per linear metre = GSM × width(m).
CREATE OR REPLACE FUNCTION public.fabric_gsm_to_glm(p_gsm numeric, p_width_cm numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_gsm > 0 AND p_width_cm > 0 THEN p_gsm * (p_width_cm / 100.0) END;
$$;

-- Ounces per square yard ≈ GSM × 0.0295.
CREATE OR REPLACE FUNCTION public.fabric_gsm_to_oz_yd2(p_gsm numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_gsm > 0 THEN p_gsm * 0.0295 END;
$$;

-- Total weight (g) of a length of fabric = length(m) × GSM × width(m).
CREATE OR REPLACE FUNCTION public.fabric_length_to_weight(p_length_m numeric, p_gsm numeric, p_width_cm numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_length_m >= 0 AND p_gsm > 0 AND p_width_cm > 0
              THEN p_length_m * p_gsm * (p_width_cm / 100.0) END;
$$;

-- Length (m) obtainable from a weight = weight(g) ÷ (GSM × width(m)).
CREATE OR REPLACE FUNCTION public.fabric_weight_to_length(p_weight_g numeric, p_gsm numeric, p_width_cm numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_weight_g >= 0 AND p_gsm > 0 AND p_width_cm > 0
              THEN p_weight_g / (p_gsm * (p_width_cm / 100.0)) END;
$$;

-- Chemical/construction quantity: total material + whole packs for an area.
CREATE OR REPLACE FUNCTION public.chemical_quantity(
  p_area_m2 numeric, p_coverage_rate numeric, p_pack_size numeric
) RETURNS TABLE(total_quantity numeric, packs_needed integer)
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE WHEN p_area_m2 >= 0 AND p_coverage_rate > 0 THEN p_area_m2 * p_coverage_rate END,
    CASE WHEN p_area_m2 >= 0 AND p_coverage_rate > 0 AND p_pack_size > 0
         THEN ceil((p_area_m2 * p_coverage_rate) / p_pack_size)::integer END;
$$;

-- Volume→weight via density (kg/L).
CREATE OR REPLACE FUNCTION public.chemical_volume_to_weight(p_volume_l numeric, p_density_kg_per_l numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_density_kg_per_l > 0 THEN p_volume_l * p_density_kg_per_l END;
$$;

GRANT EXECUTE ON FUNCTION
  public.fabric_gsm_to_glm(numeric, numeric),
  public.fabric_gsm_to_oz_yd2(numeric),
  public.fabric_length_to_weight(numeric, numeric, numeric),
  public.fabric_weight_to_length(numeric, numeric, numeric),
  public.chemical_quantity(numeric, numeric, numeric),
  public.chemical_volume_to_weight(numeric, numeric)
TO anon, authenticated, service_role;
