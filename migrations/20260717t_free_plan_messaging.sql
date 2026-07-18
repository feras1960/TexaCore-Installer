-- 20260717t: Free plan messaging — unlimited setup, storage-metered (owner decision 2026-07-17)
-- Positioning: "enter ALL your materials/products/recipes with no limits;
-- the only caps are storage space (cloud) and monthly activity."
-- Local/installer note: storage limits are NOT enforced on the local version
-- (customer's own disk) — to be reflected in the next installer milestone.
UPDATE subscription_plans
SET description_ar = 'ابدأ مجاناً بدون بطاقة ائتمان — أدخِل كل موادك ومنتجاتك ووصفاتك بلا أي حدود، واعمل بكامل مزايا النظام. الحد الوحيد: مساحة التخزين وعدد العمليات الشهرية.',
    description    = 'Start free, no credit card required — add all your materials, products and recipes with no limits and use the full system. Only storage space and monthly activity are metered.'
WHERE code = 'free';
