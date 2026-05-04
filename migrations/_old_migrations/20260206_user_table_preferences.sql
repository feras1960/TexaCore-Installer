-- ═══════════════════════════════════════════════════════════════
-- User Table Preferences - تفضيلات جداول المستخدم
-- ═══════════════════════════════════════════════════════════════
-- يخزن تفضيلات كل مستخدم لكل جدول (الأعمدة المرئية، الأحجام، الترتيب)

-- 1. Create table
CREATE TABLE IF NOT EXISTS user_table_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    table_key VARCHAR(100) NOT NULL,  -- مفتاح الجدول (مثل: journal-entries-table)
    
    -- التفضيلات
    column_visibility JSONB DEFAULT '{}',  -- {"columnId": true/false}
    column_sizing JSONB DEFAULT '{}',      -- {"columnId": width}
    column_order TEXT[] DEFAULT '{}',      -- ["col1", "col2", ...]
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint per user per table
    UNIQUE(user_id, table_key)
);

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_user_table_prefs_user_id ON user_table_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_table_prefs_table_key ON user_table_preferences(table_key);

-- 3. Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_user_table_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_table_preferences_updated_at ON user_table_preferences;
CREATE TRIGGER trigger_user_table_preferences_updated_at
    BEFORE UPDATE ON user_table_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_user_table_preferences_updated_at();

-- 4. Enable RLS
ALTER TABLE user_table_preferences ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies - users can only access their own preferences
DROP POLICY IF EXISTS "user_table_prefs_select" ON user_table_preferences;
CREATE POLICY "user_table_prefs_select" ON user_table_preferences
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_table_prefs_insert" ON user_table_preferences;
CREATE POLICY "user_table_prefs_insert" ON user_table_preferences
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_table_prefs_update" ON user_table_preferences;
CREATE POLICY "user_table_prefs_update" ON user_table_preferences
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_table_prefs_delete" ON user_table_preferences;
CREATE POLICY "user_table_prefs_delete" ON user_table_preferences
    FOR DELETE USING (auth.uid() = user_id);

-- 6. Comment
COMMENT ON TABLE user_table_preferences IS 'User preferences for data tables (column visibility, sizing, order)';

-- Done!
DO $$ BEGIN RAISE NOTICE '✅ user_table_preferences table created successfully'; END $$;
