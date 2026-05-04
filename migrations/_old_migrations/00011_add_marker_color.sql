-- Migration: إضافة حقل لون الماركر للقيود المحاسبية
-- Purpose: ميزة مطابقة الدفاتر بالألوان (Visual Reconciliation)
-- Date: 2026-01-22

-- إضافة حقل marker_color لجدول journal_entry_lines
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'journal_entry_lines' 
        AND column_name = 'marker_color'
    ) THEN
        ALTER TABLE journal_entry_lines 
        ADD COLUMN marker_color VARCHAR(20) DEFAULT NULL;
        
        COMMENT ON COLUMN journal_entry_lines.marker_color IS 
            'Color marker for visual reconciliation. Values: blue, purple, pink, gray, teal, cyan, yellow, orange, green, or NULL';
    END IF;
END $$;

-- إضافة حقل marker_color لجدول journal_entries (اختياري - للتعليم على مستوى القيد كامل)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'journal_entries' 
        AND column_name = 'marker_color'
    ) THEN
        ALTER TABLE journal_entries 
        ADD COLUMN marker_color VARCHAR(20) DEFAULT NULL;
        
        COMMENT ON COLUMN journal_entries.marker_color IS 
            'Color marker for visual reconciliation at entry level';
    END IF;
END $$;

-- إضافة حقل marker_color لجدول transactions (إذا وجد)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'transactions' 
            AND column_name = 'marker_color'
        ) THEN
            ALTER TABLE transactions 
            ADD COLUMN marker_color VARCHAR(20) DEFAULT NULL;
            
            COMMENT ON COLUMN transactions.marker_color IS 
                'Color marker for visual reconciliation';
        END IF;
    END IF;
END $$;

-- إضافة حقل marked_at لتتبع وقت التعليم
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'journal_entry_lines' 
        AND column_name = 'marked_at'
    ) THEN
        ALTER TABLE journal_entry_lines 
        ADD COLUMN marked_at TIMESTAMPTZ DEFAULT NULL;
        
        COMMENT ON COLUMN journal_entry_lines.marked_at IS 
            'Timestamp when the marker was applied';
    END IF;
END $$;

-- إضافة حقل marked_by لتتبع من قام بالتعليم
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'journal_entry_lines' 
        AND column_name = 'marked_by'
    ) THEN
        ALTER TABLE journal_entry_lines 
        ADD COLUMN marked_by UUID DEFAULT NULL;
        
        COMMENT ON COLUMN journal_entry_lines.marked_by IS 
            'User who applied the marker';
    END IF;
END $$;

-- إنشاء فهرس للبحث السريع حسب لون الماركر
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_marker_color 
ON journal_entry_lines(marker_color) 
WHERE marker_color IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_marker_color 
ON journal_entries(marker_color) 
WHERE marker_color IS NOT NULL;

-- دالة لتحديث الماركر مع تسجيل الوقت والمستخدم
CREATE OR REPLACE FUNCTION update_marker_color()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.marker_color IS DISTINCT FROM OLD.marker_color THEN
        NEW.marked_at = NOW();
        -- marked_by يجب أن يُمرر من التطبيق
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger لتحديث وقت التعليم تلقائياً
DROP TRIGGER IF EXISTS trigger_update_marker_timestamp ON journal_entry_lines;
CREATE TRIGGER trigger_update_marker_timestamp
    BEFORE UPDATE ON journal_entry_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_marker_color();

-- Success message
DO $$ 
BEGIN
    RAISE NOTICE 'Migration 00011_add_marker_color completed successfully';
END $$;
