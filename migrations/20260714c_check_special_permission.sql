-- ════════════════════════════════════════════════════════════════════════
-- check_special_permission — الفحص الخادمي للصلاحيات الخاصة (أساس البيع/الشراء المباشر)
-- ════════════════════════════════════════════════════════════════════════
-- اكتشاف أثناء تطبيق 20260714a/b: هجرة 20260219_special_permissions لم تكن مطبَّقة
-- على الحيّة إطلاقاً (لا العمود مضمون ولا الدالة موجودة) — الواجهة كانت تسقط دوماً
-- على الفحص المحلي (rbacService JS fallback). الموجود حيّاً دالة أخرى console_special
-- تقرأ roles.permissions (نموذج مختلف) ولا تتجاوز للمالك.
--
-- هذه الدالة تطابق نموذج الواجهة حرفياً (rbacService.checkSpecialPermission):
--   ١) دور نشط بكود super_admin/tenant_owner/company_owner ⇒ true (تجاوز المالك/الأدمن).
--   ٢) وإلا أي دور نشط special_permissions->>p_perm_name = 'true' ⇒ true.
--   ٣) احترام expires_at كما في console_special.
-- أسماء المعاملات (p_user_id, p_perm_name) هي نفسها التي تستدعيها الواجهة عبر RPC،
-- فوجود الدالة يفعّل المسار الخادمي الأمامي أيضاً بدل الـfallback.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS special_permissions jsonb DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.check_special_permission(p_user_id uuid, p_perm_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND (
                r.code IN ('super_admin', 'tenant_owner', 'company_owner')
             OR COALESCE(r.special_permissions->>p_perm_name, 'false') = 'true'
          )
    );
$function$;

COMMENT ON FUNCTION public.check_special_permission(uuid, text) IS
    'فحص صلاحية خاصة: تجاوز تلقائي للمالك/الأدمن (super_admin/tenant_owner/company_owner) وإلا من roles.special_permissions — يطابق rbacService بالواجهة؛ تعتمد عليه direct_post_sale/direct_post_purchase';

GRANT EXECUTE ON FUNCTION public.check_special_permission(uuid, text) TO authenticated, service_role;
