-- ══════════════════════════════════════════════════════════════
-- 🔒 حماية العملة الأساسية - Prevent Base Currency Change
-- يمنع تغيير العملة الأساسية بعد وجود قيود محاسبية
-- ══════════════════════════════════════════════════════════════

-- 1) Trigger Function: منع تغيير العملة الأساسية للشركة
CREATE OR REPLACE FUNCTION prevent_base_currency_change()
RETURNS trigger AS $$
DECLARE
    has_entries BOOLEAN;
BEGIN
    -- فقط عند تغيير العملة الأساسية
    IF OLD.default_currency IS DISTINCT FROM NEW.default_currency THEN
        -- هل يوجد قيود محاسبية لهذه الشركة؟
        SELECT EXISTS (
            SELECT 1 FROM journal_entries 
            WHERE company_id = NEW.id
            LIMIT 1
        ) INTO has_entries;
        
        IF has_entries THEN
            RAISE EXCEPTION 'Cannot change base currency after journal entries exist. Current: %, Attempted: %',
                OLD.default_currency, NEW.default_currency;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_prevent_base_currency_change ON companies;

-- 3) Create trigger on companies table
CREATE TRIGGER trg_prevent_base_currency_change
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION prevent_base_currency_change();

-- 4) Trigger Function: منع تغيير base_currency في accounting_settings
CREATE OR REPLACE FUNCTION prevent_settings_base_currency_change()
RETURNS trigger AS $$
DECLARE
    has_entries BOOLEAN;
BEGIN
    IF OLD.base_currency IS DISTINCT FROM NEW.base_currency THEN
        SELECT EXISTS (
            SELECT 1 FROM journal_entries 
            WHERE company_id = NEW.company_id
            LIMIT 1
        ) INTO has_entries;
        
        IF has_entries THEN
            RAISE EXCEPTION 'Cannot change base currency in accounting settings after journal entries exist. Current: %, Attempted: %',
                OLD.base_currency, NEW.base_currency;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5) Drop existing trigger if any
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'company_accounting_settings') THEN
        DROP TRIGGER IF EXISTS trg_prevent_settings_base_currency_change ON company_accounting_settings;
        
        -- 6) Create trigger on company_accounting_settings table
        EXECUTE 'CREATE TRIGGER trg_prevent_settings_base_currency_change
            BEFORE UPDATE ON company_accounting_settings
            FOR EACH ROW
            EXECUTE FUNCTION prevent_settings_base_currency_change()';
    END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- ✅ حالة التنفيذ - Execution Status
-- ══════════════════════════════════════════════════════════════
-- 📅 تاريخ التنفيذ: 2026-02-11T00:17:00Z
-- ✅ الحالة: تم التنفيذ بنجاح
-- 🎯 النتيجة: تم إنشاء Trigger على جدولي companies و company_accounting_settings
-- 🔒 الحماية: يمنع تغيير العملة الأساسية بعد وجود قيود محاسبية
--
-- للتحقق:
-- SELECT trigger_name, event_object_table
-- FROM information_schema.triggers
-- WHERE trigger_name LIKE '%currency%';
--
-- النتيجة المتوقعة:
-- trg_prevent_base_currency_change          | companies
-- trg_prevent_settings_base_currency_change | company_accounting_settings
