-- ════════════════════════════════════════════════════════════════════
-- 20260714b — إشعار التثبيت المحلي بالموقع والـIP (عبر edge licensing-notify)
-- ════════════════════════════════════════════════════════════════════
-- [نسخة المُثبِّت — مُكيَّفة] هذه دوال جهة السحابة: تعرّف نوعها في DECLARE على
-- licensing.licenses%ROWTYPE، وهو يُحلَّل وقت تصريف الدالة (CREATE)، فيتعطّل على
-- النسخة المحلية التي لا مخطط licensing فيها بـ«schema licensing does not exist».
-- لذا نُغلّف الإنشاء داخل حارس: يُطبَّق فقط عند وجود مخطط licensing (السحابة)،
-- وإلا يُتخطّى بأمان على النسخة المحلية (لا تسجيل مجاني محلي — الترخيص سحابيّ).
-- المنطق الأصلي محفوظ حرفياً داخل EXECUTE.
-- ════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'licensing') THEN
    RAISE NOTICE '20260714b: مخطط licensing غير موجود (نسخة محلية) — تخطٍّ آمن لدوال السحابة';
    RETURN;
  END IF;

  -- ── (أ) بوابة المطالبة: مرة واحدة لكل ترخيص، service_role فقط ──
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION public.licensing_notify_claim(p_license_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = licensing, public, pg_temp
AS $function$
DECLARE
  v_lic licensing.licenses%ROWTYPE;
BEGIN
  UPDATE licensing.licenses
     SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('install_notified_at', now()),
         updated_at = now()
   WHERE id = p_license_id
     AND (meta IS NULL OR meta->>'install_notified_at' IS NULL)
   RETURNING * INTO v_lic;

  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'license_key', v_lic.license_key,
    'tier', v_lic.tier,
    'status', v_lic.status,
    'hostname', v_lic.hostname,
    'os_info', v_lic.os_info,
    'app_version', v_lic.app_version,
    'hardware_id', v_lic.hardware_id,
    'expires_at', v_lic.expires_at,
    'enabled_modules', v_lic.enabled_modules,
    'max_users', v_lic.max_users,
    'max_companies', v_lic.max_companies,
    'max_warehouses', v_lic.max_warehouses,
    'max_storage_gb', v_lic.max_storage_gb,
    'current_mode', v_lic.current_mode
  );
END;
$function$;
  $sql$;

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.licensing_notify_claim(uuid) FROM anon, authenticated, public';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.licensing_notify_claim(uuid) TO service_role';

  -- ── (ب) licensing_register_free: التقاط IP + إطلاق الدالة الطرفية ──
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION public.licensing_register_free(
  p_hardware_id text,
  p_hostname    text DEFAULT NULL,
  p_os_info     text DEFAULT NULL,
  p_app_version text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = licensing, public, extensions, pg_temp
AS $function$
DECLARE
  v_lic licensing.licenses%ROWTYPE;
  v_key text;
  v_free_modules jsonb := '["dashboard","accounting","inventory","sales","purchases","crm","ai_analytics","workflows","system_config","activity_log"]'::jsonb;
  v_headers jsonb;
  v_ip text := '';
  v_cf_country text := '';
  v_anon CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2tsZW5mc2FlcGVneW1meGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTIxNzcsImV4cCI6MjA4NDMyODE3N30.ATYSK_WvOfbqEaInbg5nKau-wgixF0lIGaue3m8AJtI';
BEGIN
  IF p_hardware_id IS NULL OR length(p_hardware_id) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_hardware_id');
  END IF;

  -- IP المثبّت من ترويسات PostgREST (أول عنوان في x-forwarded-for)
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
    v_ip := trim(split_part(COALESCE(v_headers->>'x-forwarded-for', v_headers->>'cf-connecting-ip', ''), ',', 1));
    v_cf_country := COALESCE(v_headers->>'cf-ipcountry', '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := ''; v_cf_country := '';
  END;

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
      meta        = COALESCE(meta, '{}'::jsonb)
                    || CASE WHEN v_ip <> '' THEN jsonb_build_object('last_ip', v_ip) ELSE '{}'::jsonb END,
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
      expires_at, activated_at, last_heartbeat_at, hostname, os_info, app_version, current_mode,
      meta
    ) VALUES (
      v_key, 'free', 'active', p_hardware_id, 'hardware',
      1, 1, 1, 1, 0,
      v_free_modules, true, false, false,
      TIMESTAMPTZ '2099-12-31 00:00:00+00', now(), now(), p_hostname, p_os_info, p_app_version, NULL,
      jsonb_strip_nulls(jsonb_build_object(
        'registration_ip', NULLIF(v_ip, ''),
        'registration_country', NULLIF(v_cf_country, '')
      ))
    ) RETURNING * INTO v_lic;

    -- إشعار «تثبيت نسخة محلية جديدة» عبر edge (geo + تلغرام + داخلي) — لا يكسر التسجيل
    BEGIN
      PERFORM net.http_post(
        url := 'https://wzkklenfsaepegymfxfz.supabase.co/functions/v1/licensing-notify',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon,
          'apikey', v_anon
        ),
        body := jsonb_build_object('license_id', v_lic.id, 'ip', v_ip),
        timeout_milliseconds := 20000
      );
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
  $sql$;

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.licensing_register_free(text,text,text,text) TO anon';

  -- ── (ج) حذف المرسل القديم بلا geo — حلّت محله licensing-notify ──
  EXECUTE 'DROP FUNCTION IF EXISTS public.send_new_local_install_notification(uuid)';

  RAISE NOTICE '20260714b: دوال licensing طُبّقت (بيئة سحابية)';
END $guard$;
