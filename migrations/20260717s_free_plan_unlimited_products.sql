-- 20260717s: Free plan — unlimited products/materials (owner decision 2026-07-17)
-- Philosophy: setup/data entry is unlimited on free (products with full details
-- and prices, manufacturing BOMs/recipes, work centers, templates) so users can
-- onboard their entire catalog; friction lives at USAGE gates only
-- (monthly invoices, monthly production orders, advanced features).
-- -1 is the platform's "unlimited" sentinel (matches max_images/max_records).

UPDATE subscription_plans
SET max_products = -1
WHERE code = 'free' AND max_products IS DISTINCT FROM -1;
