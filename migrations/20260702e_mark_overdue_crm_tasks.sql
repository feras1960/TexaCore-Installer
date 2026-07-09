-- 20260702e — mark_overdue_tasks: تشمل مهام CRM أيضاً
-- التدقيق كشف أن الدالة تُحدّث ai_tasks فقط (بحالة 'pending' غير المستخدمة في crm)،
-- فمهام CRM (crm_tasks) لم تكن تُوسَم «متأخّرة» تلقائياً أبداً رغم أن الكرون task-mark-overdue
-- مخصّص لها. الإصلاح: إضافة تحديث crm_tasks بالحالات الصحيحة (open/in_progress) دون
-- المساس بمنطق ai_tasks القائم.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_overdue_tasks()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    -- مهام وكيل الذكاء (كما كانت)
    UPDATE ai_tasks
    SET status = 'overdue'
    WHERE status IN ('pending', 'in_progress')
      AND due_date < CURRENT_DATE;

    -- مهام CRM (كانت مهمَلة): الحالات المسموحة open/in_progress، والوقت timestamptz
    UPDATE crm_tasks
    SET status = 'overdue', updated_at = NOW()
    WHERE status IN ('open', 'in_progress')
      AND due_date IS NOT NULL
      AND due_date < NOW();
END;
$function$;

COMMIT;
