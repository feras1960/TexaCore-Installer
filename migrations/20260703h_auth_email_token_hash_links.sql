-- ════════════════════════════════════════════════════════════════
-- Auth Email Hook — روابط recovery/magiclink بنمط token_hash العالمي
--
-- المشكلة: روابط /auth/v1/verify?token=pkce_... تعمل فقط في نفس المتصفح
-- الذي طلب الاستعادة (فخ PKCE)، وطلبات بلا redirectTo كانت تهبط على
-- texacore.ai الرئيسية بلا معالج (Site URL). الحل لعلامة TexaCore:
-- recovery/magiclink يذهبان مباشرة إلى app.texacore.ai/login حاملَين
-- token_hash، والصفحة تستدعي verifyOtp() — يعمل من أي جهاز/متصفح.
--
-- ⚠️ يُطبَّق فقط بعد نشر Login.tsx الداعم لـtoken_hash على app.texacore.ai.
-- علامة Tkanex تبقى على /auth/v1/verify مع redirect إلى tkanex.com/auth/reset
-- (صفحتها الخاصة). بقية الأنواع تبقى على verify مع تصحيح الاحتياطي:
-- texacore.ai (فيه جسر AuthBridge) بدل supabase.co.
--
-- هذه النسخة مبنية على التعريف الحيّ (multi-brand + 5 لغات + {{brand}})
-- المسحوب بتاريخ 2026-07-02 — الملف القديم 20260616g كان متأخراً عنه.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.auth_email_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email    text := event->'user'->>'email';
  v_lang     text := lower(COALESCE(event->'user'->'user_metadata'->>'language', event->'user'->'user_metadata'->>'lang', ''));
  v_platform text := lower(COALESCE(event->'user'->'user_metadata'->>'platform', ''));
  v_action   text := COALESCE(event->'email_data'->>'email_action_type', 'signup');
  v_is_tkanex boolean;
  v_kind text; v_dir text; v_icon text; v_url text;
  v_subject text; v_title text; v_intro text; v_btn text; v_note text; v_html text;
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2tsZW5mc2FlcGVneW1meGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTIxNzcsImV4cCI6MjA4NDMyODE3N30.ATYSK_WvOfbqEaInbg5nKau-wgixF0lIGaue3m8AJtI';
  v_base text := 'https://wzkklenfsaepegymfxfz.supabase.co';
  v_app  text := 'https://app.texacore.ai';
  v_brand text; v_wordmark text; v_header_bg text; v_header_fg text;
  v_btn_bg text; v_btn_fg text; v_link text; v_site text; v_footer text; v_tagline text; v_support text;
  v_i18n jsonb := '{
    "activate":{"icon":"🔐",
      "ar":{"s":"🔐 فعّل حسابك","t":"فعّل بريدك الإلكتروني","i":"لتفعيل حسابك في {{brand}} والبدء، اضغط الزر أدناه.","b":"✅ تفعيل الحساب"},
      "en":{"s":"🔐 Activate your account","t":"Verify your email","i":"To activate your {{brand}} account, click below.","b":"✅ Activate account"},
      "ru":{"s":"🔐 Активируйте аккаунт","t":"Подтвердите почту","i":"Чтобы активировать аккаунт {{brand}}, нажмите кнопку.","b":"✅ Активировать"},
      "uk":{"s":"🔐 Активуйте акаунт","t":"Підтвердьте email","i":"Щоб активувати акаунт {{brand}}, натисніть кнопку.","b":"✅ Активувати"},
      "tr":{"s":"🔐 Hesabınızı etkinleştirin","t":"E-postanızı doğrulayın","i":"{{brand}} hesabınızı etkinleştirmek için tıklayın.","b":"✅ Etkinleştir"}},
    "reset":{"icon":"🔑",
      "ar":{"s":"🔑 إعادة تعيين كلمة المرور","t":"إعادة تعيين كلمة المرور","i":"طلبت إعادة تعيين كلمة مرور حسابك في {{brand}}. اضغط لتعيين كلمة مرور جديدة.","b":"🔑 كلمة مرور جديدة"},
      "en":{"s":"🔑 Reset your password","t":"Reset your password","i":"You requested a password reset for your {{brand}} account.","b":"🔑 Set new password"},
      "ru":{"s":"🔑 Сброс пароля","t":"Сброс пароля","i":"Вы запросили сброс пароля для аккаунта {{brand}}.","b":"🔑 Новый пароль"},
      "uk":{"s":"🔑 Скидання пароля","t":"Скидання пароля","i":"Ви запросили скидання пароля для акаунта {{brand}}.","b":"🔑 Встановити пароль"},
      "tr":{"s":"🔑 Şifrenizi sıfırlayın","t":"Şifrenizi sıfırlayın","i":"{{brand}} hesabınız için şifre sıfırlama talebi.","b":"🔑 Yeni şifre"}},
    "signin":{"icon":"🔗",
      "ar":{"s":"🔗 رابط الدخول","t":"تسجيل الدخول","i":"اضغط للدخول إلى حسابك في {{brand}} بأمان.","b":"🔗 تسجيل الدخول"},
      "en":{"s":"🔗 Your sign-in link","t":"Sign in","i":"Click to securely sign in to your {{brand}} account.","b":"🔗 Sign in"},
      "ru":{"s":"🔗 Ссылка для входа","t":"Вход","i":"Нажмите, чтобы войти в аккаунт {{brand}}.","b":"🔗 Войти"},
      "uk":{"s":"🔗 Посилання для входу","t":"Вхід","i":"Натисніть, щоб увійти в акаунт {{brand}}.","b":"🔗 Увійти"},
      "tr":{"s":"🔗 Giriş bağlantınız","t":"Giriş yap","i":"{{brand}} hesabınıza giriş için tıklayın.","b":"🔗 Giriş yap"}},
    "email_change":{"icon":"✉️",
      "ar":{"s":"✉️ تأكيد البريد الجديد","t":"تأكيد البريد الجديد","i":"لتأكيد تغيير بريدك في {{brand}}، اضغط أدناه.","b":"✉️ تأكيد"},
      "en":{"s":"✉️ Confirm new email","t":"Confirm new email","i":"To confirm your email change on {{brand}}, click below.","b":"✉️ Confirm"},
      "ru":{"s":"✉️ Подтвердите почту","t":"Новая почта","i":"Подтвердите смену почты в {{brand}}.","b":"✉️ Подтвердить"},
      "uk":{"s":"✉️ Підтвердьте пошту","t":"Нова пошта","i":"Підтвердьте зміну пошти в {{brand}}.","b":"✉️ Підтвердити"},
      "tr":{"s":"✉️ E-postayı onayla","t":"Yeni e-posta","i":"{{brand}} e-posta değişikliğini onaylayın.","b":"✉️ Onayla"}},
    "invite":{"icon":"📩",
      "ar":{"s":"📩 دعوة","t":"تمت دعوتك","i":"تمت دعوتك للانضمام إلى {{brand}}.","b":"📩 قبول الدعوة"},
      "en":{"s":"📩 You are invited","t":"You are invited","i":"You have been invited to join {{brand}}.","b":"📩 Accept"},
      "ru":{"s":"📩 Приглашение","t":"Вас пригласили","i":"Вас пригласили в {{brand}}.","b":"📩 Принять"},
      "uk":{"s":"📩 Запрошення","t":"Вас запросили","i":"Вас запросили до {{brand}}.","b":"📩 Прийняти"},
      "tr":{"s":"📩 Davet","t":"Davet edildiniz","i":"{{brand}} platformuna davet edildiniz.","b":"📩 Kabul et"}},
    "reauth":{"icon":"🛡️",
      "ar":{"s":"🛡️ تأكيد الهوية","t":"تأكيد هويتك","i":"لإتمام العملية في {{brand}}، أكّد هويتك.","b":"🛡️ تأكيد"},
      "en":{"s":"🛡️ Confirm identity","t":"Confirm identity","i":"To complete this action on {{brand}}, confirm below.","b":"🛡️ Confirm"},
      "ru":{"s":"🛡️ Подтвердите личность","t":"Подтверждение","i":"Подтвердите личность в {{brand}}.","b":"🛡️ Подтвердить"},
      "uk":{"s":"🛡️ Підтвердьте особу","t":"Підтвердження","i":"Підтвердьте особу в {{brand}}.","b":"🛡️ Підтвердити"},
      "tr":{"s":"🛡️ Kimliğinizi doğrulayın","t":"Kimlik doğrulama","i":"{{brand}} işlemini tamamlamak için doğrulayın.","b":"🛡️ Doğrula"}}
  }'::jsonb;
  v_strings jsonb;
