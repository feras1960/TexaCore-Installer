-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Add Material Inventory Stats RPC
-- إضافة دالة لحساب إحصائيات مخزون المواد (رولونات)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_material_inventory_stats_batch(material_ids UUID[])
RETURNS TABLE (
    material_id UUID,
    rolls_count BIGINT,
    rolls_total_length DECIMAL(15,3),
    reserved_length DECIMAL(15,3),
    available_length DECIMAL(15,3)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fr.material_id,
        COUNT(fr.id)::BIGINT as rolls_count,
        COALESCE(SUM(fr.current_length), 0)::DECIMAL(15,3) as rolls_total_length,
        COALESCE(SUM(fr.reserved_length), 0)::DECIMAL(15,3) as reserved_length,
        COALESCE(SUM(fr.available_length), 0)::DECIMAL(15,3) as available_length
    FROM 
        fabric_rolls fr
    WHERE 
        fr.material_id = ANY(material_ids)
        AND fr.status != 'consumed'
        AND fr.current_length > 0
    GROUP BY 
        fr.material_id;
END;
$$;
