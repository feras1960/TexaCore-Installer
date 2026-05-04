-- ════════════════════════════════════════════════════════════════
-- إضافة عمود current_stock لدعم نموذج المخزون الثنائي
-- loose_stock = current_stock - SUM(fabric_rolls.current_length)
-- ════════════════════════════════════════════════════════════════

-- 1. إضافة العمود
ALTER TABLE fabric_materials
  ADD COLUMN IF NOT EXISTS current_stock DECIMAL(15,2) DEFAULT 0;

COMMENT ON COLUMN fabric_materials.current_stock IS
  'الكمية الإجمالية بالمتر (سائب + مجرود). loose_stock = current_stock - SUM(rolls)';

-- 2. تعبئة أرصدة تجريبية للمواد الرئيسية
-- بوليستر ساتان — 2000 متر سائب
UPDATE fabric_materials SET current_stock = 2000
WHERE code = 'POLY-SATIN';

-- حرير طبيعي — 500 متر
UPDATE fabric_materials SET current_stock = 500
WHERE code = 'SILK-NATURAL';

-- قطن تويل — 3000 متر
UPDATE fabric_materials SET current_stock = 3000
WHERE code = 'COT-100-TWILL';

-- كتان طبيعي — 1500 متر
UPDATE fabric_materials SET current_stock = 1500
WHERE code = 'LINEN-100';

-- قطن سادة — 2500 متر
UPDATE fabric_materials SET current_stock = 2500
WHERE code = 'COT-100-PLAIN';

-- قطن مصري — 1800 متر
UPDATE fabric_materials SET current_stock = 1800
WHERE code = 'CTN-001';

-- حرير صيني — 800 متر
UPDATE fabric_materials SET current_stock = 800
WHERE code = 'SLK-001';

-- كتان تركي — 1200 متر
UPDATE fabric_materials SET current_stock = 1200
WHERE code = 'LNN-001';

-- بوليستر هندي — 3500 متر
UPDATE fabric_materials SET current_stock = 3500
WHERE code = 'PLY-001';

-- حموي ملون - مربعات أبيض — 4000 متر
UPDATE fabric_materials SET current_stock = 4000
WHERE code = 'GRP-MLCIMQOA-0577-CHECKED-WHITE';

-- حموي ملون - مربعات أحمر — 2500 متر
UPDATE fabric_materials SET current_stock = 2500
WHERE code = 'GRP-MLCIMQOA-0577-CHECKED-RED';

-- حموي ملون - مقلم أبيض — 1000 متر
UPDATE fabric_materials SET current_stock = 1000
WHERE code = 'GRP-MLCIMQOA-0577-STRIPED-WHITE';

-- 3. التحقق
SELECT code, name_ar, current_stock
FROM fabric_materials
WHERE current_stock > 0
ORDER BY current_stock DESC;
