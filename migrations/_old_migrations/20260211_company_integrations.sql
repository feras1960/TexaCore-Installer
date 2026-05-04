-- ═══════════════════════════════════════════════════════════════
-- إضافة حقل إعدادات التكاملات على جدول الشركات
-- 2026-02-11
-- ═══════════════════════════════════════════════════════════════

-- إضافة عمود integrations لحفظ بيانات التكاملات الخارجية
ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS integrations JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN companies.integrations IS 'إعدادات التكاملات الخارجية — Nova Poshta, Gemini AI, etc.';

-- ═══════════════════════════════════════════════════════════════
-- البنية المتوقعة لحقل integrations:
-- {
--   "nova_poshta": {
--     "api_key": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
--     "sender_ref": "UUID",
--     "sender_city_ref": "UUID",
--     "sender_address_ref": "UUID",
--     "sender_contact_ref": "UUID",
--     "sender_phone": "+380XXXXXXXXX"
--   },
--   "gemini": {
--     "enabled": true,
--     "model": "gemini-2.0-flash"
--   }
-- }
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
    RAISE NOTICE '✅ تم إضافة/تحديث حقل integrations على جدول companies';
END $$;
