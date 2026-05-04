-- ═══════════════════════════════════════════════════════════════════
-- 🔔 Exchange Settings — Add Notification JSONB Columns
-- TexaCore ERP — Migration: 2026-03-21
-- 
-- Adds notification configuration columns + AI column
-- ═══════════════════════════════════════════════════════════════════

-- الإشعارات
ALTER TABLE public.exchange_settings 
    ADD COLUMN IF NOT EXISTS notification_channels JSONB DEFAULT '{"telegram":true,"whatsapp":false,"email":false,"in_app":true}',
    ADD COLUMN IF NOT EXISTS remittance_notifications JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS exchange_notifications JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT false;
