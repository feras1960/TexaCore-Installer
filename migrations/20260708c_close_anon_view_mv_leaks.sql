-- ═══════════════════════════════════════════════════════════════════════════
-- 20260708c_close_anon_view_mv_leaks.sql
-- إغلاق تسريب عابر للشركات: Materialized Views + SECURITY DEFINER Views كانت
-- ممنوحة anon=arwdm ولا تحترم RLS (الـMVs بطبيعتها، والـviews لأنها تعمل بمالك
-- postgres صاحب BYPASSRLS دون security_invoker). لا يوجد أي مرجع لهذه الكائنات
-- في الواجهة/الدوال الطرفية (تُحقّق: 0 استخدام) ⇒ السحب آمن ولا يكسر شيئاً.
-- idempotent، معاملة واحدة. راجع: security-rls-tenant-isolation-fix.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- (1) Materialized Views المالية العابرة للشركات — سحب كل صلاحيات anon/authenticated.
--     تحمل company_id/tenant_id + أرصدة/مبيعات/مخزون، والـMV لا يُطبّق RLS إطلاقاً،
--     فقراءتها عبر anon = كشف كل الشركات. تُحدَّث بـcron كـpostgres (لا تتأثر).
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.mv_account_balances  FROM anon, authenticated;
REVOKE ALL ON public.mv_monthly_sales     FROM anon, authenticated;
REVOKE ALL ON public.mv_inventory_summary FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- (2) SECURITY DEFINER Views — فرض security_invoker=on ليحترم كل view سياسات RLS
--     على الجداول الأساس بصلاحية المُستدعي بدل المالك.
--     • marketplace_supplier_balances / performance_scores: حسّاسة ⇒ سحب SELECT عن anon.
--     • ecommerce_product_attrs_effective: عامة بالتصميم (متجر) ⇒ تبقى قراءة anon،
--       لكنها الآن تمرّ عبر سياسات anon للجداول الأساس (ecommerce_products/attributes).
--     كل الـviews: سحب INSERT/UPDATE/DELETE العبثية (لا معنى للكتابة على تجميع).
-- ────────────────────────────────────────────────────────────────────────────
ALTER VIEW public.marketplace_supplier_balances     SET (security_invoker = on);
ALTER VIEW public.performance_scores                SET (security_invoker = on);
ALTER VIEW public.ecommerce_product_attrs_effective SET (security_invoker = on);

REVOKE INSERT, UPDATE, DELETE ON
  public.marketplace_supplier_balances,
  public.performance_scores,
  public.ecommerce_product_attrs_effective
  FROM anon, authenticated;

REVOKE SELECT ON
  public.marketplace_supplier_balances,
  public.performance_scores
  FROM anon;

COMMIT;
