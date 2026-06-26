-- 20260626g — seed subscription plans for self-hosted installs
-- ─────────────────────────────────────────────────────────────────────────────
-- On a fresh install public.subscription_plans is EMPTY (the schema sync carries
-- structure, not data; 20260625d seeds only 'free' and only if a product_id row
-- already exists). With no plan row, create-local-company cannot attach a
-- tenant_subscription, so get_all_plan_limits returns {error:no_active_subscription}
-- → the UI shows "0/0" and BLOCKS invoice creation on every tier.
--
-- This seeds the four cloud plans (so each package's limits resolve) PLUS a
-- `local-unlimited` plan (all -1) used for self-hosted paid/trial installs, which
-- are unlimited by design (the owner runs their own server). included_modules is
-- jsonb locally. Idempotent (NOT EXISTS per code); product_id left NULL (nullable).

-- free — 200 invoices/mo (the upsell teaser)
INSERT INTO public.subscription_plans
  (code, name_ar, name_en, plan_type, max_users, max_companies, max_branches, max_warehouses,
   max_products, max_invoices_monthly, max_customers, max_documents, max_images, max_records,
   storage_gb, included_modules, price_monthly, is_active)
SELECT 'free','مجاني إلى الأبد','Free Forever','free', 1,1,1,1,
   200,200,200,500,-1,-1, 1,
   '["dashboard","accounting","inventory","sales","purchases","crm","ai_analytics","workflows","system_config","activity_log"]'::jsonb,
   0, true
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE code='free');

-- texa-starter
INSERT INTO public.subscription_plans
  (code, name_ar, name_en, plan_type, max_users, max_companies, max_branches, max_warehouses,
   max_products, max_invoices_monthly, max_customers, max_documents, max_images, max_records,
   storage_gb, included_modules, price_monthly, is_active)
SELECT 'texa-starter','الباقة الأساسية','Basic Plan','paid', 3,1,1,2,
   500,500,-1,-1,-1,-1, 15,
   '["core","users","companies","accounting","inventory","warehouse","sales","purchases","crm","fabric","pbx"]'::jsonb,
   19, true
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE code='texa-starter');

-- texa-professional
INSERT INTO public.subscription_plans
  (code, name_ar, name_en, plan_type, max_users, max_companies, max_branches, max_warehouses,
   max_products, max_invoices_monthly, max_customers, max_documents, max_images, max_records,
   storage_gb, included_modules, price_monthly, is_active)
SELECT 'texa-professional','الباقة الاحترافية','Professional Plan','paid', 10,3,5,10,
   5000,500,-1,-1,-1,-1, 100,
   '["core","users","companies","accounting","inventory","warehouse","sales","purchases","crm","fabric","pbx","manufacturing","hr","pos","ecommerce","workflows","activity_log","wms","customers","suppliers","dashboard","settings","system_config","ai","ai_analytics"]'::jsonb,
   29, true
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE code='texa-professional');

-- texa-enterprise
INSERT INTO public.subscription_plans
  (code, name_ar, name_en, plan_type, max_users, max_companies, max_branches, max_warehouses,
   max_products, max_invoices_monthly, max_customers, max_documents, max_images, max_records,
   storage_gb, included_modules, price_monthly, is_active)
SELECT 'texa-enterprise','باقة المؤسسات','Enterprise Plan','paid', -1,-1,-1,-1,
   -1,500,-1,-1,-1,-1, 300,
   '["core","users","companies","accounting","inventory","warehouse","sales","purchases","crm","fabric","pbx","manufacturing","hr","ai_analytics","inspiration_studio","pos","ecommerce","workflows","activity_log","wms","customers","suppliers","dashboard","settings","system_config","exchange","pharmacy","restaurant","gold","real_estate","realestate","healthcare","doctors","projects","website","shipments","treasury","analytics","api","saas","ai","component_lab"]'::jsonb,
   49, true
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE code='texa-enterprise');

-- local-unlimited — self-hosted paid/trial: never capped (owner's own server).
-- plan_type='paid' so the free-only enforcement triggers never fire; all -1 so
-- get_all_plan_limits reports unlimited=true / allowed=true for every resource.
INSERT INTO public.subscription_plans
  (code, name_ar, name_en, plan_type, max_users, max_companies, max_branches, max_warehouses,
   max_products, max_invoices_monthly, max_customers, max_documents, max_images, max_records,
   storage_gb, included_modules, price_monthly, is_active)
SELECT 'local-unlimited','غير محدود (محلي)','Unlimited (Local)','paid', -1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1, -1,
   '["core","users","companies","accounting","inventory","warehouse","sales","purchases","crm","fabric","pbx","manufacturing","hr","ai_analytics","inspiration_studio","pos","ecommerce","workflows","activity_log","wms","customers","suppliers","dashboard","settings","system_config","exchange","pharmacy","restaurant","gold","real_estate","realestate","healthcare","doctors","projects","website","shipments","treasury","analytics","api","saas","ai","component_lab"]'::jsonb,
   0, true
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE code='local-unlimited');
