-- إصلاح: رفع PTT (وأي رفع مجهول) يفشل بـ«permission denied for function
-- get_current_tenant_id». سياسات storage «Tenant folder *» على دور public
-- تنادي الدالة، و anon يفتقر صلاحية EXECUTE → فحص الصلاحية يرمي فيُجهض الرفع
-- كله (رغم أن ptt_upload_anon يسمح). الدالة SECURITY DEFINER وترجع NULL للمجهول
-- (آمنة، لا تسريب). المنح يجعل فحص الصلاحية يمرّ فتسري السياسة الصحيحة.
GRANT EXECUTE ON FUNCTION public.get_current_tenant_id() TO anon;
