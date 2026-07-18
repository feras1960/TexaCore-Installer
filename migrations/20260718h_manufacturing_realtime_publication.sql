-- ════════════════════════════════════════════════════════════════
-- 🔄 20260718h — تفعيل اللحظي لموديول التصنيع (publication + replica identity)
-- ────────────────────────────────────────────────────────────────
-- طرف العميل موصول سلفاً: hooks التصنيع تستدعي useRealtimeInvalidation على
-- 12 جدولاً، لكن هذه الجداول لم تكن في منشور supabase_realtime فلم يبثّ
-- السيرفر تغييراتها → الاشتراك صامت (يظهر بلا تحديث لحظي؛ التحديث فقط بعد
-- staleTime). هنا نضيفها للمنشور + REPLICA IDENTITY FULL (ليحمل حدث DELETE
-- الصفّ القديم فتُزال المحذوفات من الكاش وتعمل الاشتراكات المفلترة).
-- Idempotent (DO-guard على وجود الجدول في المنشور).
-- ملاحظة: اللحظي مفعّل على النطاق المنشور فقط؛ localhost يعطّله عمداً.
-- ════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
    v_tbl text;
    -- [installer-adapt] supabase_realtime publication is cloud-only; localhost has none.
    v_has_pub boolean := EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime');
    v_tables text[] := ARRAY[
        'mfg_boms',
        'mfg_production_orders',
        'mfg_order_stages',
        'mfg_labor_logs',
        'mfg_qc_tests',
        'mfg_pallets',
        'mfg_bag_codes',
        'mfg_work_centers',
        'mfg_work_center_employees',
        'mfg_workflow_templates',
        'mfg_custom_field_defs',
        'mfg_material_issues',
        'mfg_material_returns',
        'mfg_finished_receipts',
        'inventory_batches'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_tables LOOP
        -- REPLICA IDENTITY FULL (idempotent — إعادة الضبط بلا ضرر).
        EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_tbl);
        -- أضِف للمنشور فقط إن وُجد المنشور (سحابي) ولم يكن الجدول مضافاً.
        IF v_has_pub AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_tbl
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tbl);
        END IF;
    END LOOP;
END $$;

COMMIT;