BEGIN
  v_is_tkanex := (v_platform = 'tkanex' OR COALESCE(event->'email_data'->>'redirect_to','') ILIKE '%tkanex%');
  -- احتياطي اللغة حسب العلامة: زبائن Tkanex بلا لغة مخزنة → أوكراني (سوقهم)؛
  -- بقية المنصات → إنجليزي (كان uk عالمياً فوصلت رسائل أوكرانية لغير أوكرانيين).
  IF v_lang NOT IN ('ar','en','ru','uk','tr') THEN
    v_lang := CASE WHEN v_is_tkanex THEN 'uk' ELSE 'en' END;
  END IF;
  v_dir := CASE WHEN v_lang='ar' THEN 'rtl' ELSE 'ltr' END;
  IF v_is_tkanex THEN
    v_brand:='Tkanex'; v_wordmark:='TKANEX'; v_header_bg:='#1a1a2e'; v_header_fg:='#ffffff';
    v_btn_bg:='#c8a45a'; v_btn_fg:='#1a1a2e'; v_link:='#c8a45a'; v_site:='tkanex.com';
    v_tagline:='B2B FABRIC MARKETPLACE'; v_footer:='Tkanex — Одеса, Україна · tkanex.com'; v_support:='+380674841211';
  ELSE
    v_brand:='TexaCore'; v_wordmark:='TexaCore'; v_header_bg:='#047857'; v_header_fg:='#ffffff';
    v_btn_bg:='#047857'; v_btn_fg:='#ffffff'; v_link:='#047857'; v_site:='texacore.ai';
    v_tagline:='ENTERPRISE RESOURCE PLANNING'; v_footer:='TexaCore ERP · texacore.ai'; v_support:=NULL;
  END IF;

  -- TexaCore recovery/magiclink: رابط token_hash مباشر لصفحة الدخول —
  -- verifyOtp هناك يعمل من أي جهاز/متصفح بلا فخ PKCE. Tkanex يبقى على
  -- تدفق verify لصفحته /auth/reset. البقية: verify مع احتياطي texacore.ai
  -- (جسر AuthBridge يعالج الهبوط) بدل supabase.co.
  IF NOT v_is_tkanex AND v_action = 'recovery' THEN
    v_url := v_app || '/login?mode=recovery&type=recovery&token_hash=' || (event->'email_data'->>'token_hash');
  ELSIF NOT v_is_tkanex AND v_action = 'magiclink' THEN
    v_url := v_app || '/login?type=magiclink&token_hash=' || (event->'email_data'->>'token_hash');
  ELSE
    v_url := v_base || '/auth/v1/verify?token=' || (event->'email_data'->>'token_hash')
             || '&type=' || v_action
             || '&redirect_to=' || COALESCE(event->'email_data'->>'redirect_to', 'https://texacore.ai');
  END IF;

  v_kind := CASE WHEN v_action='signup' THEN 'activate' WHEN v_action='invite' THEN 'invite'
              WHEN v_action='recovery' THEN 'reset' WHEN v_action LIKE 'email_change%' THEN 'email_change'
              WHEN v_action='magiclink' THEN 'signin' WHEN v_action='reauthentication' THEN 'reauth' ELSE 'activate' END;
  v_icon := v_i18n->v_kind->>'icon';
  v_strings := v_i18n->v_kind->v_lang;
  v_subject := v_brand || ' — ' || (v_strings->>'s');
  v_title := v_strings->>'t';
  v_intro := replace(v_strings->>'i', '{{brand}}', v_brand);
  v_btn := v_strings->>'b';
  v_note := CASE v_lang
    WHEN 'ar' THEN 'إن لم تطلب هذا، تجاهل الرسالة. لا تشارك الرابط.'
    WHEN 'ru' THEN 'Если вы это не запрашивали, проигнорируйте письмо.'
    WHEN 'uk' THEN 'Якщо ви цього не запитували, проігноруйте лист.'
    WHEN 'tr' THEN 'Bu işlemi siz talep etmediyseniz, yok sayın.'
    ELSE 'If you did not request this, ignore this email.' END;
  v_html := '<!DOCTYPE html><html dir="'||v_dir||'" lang="'||v_lang||'"><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;">'
    || '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 20px;"><tr><td align="center">'
    || '<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;">'
    || '<tr><td style="background:'||v_header_bg||';padding:34px;text-align:center;"><div style="font-size:30px;font-weight:900;color:'||v_header_fg||';">'||v_wordmark||'</div><div style="font-size:11px;color:rgba(255,255,255,.7);letter-spacing:2px;">'||v_tagline||'</div></td></tr>'
    || '<tr><td style="text-align:center;padding:30px 40px 4px;font-size:56px;">'||v_icon||'</td></tr>'
    || '<tr><td style="text-align:center;padding:0 40px;"><h1 style="margin:0;font-size:24px;color:#1f2937;">'||v_title||'</h1></td></tr>'
    || '<tr><td style="padding:12px 40px;text-align:center;"><p style="margin:0;font-size:16px;color:#4b5563;line-height:1.8;">'||v_intro||'</p></td></tr>'
    || '<tr><td style="padding:20px 40px;text-align:center;"><a href="'||v_url||'" style="display:inline-block;background:'||v_btn_bg||';color:'||v_btn_fg||';text-decoration:none;padding:16px 50px;border-radius:14px;font-size:17px;font-weight:800;">'||v_btn||'</a></td></tr>'
    || '<tr><td style="padding:0 40px 16px;text-align:center;"><a href="'||v_url||'" style="font-size:11px;color:'||v_link||';word-break:break-all;">'||v_url||'</a></td></tr>'
    || '<tr><td style="padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb;"><p style="margin:0;font-size:12px;color:#9ca3af;">🔒 '||v_note||'</p></td></tr>'
    || CASE WHEN v_support IS NOT NULL THEN '<tr><td style="padding:0 40px 8px;text-align:center;font-size:12px;color:#9ca3af;">📞 '||v_support||'</td></tr>' ELSE '' END
    || '<tr><td style="background:#f9fafb;padding:18px 40px;text-align:center;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">'||v_footer||'</td></tr>'
    || '</table></td></tr></table></body></html>';
  PERFORM net.http_post(
    url := v_base || '/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon,'apikey',v_anon),
    body := jsonb_build_object('to', v_email, 'subject', v_subject, 'html', v_html),
    timeout_milliseconds := 20000
  );
  RETURN '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'auth_email_hook error: %', SQLERRM;
  RETURN '{}'::jsonb;
END;
$$;
GRANT EXECUTE ON FUNCTION public.auth_email_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.auth_email_hook(jsonb) FROM authenticated, anon, public;
