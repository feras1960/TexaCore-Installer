-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: Add is_active column to user_profiles
-- ═══════════════════════════════════════════════════════════════════════════

-- Add is_active column if it doesn't exist
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Update existing rows to be active
UPDATE user_profiles SET is_active = true WHERE is_active IS NULL;

-- Reload schema
NOTIFY pgrst, 'reload schema';

SELECT 'is_active column added to user_profiles' as status;
