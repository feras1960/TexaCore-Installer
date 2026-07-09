-- ═══════════════════════════════════════════════════════════════
-- Product reviews for storefronts (Tkanex / Obuvix websites + NexaLive app)
-- ═══════════════════════════════════════════════════════════════
-- Public can read APPROVED reviews only; anyone can submit (pending
-- moderation from the TexaCore dashboard). Source distinguishes app/web.

CREATE TABLE IF NOT EXISTS ecommerce_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    source TEXT DEFAULT 'website',          -- website | nexalive_app
    is_approved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecom_reviews_product_approved
    ON ecommerce_reviews (product_id, created_at DESC)
    WHERE is_approved;

ALTER TABLE ecommerce_reviews ENABLE ROW LEVEL SECURITY;

-- Public storefronts read approved reviews only.
DROP POLICY IF EXISTS reviews_public_read ON ecommerce_reviews;
CREATE POLICY reviews_public_read ON ecommerce_reviews
    FOR SELECT USING (is_approved = true);

-- Anyone may submit a review, but ONLY as pending (is_approved MUST be false).
-- (كان WITH CHECK(true) يسمح بإرسال مراجعة معتمدة مسبقاً is_approved=true متجاوزاً الإشراف.)
DROP POLICY IF EXISTS reviews_public_insert ON ecommerce_reviews;
CREATE POLICY reviews_public_insert ON ecommerce_reviews
    FOR INSERT TO anon, authenticated WITH CHECK (is_approved = false);

-- Tenant staff manage their stores' reviews (approve/delete).
DROP POLICY IF EXISTS reviews_tenant_manage ON ecommerce_reviews;
CREATE POLICY reviews_tenant_manage ON ecommerce_reviews
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM ecommerce_stores s
        WHERE s.id = ecommerce_reviews.store_id
          AND s.tenant_id = get_user_tenant_id()
    ));

GRANT SELECT, INSERT ON ecommerce_reviews TO anon, authenticated;
