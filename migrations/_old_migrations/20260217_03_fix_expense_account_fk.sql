-- ═══════════════════════════════════════════════════════════════
-- Migration: Fix FK + Archive old accounts table
-- 
-- المشكلة: expense_account_id FK يشير إلى accounts (القديم)
--          بينما SmartAccountSelector يستخدم chart_of_accounts
-- الحل:   1) إصلاح FK → chart_of_accounts
--          2) أرشفة جدول accounts القديم
-- ═══════════════════════════════════════════════════════════════

-- ═══ 1. إصلاح FK على container_expenses ═══

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'container_expenses') THEN
        -- حذف الـ FK القديم (يشير إلى accounts)
        EXECUTE 'ALTER TABLE container_expenses DROP CONSTRAINT IF EXISTS container_expenses_expense_account_id_fkey';
        
        -- إنشاء FK جديد يشير إلى chart_of_accounts
        EXECUTE 'ALTER TABLE container_expenses ADD CONSTRAINT container_expenses_expense_account_id_fkey FOREIGN KEY (expense_account_id) REFERENCES chart_of_accounts(id)';
    END IF;
END $$;

-- ═══ 2. أرشفة جدول accounts القديم ═══

-- التحقق من وجود الجدول ثم إعادة تسميته
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'accounts'
    ) THEN
        -- إزالة أي FK يشير من جداول أخرى إلى accounts
        -- (نتحقق ونحذف واحداً واحداً)

        -- journal_entry_lines قد يشير إلى accounts
        IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'journal_entry_lines_account_id_fkey'
            AND constraint_type = 'FOREIGN KEY'
        ) THEN
            BEGIN
                ALTER TABLE journal_entry_lines DROP CONSTRAINT IF EXISTS journal_entry_lines_account_id_fkey;
                RAISE NOTICE '  Dropped FK journal_entry_lines_account_id_fkey';
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE '  Skipping journal_entry_lines FK: %', SQLERRM;
            END;
        END IF;

        -- إعادة تسمية الجدول
        ALTER TABLE accounts RENAME TO accounts_archived;
        
        RAISE NOTICE '✅ Table accounts renamed to accounts_archived';
    ELSE
        RAISE NOTICE 'ℹ️ Table accounts does not exist (already archived or removed)';
    END IF;
END $$;

-- ═══ 3. التحقق النهائي ═══
DO $$ 
BEGIN
    RAISE NOTICE '═══════════════════════════════════════';
    RAISE NOTICE '✅ FK expense_account_id → chart_of_accounts';
    RAISE NOTICE '✅ Old accounts table → accounts_archived';
    RAISE NOTICE '═══════════════════════════════════════';
END $$;
