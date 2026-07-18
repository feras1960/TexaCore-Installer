-- ════════════════════════════════════════════════════════════════
-- 🧾 20260718g — أرشيف إصدارات الوصفات (BOM Revisions) — Manufacturing
-- ────────────────────────────────────────────────────────────────
-- عند اعتماد الوصفة (status → approved) يُخزَّن snapshot كامل (رأس + بنود
-- ببدائلها + مخرجات) في mfg_bom_revisions عبر تريغر — فيصبح ممكناً عرض
-- «ما الذي تغيّر بين الإصدارات» (مقارنة v1↔v2 بالواجهة) وضبط الجودة.
-- الكتابة عبر التريغر حصراً (SECURITY DEFINER)؛ القراءة للمستأجر.
-- Idempotent · RLS قانوني (عزل + حارس موديول RESTRICTIVE — نمط mfg_boms).
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1) الجدول ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_bom_revisions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL,
    company_id   uuid NOT NULL,
    bom_id       uuid NOT NULL REFERENCES public.mfg_boms(id) ON DELETE CASCADE,
    version      int  NOT NULL,
    snapshot     jsonb NOT NULL,          -- {header, lines:[{...,alternates:[]}], outputs:[]}
    approved_by  uuid,
    approved_at  timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (bom_id, version)
);
COMMENT ON TABLE public.mfg_bom_revisions IS
    'لقطات إصدارات الوصفات المعتمدة — تُكتب تلقائياً بتريغر عند الاعتماد؛ لمقارنة الإصدارات.';
CREATE INDEX IF NOT EXISTS mfg_bom_revisions_bom_idx
    ON public.mfg_bom_revisions(bom_id, version DESC);

-- ─── 2) RLS ──────────────────────────────────────────────────────
ALTER TABLE public.mfg_bom_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfg_bom_revisions_select_policy ON public.mfg_bom_revisions;
DROP POLICY IF EXISTS mfg_bom_revisions_module_guard  ON public.mfg_bom_revisions;

CREATE POLICY mfg_bom_revisions_select_policy ON public.mfg_bom_revisions
    FOR SELECT TO public
    USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
-- لا سياسات INSERT/UPDATE/DELETE — الكتابة عبر التريغر (SECURITY DEFINER) حصراً.
CREATE POLICY mfg_bom_revisions_module_guard ON public.mfg_bom_revisions
    AS RESTRICTIVE FOR SELECT TO public
    USING (tenant_has_module('manufacturing'::text));

-- ─── 3) دالة التريغر: لقطة عند الاعتماد ───────────────────────────
CREATE OR REPLACE FUNCTION public.mfg_snapshot_bom_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_lines    jsonb;
    v_outputs  jsonb;
    v_snapshot jsonb;
BEGIN
    -- بنود الوصفة ببدائلها (بترتيب sort_order).
    SELECT COALESCE(jsonb_agg(l ORDER BY (l->>'sort_order')::numeric NULLS LAST), '[]'::jsonb) INTO v_lines
    FROM (
        SELECT to_jsonb(bl.*) ||
               jsonb_build_object(
                   'alternates',
                   COALESCE((SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.priority)
                             FROM public.mfg_bom_line_alternates a
                             WHERE a.line_id = bl.id), '[]'::jsonb)
               ) AS l
        FROM public.mfg_bom_lines bl
        WHERE bl.bom_id = NEW.id
    ) t;

    SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.sort_order), '[]'::jsonb)
      INTO v_outputs
      FROM public.mfg_bom_outputs o
     WHERE o.bom_id = NEW.id;

    v_snapshot := jsonb_build_object(
        'header',  to_jsonb(NEW.*),
        'lines',   v_lines,
        'outputs', v_outputs
    );

    INSERT INTO public.mfg_bom_revisions
        (tenant_id, company_id, bom_id, version, snapshot, approved_by, approved_at)
    VALUES
        (NEW.tenant_id, NEW.company_id, NEW.id, COALESCE(NEW.version, 1),
         v_snapshot, auth.uid(), now())
    ON CONFLICT (bom_id, version) DO UPDATE
        SET snapshot = EXCLUDED.snapshot,
            approved_by = EXCLUDED.approved_by,
            approved_at = now();
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- الأرشفة لا تُفشل الاعتماد أبداً.
    RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.mfg_snapshot_bom_revision() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS mfg_bom_revision_snapshot_trg ON public.mfg_boms;
CREATE TRIGGER mfg_bom_revision_snapshot_trg
    AFTER UPDATE OF status ON public.mfg_boms
    FOR EACH ROW
    WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')
    EXECUTE FUNCTION public.mfg_snapshot_bom_revision();

COMMIT;
