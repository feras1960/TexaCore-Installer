-- ═══════════════════════════════════════════════════════════════
-- Reviews: NexaLive app integration on top of ecommerce_reviews
-- ═══════════════════════════════════════════════════════════════
-- • user_id + is_verified columns (verified purchase = the signed-in
--   user has a non-cancelled order in this store containing the product)
-- • BEFORE INSERT trigger: stamps user_id, sanitizes input, forces the
--   moderation gate (is_approved=false) and computes is_verified
-- • one review per user per product per store (partial unique index)
-- • ecommerce_review_stats view: public aggregates of APPROVED reviews
--   (drives stars on product cards + the product-page summary)

BEGIN;

ALTER TABLE ecommerce_reviews ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE ecommerce_reviews
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION ecommerce_reviews_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.is_approved := false;               -- moderation gate, always
  NEW.user_id := auth.uid();
  NEW.customer_name :=
      left(coalesce(nullif(trim(NEW.customer_name), ''), '—'), 80);
  NEW.comment := left(NEW.comment, 2000);
  NEW.rating := greatest(1, least(5, coalesce(NEW.rating, 5)));
  NEW.is_verified := false;
  IF NEW.user_id IS NOT NULL THEN
    NEW.is_verified := EXISTS (
      SELECT 1
      FROM ecommerce_orders o
      JOIN ecommerce_order_items oi ON oi.order_id = o.id
      JOIN ecommerce_customers c ON c.id = o.customer_id
      WHERE c.user_id = NEW.user_id
        AND o.store_id = NEW.store_id
        AND oi.product_id = NEW.product_id
        AND o.status NOT IN ('cancelled', 'refunded')
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ecommerce_reviews_before_insert
  ON ecommerce_reviews;
CREATE TRIGGER trg_ecommerce_reviews_before_insert
  BEFORE INSERT ON ecommerce_reviews
  FOR EACH ROW EXECUTE FUNCTION ecommerce_reviews_before_insert();

-- One review per signed-in user per product per store.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecommerce_reviews_user_product
  ON ecommerce_reviews (store_id, product_id, user_id)
  WHERE user_id IS NOT NULL;

-- Public aggregates (view runs with invoker rights → anon only sees
-- approved rows through reviews_public_read, matching the aggregate).
CREATE OR REPLACE VIEW ecommerce_review_stats
WITH (security_invoker = true) AS
SELECT store_id,
       product_id,
       count(*)::int                    AS review_count,
       round(avg(rating)::numeric, 1)   AS avg_rating
FROM ecommerce_reviews
WHERE is_approved = true
GROUP BY store_id, product_id;

GRANT SELECT ON ecommerce_review_stats TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
