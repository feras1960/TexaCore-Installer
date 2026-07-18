-- ════════════════════════════════════════════════════════════════════
-- 20260714a — تمييز نسخة المشترك في الإشعارات: ☁️ سحابية / 🖥️ محلية
-- ════════════════════════════════════════════════════════════════════
-- 1) إشعار «مشترك جديد» لا يصدر إلا من التسجيل السحابي (register_new_subscriber
--    في قاعدة السحابة؛ النسخة المحلية تسجّل على قاعدتها المحلية) — يُوسَم ☁️ سحابية.
-- 2) تثبيتات النسخة المحلية كانت صامتة كلياً: licensing_register_free تنشئ
--    الترخيص بلا أي إشعار. نضيف إشعار تلغرام + داخلي عند أول تسجيل لجهاز جديد
--    (idempotent — لا يتكرر مع نبضات نفس الجهاز).
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- (أ) إشعار المشترك السحابي: إضافة سطر «النسخة: ☁️ سحابية»
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_new_subscriber_notification(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_admin_tenant_id UUID := '681aa0e4-7692-4337-a3e8-2c127f80e573';
    v_admin_company_id UUID;
    v_admin_user_id UUID;
    v_tenant RECORD;
    v_product_name TEXT;
    v_product_code TEXT;
    v_plan_name TEXT;
    v_plan_price NUMERIC;
    v_plan_code TEXT;
    v_plan_type TEXT;
    v_trial_days INT;
    v_sub_status TEXT;
    v_sub_end_date DATE;
    v_modules_count INT;
    v_phone TEXT;
    v_users_count INT;
    v_companies_count INT;
    v_bot_token TEXT;
    v_tg_message TEXT;
    v_tg_url TEXT;
    v_conn RECORD;
    v_notif_body TEXT;
    v_notif_metadata JSONB;
    v_email TEXT; v_provider TEXT; v_lang TEXT; v_provider_label TEXT; v_lang_label TEXT;
    v_ip_country TEXT; v_ip TEXT; v_loc TEXT := ''; v_local_time TEXT;
    v_admin_url CONSTANT TEXT := 'https://app.texacore.ai/saas/subscribers';
BEGIN
    -- ═══ جلب company_id الإدارية ═══
    SELECT id INTO v_admin_company_id FROM companies
    WHERE tenant_id = v_admin_tenant_id
    ORDER BY created_at LIMIT 1;

    IF v_admin_company_id IS NULL THEN RETURN; END IF;

    -- ═══ 1. جلب بيانات المستأجر ═══
    SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
    IF NOT FOUND THEN RETURN; END IF;

    -- ═══ 2. بيانات المنصة ═══
    SELECT sp.name, sp.code INTO v_product_name, v_product_code
    FROM saas_products sp WHERE sp.id = v_tenant.product_id;

    -- ═══ 3. بيانات الباقة والاشتراك ═══
    SELECT sp.name_ar, sp.price_monthly, sp.code, COALESCE(sp.plan_type, 'paid'), sp.trial_days,
           ts.status, ts.end_date
    INTO v_plan_name, v_plan_price, v_plan_code, v_plan_type, v_trial_days,
         v_sub_status, v_sub_end_date
    FROM tenant_subscriptions ts
    JOIN subscription_plans sp ON sp.id = ts.plan_id
    WHERE ts.tenant_id = p_tenant_id
    ORDER BY ts.created_at DESC
    LIMIT 1;

    -- ═══ 4. عدد الموديولات ═══
    SELECT count(*) INTO v_modules_count
    FROM tenant_modules WHERE tenant_id = p_tenant_id AND is_active = true;

    -- ═══ 5. رقم الهاتف ═══
    v_phone := COALESCE(v_tenant.phone, v_tenant.owner_phone, '');
    IF v_phone = '' THEN
        SELECT up.phone INTO v_phone FROM user_profiles up
        WHERE up.tenant_id = p_tenant_id LIMIT 1;
    END IF;

    -- ═══ 6. عدد المستخدمين والشركات ═══
    SELECT count(*) INTO v_users_count FROM user_profiles WHERE tenant_id = p_tenant_id;
    SELECT count(*) INTO v_companies_count FROM companies WHERE tenant_id = p_tenant_id;

    -- ═══ 6b. البريد (حارس tombstone) + مزوّد التسجيل + اللغة ═══
    v_email := COALESCE(NULLIF(v_tenant.owner_email, ''), v_tenant.email, '');
    SELECT u.raw_app_meta_data->>'provider',
           lower(COALESCE(u.raw_user_meta_data->>'language', u.raw_user_meta_data->>'lang'))
      INTO v_provider, v_lang
      FROM auth.users u JOIN tenant_users tu ON tu.user_id = u.id
     WHERE tu.tenant_id = p_tenant_id AND tu.role = 'owner' LIMIT 1;
    IF v_email LIKE 'deleted\_%@deleted.texacore.local' OR v_email = '' THEN
        SELECT u.email INTO v_email FROM auth.users u JOIN tenant_users tu ON tu.user_id = u.id
         WHERE tu.tenant_id = p_tenant_id AND tu.role = 'owner' LIMIT 1;
        IF v_email IS NULL OR v_email LIKE 'deleted\_%@deleted.texacore.local' THEN v_email := '—'; END IF;
    END IF;
    v_provider_label := CASE lower(COALESCE(v_provider,''))
        WHEN 'google' THEN '🔵 Google' WHEN 'email' THEN '✉️ بريد وكلمة مرور'
        WHEN '' THEN NULL ELSE v_provider END;
    v_lang_label := CASE lower(COALESCE(v_lang,''))
        WHEN 'ar' THEN 'العربية' WHEN 'en' THEN 'English'
        WHEN 'ru' THEN 'Русский' WHEN 'uk' THEN 'Українська' ELSE NULL END;

    -- ═══ 6c. الموقع (حسب IP — قد يكون VPN) + الوقت المحلي ═══
    v_ip_country := COALESCE(NULLIF(v_tenant.registration_country_code,''), NULLIF(v_tenant.last_seen_country,''), '');
    v_ip := COALESCE(NULLIF(v_tenant.registration_ip::text,''), NULLIF(v_tenant.last_seen_ip::text,''), '');
    IF COALESCE(v_tenant.registration_city,'') <> '' OR COALESCE(v_tenant.last_seen_city,'') <> '' THEN
        v_loc := COALESCE(NULLIF(v_tenant.registration_city,''), v_tenant.last_seen_city);
    END IF;
    IF v_ip_country <> '' THEN
        v_loc := NULLIF(trim(both ' ·' FROM concat_ws(' · ', NULLIF(v_loc,''), v_ip_country)), '');
    END IF;
    v_local_time := to_char(now() AT TIME ZONE COALESCE(NULLIF(v_tenant.timezone,''),'UTC'), 'HH24:MI');

    -- ═══ بناء Metadata ═══
    v_notif_metadata := jsonb_build_object(
        'tenant_id', p_tenant_id,
        'tenant_code', v_tenant.code,
        'tenant_name', COALESCE(v_tenant.name, ''),
        'owner_name', COALESCE(v_tenant.owner_name, v_tenant.name, ''),
        'owner_email', v_email,
        'phone', COALESCE(v_phone, ''),
        'country', COALESCE(v_tenant.country, ''),
        'product_name', COALESCE(v_product_name, 'TexaCore'),
        'product_code', COALESCE(v_product_code, 'texacore'),
        'plan_name', COALESCE(v_plan_name, ''),
        'plan_code', COALESCE(v_plan_code, ''),
        'plan_price', COALESCE(v_plan_price, 0),
        'plan_type', COALESCE(v_plan_type, ''),
        'sub_status', COALESCE(v_sub_status, ''),
        'sub_end_date', v_sub_end_date,
        'trial_days', COALESCE(v_trial_days, 0),
        'modules_count', COALESCE(v_modules_count, 0),
        'users_count', COALESCE(v_users_count, 0),
        'companies_count', COALESCE(v_companies_count, 0),
        'registered_at', NOW(),
        'provider', COALESCE(v_provider, ''),
        'language', COALESCE(v_lang, ''),
        'ip_location', COALESCE(v_loc, ''),
        'ip', COALESCE(v_ip, ''),
        'timezone', COALESCE(v_tenant.timezone, ''),
        'version_channel', 'cloud'
    );

    -- ═══ بناء نص الإشعار ═══
    v_notif_body :=
        '👤 ' || COALESCE(v_tenant.owner_name, v_tenant.name, 'غير محدد') || E'\n'
        || '📧 ' || v_email || E'\n'
        || CASE WHEN COALESCE(v_phone, '') != ''
            THEN '📱 ' || v_phone || E'\n' ELSE '' END
        || CASE WHEN COALESCE(v_tenant.country, '') != ''
            THEN '🌍 ' || v_tenant.country || E'\n' ELSE '' END
        || '📦 ' || COALESCE(v_plan_name, 'غير محدد')
            || CASE WHEN v_plan_price IS NOT NULL THEN ' ($' || v_plan_price || ')' ELSE '' END || E'\n'
        || '🏗️ ' || COALESCE(v_product_name, 'TexaCore') || E'\n'
        || '💻 النسخة: ☁️ سحابية' || E'\n'
        || '📊 ' || COALESCE(v_modules_count::TEXT, '0') || ' موديول';

    -- ═══ إرسال الإشعارات الداخلية ═══
    FOR v_admin_user_id IN
        SELECT tu.user_id FROM tenant_users tu
        WHERE tu.tenant_id = v_admin_tenant_id AND tu.role = 'owner'
    LOOP
        -- جدول notifications (يستخدم company_id كـ tenant_id)
        INSERT INTO notifications (
            tenant_id, user_id, title, body,
            type, source_type, source_id, metadata
        ) VALUES (
            v_admin_company_id,  -- ← company_id لأن FK يشير لـ companies
            v_admin_user_id,
            '🆕 مشترك جديد — ' || COALESCE(v_tenant.name, 'بدون اسم')
                || ' | 🆕 New Subscriber — ' || COALESCE(v_tenant.name, 'Unknown'),
            v_notif_body,
            'success',
            'new_subscriber',
            p_tenant_id,
            v_notif_metadata
        );

        -- جدول in_app_notifications
        INSERT INTO in_app_notifications (
            tenant_id, user_id, title, message,
            notification_type, priority, icon, color,
            action_url, action_text
        ) VALUES (
            v_admin_tenant_id,
            v_admin_user_id,
            '🆕 مشترك جديد — ' || COALESCE(v_tenant.name, 'بدون اسم'),
            v_notif_body,
            'new_subscriber',
            'high',
            'user-plus',
            'emerald',
            '/saas/subscribers',
            'عرض المشتركين'
        );
    END LOOP;

    -- ═══ إرسال إشعار تلغرام مفصّل ═══
    SELECT c.integrations->'telegram'->>'bot_token' INTO v_bot_token
    FROM companies c
    WHERE c.tenant_id = v_admin_tenant_id
    AND c.integrations->'telegram'->>'bot_token' IS NOT NULL
    LIMIT 1;

    IF v_bot_token IS NOT NULL THEN
        v_tg_message := E'🆕 <b>مشترك جديد في ' || COALESCE(v_product_name, 'المنصة') || E'</b>\n\n'
            || E'👤 <b>الاسم:</b> ' || COALESCE(v_tenant.owner_name, v_tenant.name, 'غير محدد') || E'\n'
            || E'📧 <b>البريد:</b> ' || v_email || E'\n'
            || CASE WHEN v_provider_label IS NOT NULL THEN E'🔑 <b>طريقة التسجيل:</b> ' || v_provider_label || E'\n' ELSE '' END
            || CASE WHEN v_lang_label IS NOT NULL THEN E'🗣️ <b>اللغة:</b> ' || v_lang_label || E'\n' ELSE '' END
            || CASE WHEN COALESCE(v_phone, '') != ''
                THEN E'📱 <b>الهاتف:</b> ' || v_phone || E'\n' ELSE '' END
            || CASE WHEN COALESCE(v_tenant.country, '') != ''
                THEN E'🌍 <b>الدولة:</b> ' || v_tenant.country || E'\n' ELSE '' END
            || CASE WHEN COALESCE(v_loc, '') <> ''
                THEN E'📍 <b>موقع الاتصال:</b> ' || v_loc || E' <i>(قد يكون VPN)</i>\n' ELSE '' END
            || CASE WHEN COALESCE(v_ip, '') <> ''
                THEN E'🌐 <b>IP:</b> <code>' || v_ip || E'</code>\n' ELSE '' END
            || E'🕐 <b>التوقيت المحلي:</b> ' || v_local_time || ' (' || COALESCE(NULLIF(v_tenant.timezone,''),'UTC') || E')\n'
            || E'🏢 <b>المنشأة:</b> ' || COALESCE(v_tenant.name, 'غير محدد') || E'\n'
            || E'\n'
            || E'━━━━━━━━━━━━━━━━━━━\n'
            || E'📦 <b>الباقة:</b> ' || COALESCE(v_plan_name, 'غير محدد')
                || CASE WHEN v_plan_price IS NOT NULL THEN ' ($' || v_plan_price || '/شهر)' ELSE '' END || E'\n'
            || E'🏗️ <b>المنصة:</b> ' || COALESCE(v_product_name, 'TexaCore') || E'\n'
            || E'💻 <b>النسخة:</b> ☁️ سحابية (Cloud)\n'
            || E'💡 <b>النوع:</b> ' || CASE
                WHEN v_sub_status = 'trial' THEN 'تجريبي (' || COALESCE(v_trial_days::TEXT, '30') || ' يوم) ⏳'
                WHEN v_sub_status = 'active' AND v_plan_type = 'free' THEN 'مجاني 🆓'
                WHEN v_sub_status = 'active' THEN 'مدفوع ✅'
                ELSE COALESCE(v_sub_status, 'غير محدد')
            END || E'\n'
            || CASE WHEN v_sub_end_date IS NOT NULL
                THEN E'📅 <b>ينتهي:</b> ' || to_char(v_sub_end_date, 'YYYY-MM-DD') || E'\n' ELSE '' END
            || E'📊 <b>الموديولات:</b> ' || COALESCE(v_modules_count::TEXT, '0') || ' موديول' || E'\n'
            || E'👥 <b>المستخدمين:</b> ' || COALESCE(v_users_count::TEXT, '0') || E'\n'
            || E'🏢 <b>الشركات:</b> ' || COALESCE(v_companies_count::TEXT, '0') || E'\n'
            || E'\n'
            || E'━━━━━━━━━━━━━━━━━━━\n'
            || E'🔗 <b>الكود:</b> <code>' || COALESCE(v_tenant.code, '') || E'</code>\n'
            || E'📅 <b>التاريخ:</b> ' || to_char(NOW(), 'YYYY-MM-DD HH24:MI') || E'\n'
            || CASE WHEN regexp_replace(COALESCE(v_phone,''),'[^0-9]','','g') <> ''
                THEN E'💬 <a href="https://wa.me/' || regexp_replace(COALESCE(v_phone,''),'[^0-9]','','g') || E'">مراسلة عبر واتساب</a>\n' ELSE '' END
            || E'🔗 <a href="' || v_admin_url || E'">فتح لوحة المشتركين</a>\n\n'
            || E'🔔 <i>TexaCore SaaS Platform</i>';

        FOR v_conn IN
            SELECT tc.telegram_chat_id
            FROM telegram_connections tc
            WHERE tc.company_id IN (SELECT id FROM companies WHERE tenant_id = v_admin_tenant_id)
            AND tc.is_active = true
            AND (tc.notification_role = 'tenant_owner' OR tc.notification_role = 'owner')
        LOOP
            v_tg_url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage';
            PERFORM net.http_post(
                url := v_tg_url,
                headers := '{"Content-Type": "application/json"}'::jsonb,
                body := jsonb_build_object(
                    'chat_id', v_conn.telegram_chat_id::bigint,
                    'text', v_tg_message,
                    'parse_mode', 'HTML'
                ),
                timeout_milliseconds := 20000
            );
        END LOOP;
    END IF;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- (ب) إشعار تثبيت نسخة محلية جديدة (تلغرام + داخلي)
--     يُستدعى مرة واحدة لكل جهاز جديد؛ يبتلع أخطاءه كي لا يكسر التسجيل.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_new_local_install_notification(p_license_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'licensing', 'pg_temp'
AS $function$
DECLARE
    v_admin_tenant_id UUID := '681aa0e4-7692-4337-a3e8-2c127f80e573';
    v_admin_company_id UUID;
    v_admin_user_id UUID;
    v_lic RECORD;
    v_bot_token TEXT;
    v_tg_message TEXT;
    v_conn RECORD;
    v_notif_body TEXT;
    v_tier_label TEXT;
    v_admin_url CONSTANT TEXT := 'https://app.texacore.ai/saas/licensing';
BEGIN
    SELECT * INTO v_lic FROM licensing.licenses WHERE id = p_license_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT id INTO v_admin_company_id FROM companies
    WHERE tenant_id = v_admin_tenant_id
    ORDER BY created_at LIMIT 1;
    IF v_admin_company_id IS NULL THEN RETURN; END IF;

    v_tier_label := CASE v_lic.tier
        WHEN 'free' THEN 'مجاني 🆓'
        WHEN 'trial' THEN 'تجريبي ⏳'
        WHEN 'basic' THEN 'أساسي'
        WHEN 'starter' THEN 'ستارتر'
        WHEN 'pro' THEN 'احترافي'
        WHEN 'enterprise' THEN 'مؤسسات'
        ELSE COALESCE(v_lic.tier, 'غير محدد') END;

    v_notif_body :=
        '💻 النسخة: 🖥️ محلية (Desktop)' || E'\n'
        || '🔑 ' || COALESCE(v_lic.license_key, '—') || E'\n'
        || '📦 ' || v_tier_label || E'\n'
        || CASE WHEN COALESCE(v_lic.hostname,'') <> '' THEN '🖥️ ' || v_lic.hostname || E'\n' ELSE '' END
        || CASE WHEN COALESCE(v_lic.os_info,'') <> '' THEN '⚙️ ' || v_lic.os_info || E'\n' ELSE '' END
        || CASE WHEN COALESCE(v_lic.app_version,'') <> '' THEN '📱 v' || v_lic.app_version ELSE '' END;

    -- إشعارات داخلية لمالكي الحساب الإداري
    FOR v_admin_user_id IN
        SELECT tu.user_id FROM tenant_users tu
        WHERE tu.tenant_id = v_admin_tenant_id AND tu.role = 'owner'
    LOOP
        INSERT INTO notifications (
            tenant_id, user_id, title, body,
            type, source_type, source_id, metadata
        ) VALUES (
            v_admin_company_id,
            v_admin_user_id,
            '🖥️ تثبيت نسخة محلية جديدة | New Desktop Install',
            v_notif_body,
            'success',
            'new_local_install',
            p_license_id,
            jsonb_build_object(
                'license_id', p_license_id,
                'license_key', COALESCE(v_lic.license_key, ''),
                'tier', COALESCE(v_lic.tier, ''),
                'hostname', COALESCE(v_lic.hostname, ''),
                'os_info', COALESCE(v_lic.os_info, ''),
                'app_version', COALESCE(v_lic.app_version, ''),
                'hardware_id', COALESCE(v_lic.hardware_id, ''),
                'registered_at', NOW(),
                'version_channel', 'local'
            )
        );

        INSERT INTO in_app_notifications (
            tenant_id, user_id, title, message,
            notification_type, priority, icon, color,
            action_url, action_text
        ) VALUES (
            v_admin_tenant_id,
            v_admin_user_id,
            '🖥️ تثبيت نسخة محلية جديدة',
            v_notif_body,
            'new_local_install',
            'high',
            'monitor',
            'blue',
            '/saas/licensing',
            'عرض التراخيص'
        );
    END LOOP;

    -- تلغرام
    SELECT c.integrations->'telegram'->>'bot_token' INTO v_bot_token
    FROM companies c
    WHERE c.tenant_id = v_admin_tenant_id
    AND c.integrations->'telegram'->>'bot_token' IS NOT NULL
    LIMIT 1;

    IF v_bot_token IS NOT NULL THEN
        v_tg_message := E'🖥️ <b>تثبيت نسخة محلية جديدة — TexaCore Desktop</b>\n\n'
            || E'💻 <b>النسخة:</b> 🖥️ محلية (Desktop)\n'
            || E'📦 <b>الفئة:</b> ' || v_tier_label || E'\n'
            || E'🔑 <b>الترخيص:</b> <code>' || COALESCE(v_lic.license_key, '—') || E'</code>\n'
            || CASE WHEN COALESCE(v_lic.hostname,'') <> ''
                THEN E'🖥️ <b>الجهاز:</b> ' || v_lic.hostname || E'\n' ELSE '' END
            || CASE WHEN COALESCE(v_lic.os_info,'') <> ''
                THEN E'⚙️ <b>النظام:</b> ' || v_lic.os_info || E'\n' ELSE '' END
            || CASE WHEN COALESCE(v_lic.app_version,'') <> ''
                THEN E'📱 <b>إصدار التطبيق:</b> v' || v_lic.app_version || E'\n' ELSE '' END
            || CASE WHEN v_lic.expires_at IS NOT NULL
                THEN E'📅 <b>ينتهي:</b> ' || to_char(v_lic.expires_at, 'YYYY-MM-DD') || E'\n' ELSE '' END
            || E'\n'
            || E'━━━━━━━━━━━━━━━━━━━\n'
            || E'📅 <b>التاريخ:</b> ' || to_char(NOW(), 'YYYY-MM-DD HH24:MI') || E'\n'
            || E'🔗 <a href="' || v_admin_url || E'">فتح لوحة التراخيص</a>\n\n'
            || E'🔔 <i>TexaCore SaaS Platform</i>';

        FOR v_conn IN
            SELECT tc.telegram_chat_id
            FROM telegram_connections tc
            WHERE tc.company_id IN (SELECT id FROM companies WHERE tenant_id = v_admin_tenant_id)
            AND tc.is_active = true
            AND (tc.notification_role = 'tenant_owner' OR tc.notification_role = 'owner')
        LOOP
            PERFORM net.http_post(
                url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
                headers := '{"Content-Type": "application/json"}'::jsonb,
                body := jsonb_build_object(
                    'chat_id', v_conn.telegram_chat_id::bigint,
                    'text', v_tg_message,
                    'parse_mode', 'HTML'
                ),
                timeout_milliseconds := 20000
            );
        END LOOP;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- الإشعار ثانوي — لا يكسر تسجيل الترخيص أبداً
    NULL;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- (ج) licensing_register_free: إطلاق الإشعار عند جهاز جديد فقط
--     (نفس نصّ 20260625g غير الهدّام + سطر الإشعار في فرع INSERT)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licensing_register_free(
  p_hardware_id text,
  p_hostname    text DEFAULT NULL,
  p_os_info     text DEFAULT NULL,
  p_app_version text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = licensing, public, pg_temp
AS $function$
DECLARE
  v_lic RECORD;  -- [installer-adapt] licensing.* is cloud-only; RECORD (vs %ROWTYPE) lets this create locally. The fn's licensing.licenses DML is runtime-only and this fn is never invoked on the local build (which uses the .tcdb file gate).
  v_key text;
  v_free_modules jsonb := '["dashboard","accounting","inventory","sales","purchases","crm","ai_analytics","workflows","system_config","activity_log"]'::jsonb;
BEGIN
  IF p_hardware_id IS NULL OR length(p_hardware_id) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_hardware_id');
  END IF;

  SELECT * INTO v_lic
    FROM licensing.licenses
   WHERE hardware_id = p_hardware_id AND COALESCE(archived, false) = false
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    -- جهاز معروف: NON-DESTRUCTIVE — علّمه «يعمل مجاناً» دون مسّ الباقة/المفتاح/الحدود.
    -- (لو كان tier=free أصلاً يبقى مجانياً أصيلاً؛ current_mode='free' للباقات المدفوعة المقلوبة.)
    UPDATE licensing.licenses SET
      current_mode = CASE WHEN tier = 'free' THEN NULL ELSE 'free' END,
      last_heartbeat_at = now(),
      hostname    = COALESCE(p_hostname, hostname),
      os_info     = COALESCE(p_os_info, os_info),
      app_version = COALESCE(p_app_version, app_version),
      updated_at  = now()
    WHERE id = v_lic.id RETURNING * INTO v_lic;
  ELSE
    -- جهاز بلا باقة: مجاني أصيل (سطر واحد جديد)
    v_key := 'FREE-2026-'
          || upper(substr(md5(p_hardware_id || clock_timestamp()::text), 1, 5)) || '-'
          || upper(substr(md5(random()::text || p_hardware_id), 1, 5));
    INSERT INTO licensing.licenses (
      license_key, tier, status, hardware_id, binding_type,
      max_users, max_companies, max_warehouses, max_storage_gb, max_transfers,
      enabled_modules, cloud_backup, api_access, custom_branding,
      expires_at, activated_at, last_heartbeat_at, hostname, os_info, app_version, current_mode
    ) VALUES (
      v_key, 'free', 'active', p_hardware_id, 'hardware',
      1, 1, 1, 1, 0,
      v_free_modules, true, false, false,
      TIMESTAMPTZ '2099-12-31 00:00:00+00', now(), now(), p_hostname, p_os_info, p_app_version, NULL
    ) RETURNING * INTO v_lic;

    -- إشعار «تثبيت نسخة محلية جديدة» — مرة واحدة لكل جهاز، ولا يكسر التسجيل
    BEGIN
      PERFORM public.send_new_local_install_notification(v_lic.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'license', jsonb_build_object(
      'license_key', v_lic.license_key, 'tier', v_lic.tier, 'status', v_lic.status,
      'current_mode', v_lic.current_mode, 'expires_at', v_lic.expires_at,
      'enabled_modules', v_lic.enabled_modules,
      'max_users', v_lic.max_users, 'max_companies', v_lic.max_companies,
      'max_warehouses', v_lic.max_warehouses, 'max_storage_gb', v_lic.max_storage_gb,
      'cloud_backup', v_lic.cloud_backup
    ));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.licensing_register_free(text,text,text,text) TO anon;
-- لا GRANT لدالة الإشعار — تُستدعى داخلياً فقط عبر SECURITY DEFINER
REVOKE EXECUTE ON FUNCTION public.send_new_local_install_notification(uuid) FROM anon, authenticated, public;
