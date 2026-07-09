-- ═══════════════════════════════════════════════════════════════
-- Ecommerce Category Enhancements
--  1. sector column (code/schema mismatch fix)
--  2. Scheduled visibility (visible_from / visible_until) + RLS
--  3. Smart rule-based categories (is_smart + smart_rules)
--  4. assigned_by provenance on product↔category links
--  5. AI category suggestions table (review queue)
--  6. category-images storage bucket
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. sector (the ERP UI already sends it on save) ───
ALTER TABLE ecommerce_categories ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'textiles';

-- ─── 2. Scheduled visibility ───
ALTER TABLE ecommerce_categories ADD COLUMN IF NOT EXISTS visible_from TIMESTAMPTZ;
ALTER TABLE ecommerce_categories ADD COLUMN IF NOT EXISTS visible_until TIMESTAMPTZ;

-- Public storefront read now respects the schedule window (staff policy is FOR ALL, unaffected)
DROP POLICY IF EXISTS "ecommerce_categories_public_read" ON ecommerce_categories;
CREATE POLICY "ecommerce_categories_public_read" ON ecommerce_categories
    FOR SELECT USING (
        is_active = true
        AND (visible_from IS NULL OR visible_from <= now())
        AND (visible_until IS NULL OR visible_until >= now())
    );

-- ─── 3. Smart rule-based categories ───
-- smart_rules: {"match":"all"|"any","conditions":[{"field":"name|composition|season|usage|origin|erp_category|price|tag","op":"contains|eq|gte|lte|has","value":...}]}
ALTER TABLE ecommerce_categories ADD COLUMN IF NOT EXISTS is_smart BOOLEAN DEFAULT false;
ALTER TABLE ecommerce_categories ADD COLUMN IF NOT EXISTS smart_rules JSONB DEFAULT '{"match":"all","conditions":[]}';

-- ─── 4. Provenance on the join table ('manual' | 'rule' | 'ai' | 'name-match') ───
ALTER TABLE ecommerce_product_categories ADD COLUMN IF NOT EXISTS assigned_by TEXT DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_epc_category ON ecommerce_product_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_epc_product ON ecommerce_product_categories(product_id);

-- ─── 5. AI category suggestions (review queue) ───
CREATE TABLE IF NOT EXISTS ecommerce_category_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    suggestion_type TEXT NOT NULL CHECK (suggestion_type IN ('assign', 'new_category')),
    -- assign:       {"product_ids": [...], "category_id": "..."}
    -- new_category: {"name": {ar,en,uk,ru}, "slug": "...", "parent_id": null, "icon": "...", "product_ids": [...]}
    payload JSONB NOT NULL DEFAULT '{}',
    reason JSONB DEFAULT '{}',            -- multilingual explanation of why
    confidence NUMERIC(4,3),              -- 0..1
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ecs_store_status ON ecommerce_category_suggestions(store_id, status);

ALTER TABLE ecommerce_category_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ecs_tenant_manage" ON ecommerce_category_suggestions;
CREATE POLICY "ecs_tenant_manage" ON ecommerce_category_suggestions
    FOR ALL USING (
        is_platform_admin()
        OR tenant_id = get_user_tenant_id()
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON ecommerce_category_suggestions TO authenticated;

-- auto tenant_id like sibling ecommerce tables
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_set_tenant_id') THEN
        DROP TRIGGER IF EXISTS trg_ecs_tenant ON ecommerce_category_suggestions;
        CREATE TRIGGER trg_ecs_tenant
            BEFORE INSERT ON ecommerce_category_suggestions
            FOR EACH ROW EXECUTE FUNCTION auto_set_tenant_id();
    END IF;
END $$;

-- ─── 6. category-images bucket (public read, authenticated write) ───
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    EXECUTE '
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
        ''category-images'',
        ''category-images'',
        true,
        2097152,
        ARRAY[''image/jpeg'', ''image/png'', ''image/webp'', ''image/avif'']
    )
    ON CONFLICT (id) DO UPDATE SET
        public = true,
        file_size_limit = 2097152,
        allowed_mime_types = ARRAY[''image/jpeg'', ''image/png'', ''image/webp'', ''image/avif''];
    ';

    BEGIN
      EXECUTE 'DROP POLICY IF EXISTS "category_images_auth_write" ON storage.objects';
      EXECUTE 'CREATE POLICY "category_images_auth_write" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = ''category-images'')';
      EXECUTE 'DROP POLICY IF EXISTS "category_images_auth_update" ON storage.objects';
      EXECUTE 'CREATE POLICY "category_images_auth_update" ON storage.objects
        FOR UPDATE TO authenticated
        USING (bucket_id = ''category-images'')';
      EXECUTE 'DROP POLICY IF EXISTS "category_images_auth_delete" ON storage.objects';
      EXECUTE 'CREATE POLICY "category_images_auth_delete" ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = ''category-images'')';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'storage.objects policies skipped (insufficient privilege) — create from Dashboard';
    END;
  END IF;
END $$;

COMMENT ON COLUMN ecommerce_categories.smart_rules IS
  'Rule-based auto membership: {"match":"all|any","conditions":[{"field","op","value"}]} — evaluated by the ERP sync (assigned_by=rule rows in ecommerce_product_categories)';
