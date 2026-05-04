-- ════════════════════════════════════════════════════════════════
-- 📢 Platform Announcements + Dismissed Tracking
-- ════════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════

-- 1. Platform Announcements (SaaS-level, no tenant_id)
CREATE TABLE IF NOT EXISTS platform_announcements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Content
    title_ar TEXT NOT NULL DEFAULT '',
    title_en TEXT NOT NULL DEFAULT '',
    message_ar TEXT NOT NULL,
    message_en TEXT NOT NULL,
    
    -- Type & Priority
    announcement_type TEXT NOT NULL DEFAULT 'info' 
        CHECK (announcement_type IN ('urgent', 'maintenance', 'update', 'feature', 'promotion', 'legal', 'info')),
    priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    
    -- Visual
    bg_color TEXT DEFAULT '#047857',        -- green default
    text_color TEXT DEFAULT '#ffffff',
    icon TEXT DEFAULT 'info',               -- lucide icon name
    
    -- CTA (Call to Action)
    cta_text_ar TEXT,
    cta_text_en TEXT,
    cta_link TEXT,
    
    -- Targeting
    target_audience TEXT NOT NULL DEFAULT 'all' 
        CHECK (target_audience IN ('all', 'trial', 'paid', 'expired', 'specific')),
    target_tenant_ids UUID[] DEFAULT '{}',  -- for 'specific' targeting
    
    -- Schedule
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ,                    -- NULL = no end date
    
    -- Behavior
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_dismissable BOOLEAN NOT NULL DEFAULT true,
    animation_type TEXT NOT NULL DEFAULT 'scroll' 
        CHECK (animation_type IN ('scroll', 'static', 'blink')),
    
    -- Meta
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Dismissed Announcements (tracks which user dismissed which announcement)
CREATE TABLE IF NOT EXISTS dismissed_announcements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    announcement_id UUID NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
    dismissed_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, announcement_id)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_platform_announcements_active 
    ON platform_announcements(is_active, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_type 
    ON platform_announcements(announcement_type);

CREATE INDEX IF NOT EXISTS idx_dismissed_announcements_user 
    ON dismissed_announcements(user_id);

-- 4. RLS Policies
ALTER TABLE platform_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissed_announcements ENABLE ROW LEVEL SECURITY;

-- Platform announcements: everyone can read active ones, only super admins can write
CREATE POLICY "Anyone can read active platform announcements"
    ON platform_announcements FOR SELECT
    USING (is_active = true AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW()));

CREATE POLICY "Super admins can manage platform announcements"
    ON platform_announcements FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE user_profiles.id = auth.uid() 
            AND user_profiles.role = 'super_admin'
        )
    );

-- Dismissed: users can manage their own dismissals
CREATE POLICY "Users can read own dismissed announcements"
    ON dismissed_announcements FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can dismiss announcements"
    ON dismissed_announcements FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can un-dismiss announcements"
    ON dismissed_announcements FOR DELETE
    USING (user_id = auth.uid());

-- 5. Updated_at trigger
CREATE OR REPLACE FUNCTION update_platform_announcements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_platform_announcements_updated_at
    BEFORE UPDATE ON platform_announcements
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_announcements_updated_at();
