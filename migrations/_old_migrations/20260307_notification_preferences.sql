-- ═══════════════════════════════════════════════════════════
-- Add notification_preferences JSONB to telegram_connections
-- ═══════════════════════════════════════════════════════════

-- 1. Add notification_preferences column
ALTER TABLE telegram_connections
ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}'::jsonb;

-- 2. Add comment for documentation
COMMENT ON COLUMN telegram_connections.notification_preferences IS 
'User-specific notification preferences. Keys are event types (e.g. receipt_order, payment_received), values are boolean. Empty = use role defaults.';

-- 3. Notify PostgREST to refresh schema
NOTIFY pgrst, 'reload schema';
