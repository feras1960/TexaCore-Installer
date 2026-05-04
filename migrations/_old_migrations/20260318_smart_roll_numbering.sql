-- ═══════════════════════════════════════════════════════════════
-- Migration: Smart Roll Numbering System
-- نظام ترقيم الرولونات الذكي
-- ═══════════════════════════════════════════════════════════════

-- 1. إضافة حقل الرقم التسلسلي الفريد
ALTER TABLE fabric_rolls
ADD COLUMN IF NOT EXISTS roll_seq INTEGER;

-- 2. إضافة حقل الكود الوصفي المختصر
ALTER TABLE fabric_rolls
ADD COLUMN IF NOT EXISTS roll_code VARCHAR(30);

-- 3. Index للبحث السريع بالرقم التسلسلي
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_seq
ON fabric_rolls(company_id, roll_seq);

-- 4. Index للبحث بالكود الوصفي
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_code
ON fabric_rolls(company_id, roll_code);

-- 5. Trigger لتعيين roll_seq تلقائياً عند الإدراج
CREATE OR REPLACE FUNCTION set_roll_seq()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. Auto-assign roll_seq if not provided
    IF NEW.roll_seq IS NULL THEN
        SELECT COALESCE(MAX(roll_seq), 0) + 1
        INTO NEW.roll_seq
        FROM fabric_rolls
        WHERE company_id = NEW.company_id;
    END IF;

    -- 2. Auto-generate smart roll_number from roll_code + roll_seq
    --    when roll_number is temporary (TEMP-xxx, JIT-xxx, ROLL-xxx)
    --    🔑 This handles offline-created rolls that sync later
    IF NEW.roll_code IS NOT NULL 
       AND NEW.roll_code != '' 
       AND (NEW.roll_number LIKE 'TEMP-%' 
            OR NEW.roll_number LIKE 'JIT-%' 
            OR NEW.roll_number LIKE 'ROLL-%') THEN
        NEW.roll_number := NEW.roll_code || '-' || LPAD(NEW.roll_seq::TEXT, 3, '0');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- حذف الـ trigger القديم إن وُجد ثم إنشاء جديد
DROP TRIGGER IF EXISTS trg_set_roll_seq ON fabric_rolls;
CREATE TRIGGER trg_set_roll_seq
    BEFORE INSERT ON fabric_rolls
    FOR EACH ROW
    EXECUTE FUNCTION set_roll_seq();

-- 6. تعيين أرقام تسلسلية للرولونات الموجودة
-- (يُعيّن بترتيب تاريخ الإنشاء)
WITH numbered AS (
    SELECT id, company_id,
           ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at, id) AS seq
    FROM fabric_rolls
    WHERE roll_seq IS NULL
)
UPDATE fabric_rolls fr
SET roll_seq = n.seq
FROM numbered n
WHERE fr.id = n.id;

-- 7. جعل الحقل NOT NULL بعد تعبئة القيم (مع default)
-- ALTER TABLE fabric_rolls ALTER COLUMN roll_seq SET NOT NULL;
-- سنفعل هذا لاحقاً بعد التأكد من أن كل الرولونات لها قيم

-- 8. Unique constraint per company
-- (سنضيفه بعد التأكد من عدم وجود تكرار)
-- ALTER TABLE fabric_rolls ADD CONSTRAINT fabric_rolls_company_seq_unique UNIQUE (company_id, roll_seq);

SELECT 'Smart Roll Numbering migration completed successfully!' AS status;
