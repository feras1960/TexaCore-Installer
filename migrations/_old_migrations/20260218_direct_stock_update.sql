-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  Migration: Direct Stock Update & User Trade Preferences            ║
-- ║  Date: 2026-02-18                                                   ║
-- ║                                                                     ║
-- ║  الهدف: تمكين تحديث المخزون المباشر عند ترحيل الفاتورة              ║
-- ║  + حفظ تفضيلات المستخدم التجارية (نوع الفاتورة، المستودع، إلخ)       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. purchase_transactions — إضافة أعمدة تحديث المخزون المباشر
-- ═══════════════════════════════════════════════════════════════

-- هل يتم تحديث المخزون مباشرة عند الترحيل؟
ALTER TABLE purchase_transactions 
    ADD COLUMN IF NOT EXISTS auto_update_stock BOOLEAN DEFAULT false;

-- المستودع المستهدف لتحديث المخزون
ALTER TABLE purchase_transactions 
    ADD COLUMN IF NOT EXISTS stock_warehouse_id UUID REFERENCES warehouses(id);

-- معرّف حركة المخزون المرتبطة (للتعديل/الحذف المباشر)
ALTER TABLE purchase_transactions 
    ADD COLUMN IF NOT EXISTS stock_movement_id UUID;

COMMENT ON COLUMN purchase_transactions.auto_update_stock IS 'تحديث المخزون مباشرة عند الترحيل (بدون إذن استلام منفصل)';
COMMENT ON COLUMN purchase_transactions.stock_warehouse_id IS 'المستودع المستهدف لتحديث المخزون المباشر';
COMMENT ON COLUMN purchase_transactions.stock_movement_id IS 'معرّف حركة المخزون المُنشأة عند الترحيل المباشر';


-- ═══════════════════════════════════════════════════════════════
-- 2. sales_transactions — إضافة أعمدة تحديث المخزون المباشر
-- ═══════════════════════════════════════════════════════════════

-- هل يتم تحديث المخزون مباشرة عند الترحيل؟
ALTER TABLE sales_transactions 
    ADD COLUMN IF NOT EXISTS auto_update_stock BOOLEAN DEFAULT false;

-- المستودع المصدر لسحب المخزون
ALTER TABLE sales_transactions 
    ADD COLUMN IF NOT EXISTS stock_warehouse_id UUID REFERENCES warehouses(id);

-- معرّف حركة المخزون المرتبطة (للتعديل/الحذف المباشر)
ALTER TABLE sales_transactions 
    ADD COLUMN IF NOT EXISTS stock_movement_id UUID;

COMMENT ON COLUMN sales_transactions.auto_update_stock IS 'تحديث المخزون مباشرة عند الترحيل (بدون إذن تسليم منفصل)';
COMMENT ON COLUMN sales_transactions.stock_warehouse_id IS 'المستودع المصدر لسحب المخزون عند الترحيل المباشر';
COMMENT ON COLUMN sales_transactions.stock_movement_id IS 'معرّف حركة المخزون المُنشأة عند الترحيل المباشر';


-- ═══════════════════════════════════════════════════════════════
-- 3. user_table_preferences — إضافة حقل تفضيلات التجارة
-- ═══════════════════════════════════════════════════════════════
-- نستخدم الجدول الموجود (user_table_preferences) مع table_key = 'trade_defaults'
-- في الـ JSONB نخزن:
-- {
--   "purchase_receipt_mode": "direct",           -- محلي أو دولي
--   "purchase_auto_stock": true,                 -- تحديث مخزون تلقائي
--   "purchase_warehouse_id": "uuid...",           -- آخر مستودع
--   "sales_is_pos": false,                       -- POS أو عادي
--   "sales_auto_stock": true,                    -- تحديث مخزون تلقائي
--   "sales_warehouse_id": "uuid..."              -- آخر مستودع
-- }
-- 
-- ملاحظة: لا نحتاج ALTER TABLE لأن الـ column_visibility هو JSONB
-- يمكننا استخدام table_key = 'trade_defaults' مع الحقول الموجودة
-- لكن لإضافة حقل مخصص أوضح:

ALTER TABLE user_table_preferences
    ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_table_preferences.custom_data IS 'بيانات مخصصة إضافية (تفضيلات التجارة، الإعدادات السريعة، إلخ)';


-- ═══════════════════════════════════════════════════════════════
-- 4. فهارس للأداء
-- ═══════════════════════════════════════════════════════════════

-- فهرس للمعاملات مع تحديث مخزون مباشر
CREATE INDEX IF NOT EXISTS idx_pt_auto_stock 
    ON purchase_transactions(auto_update_stock) 
    WHERE auto_update_stock = true;

CREATE INDEX IF NOT EXISTS idx_st_auto_stock 
    ON sales_transactions(auto_update_stock) 
    WHERE auto_update_stock = true;

-- فهرس لربط حركات المخزون
CREATE INDEX IF NOT EXISTS idx_pt_stock_movement 
    ON purchase_transactions(stock_movement_id) 
    WHERE stock_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_st_stock_movement 
    ON sales_transactions(stock_movement_id) 
    WHERE stock_movement_id IS NOT NULL;


COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- التحقق
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_pt_cols INT;
    v_st_cols INT;
    v_utp_cols INT;
BEGIN
    -- التحقق من أعمدة purchase_transactions
    SELECT COUNT(*) INTO v_pt_cols
    FROM information_schema.columns 
    WHERE table_name = 'purchase_transactions' 
    AND column_name IN ('auto_update_stock', 'stock_warehouse_id', 'stock_movement_id');

    -- التحقق من أعمدة sales_transactions
    SELECT COUNT(*) INTO v_st_cols
    FROM information_schema.columns 
    WHERE table_name = 'sales_transactions' 
    AND column_name IN ('auto_update_stock', 'stock_warehouse_id', 'stock_movement_id');

    -- التحقق من عمود user_table_preferences
    SELECT COUNT(*) INTO v_utp_cols
    FROM information_schema.columns 
    WHERE table_name = 'user_table_preferences' 
    AND column_name = 'custom_data';

    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════════';
    RAISE NOTICE '  ✅ Direct Stock Update Migration - Results';
    RAISE NOTICE '═══════════════════════════════════════════════════';
    RAISE NOTICE '  purchase_transactions: % / 3 columns added', v_pt_cols;
    RAISE NOTICE '  sales_transactions:    % / 3 columns added', v_st_cols;
    RAISE NOTICE '  user_table_preferences: % / 1 column added', v_utp_cols;
    
    IF v_pt_cols = 3 AND v_st_cols = 3 AND v_utp_cols = 1 THEN
        RAISE NOTICE '  ✅ ALL COLUMNS VERIFIED SUCCESSFULLY!';
    ELSE
        RAISE NOTICE '  ⚠️ SOME COLUMNS MAY BE MISSING!';
    END IF;
    RAISE NOTICE '═══════════════════════════════════════════════════';
END $$;
