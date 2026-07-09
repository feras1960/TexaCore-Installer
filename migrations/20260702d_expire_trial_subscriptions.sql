-- 20260702d — check_expired_subscriptions: تشمل الاشتراكات التجريبية (trial)
-- التدقيق كشف أن الدالة تُنهي status='active' فقط، بينما كل عملاء الإنتاج الأربعة
-- حالتهم 'trial' وأقربهم ينتهي 2026-07-09 ⇒ كان سينقضي بصمت دون تعليق ولا إشعار.
-- الإصلاح: توسيع الإنهاء ليشمل ('active','trial')، وضبط فترة سماح 7 أيام عند الإنهاء
-- (إن كانت فارغة) كي تعمل خطوة التعليق بشكل محدَّد وتُعطي العميل مهلة قبل أي حجب.
-- المنطق والبنية كما هي؛ التغيير في شرط ومجموعة UPDATE فقط.

BEGIN;

CREATE OR REPLACE FUNCTION public.check_expired_subscriptions()
 RETURNS TABLE(tenant_id uuid, tenant_name character varying, subscription_id uuid, end_date date, days_expired integer, action_taken text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    -- 1. تحديث الاشتراكات المنتهية (نشطة أو تجريبية) + ضبط فترة سماح إن كانت فارغة
    UPDATE tenant_subscriptions ts
    SET
        status = 'expired',
        grace_period_end = COALESCE(ts.grace_period_end, ts.end_date + INTERVAL '7 days'),
        updated_at = NOW()
    WHERE ts.end_date < CURRENT_DATE
        AND ts.status IN ('active', 'trial');

    -- 2. تعليق المستأجرين بعد فترة السماح
    UPDATE tenants t
    SET
        status = 'suspended',
        updated_at = NOW()
    FROM tenant_subscriptions ts
    WHERE t.id = ts.tenant_id
        AND ts.grace_period_end < CURRENT_DATE
        AND ts.status = 'expired'
        AND t.status IN ('active', 'trial');

    -- 3. إرجاع قائمة بالاشتراكات المنتهية/المعلقة
    RETURN QUERY
    SELECT
        t.id,
        t.name,
        ts.id,
        ts.end_date,
        (CURRENT_DATE - ts.end_date)::INT,
        CASE
            WHEN t.status = 'suspended' THEN 'Tenant Suspended'
            WHEN ts.status = 'expired' THEN 'Subscription Expired'
            ELSE 'Active'
        END
    FROM tenants t
    JOIN tenant_subscriptions ts ON t.id = ts.tenant_id
    WHERE ts.status IN ('expired')
        OR (t.status = 'suspended' AND ts.end_date < CURRENT_DATE)
    ORDER BY ts.end_date;
END;
$function$;

COMMIT;
