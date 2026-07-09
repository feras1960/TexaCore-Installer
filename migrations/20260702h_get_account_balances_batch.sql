-- 20260702h — get_account_balances_batch: دالة مفقودة تستدعيها واجهة الصرافة (وكلاء/شركاء)
-- التدقيق كشف أنها غير موجودة على السحابة، فالواجهة تسقط لحساب عميل-جانبي يجمع كل السطور
-- بلا فلترة is_posted/status ⇒ يُدرج المسودات في الرصيد (رصيد خاطئ).
-- الإصلاح: دالة SQL بسيطة (SECURITY INVOKER افتراضياً ⇒ RLS يطبَّق ⇒ عزل مستأجر مجاني)
-- تجمع صافي (مدين−دائن) للقيود المُرحَّلة فقط لكل حساب.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_account_balances_batch(account_ids uuid[])
 RETURNS TABLE(account_id uuid, balance numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
    SELECT jel.account_id,
           COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
    FROM journal_entry_lines jel
    JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.account_id = ANY(account_ids)
    GROUP BY jel.account_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_account_balances_batch(uuid[]) TO authenticated;

COMMIT;
