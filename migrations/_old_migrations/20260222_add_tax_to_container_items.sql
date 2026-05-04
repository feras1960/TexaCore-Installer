-- ═══════════════════════════════════════════════════════════════
-- Migration: إضافة أعمدة الضريبة الموزعة لبنود الكونتينر
-- Date: 2026-02-22
-- Purpose: حفظ الضريبة الجمركية الموزعة على كل بند لاستخدامها
--          لاحقاً كضريبة مضافة عند بيع المواد
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'container_items') THEN
        -- نسبة الضريبة المطبقة على البند (مثلاً 5%)
        EXECUTE 'ALTER TABLE container_items ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) DEFAULT 0';

        -- مبلغ الضريبة الموزعة على البند (إجمالي)
        EXECUTE 'ALTER TABLE container_items ADD COLUMN IF NOT EXISTS allocated_tax DECIMAL(15,2) DEFAULT 0';

        -- مبلغ الضريبة لكل وحدة (للاستخدام عند البيع)
        EXECUTE 'ALTER TABLE container_items ADD COLUMN IF NOT EXISTS tax_per_unit DECIMAL(15,4) DEFAULT 0';

        -- توثيق
        EXECUTE 'COMMENT ON COLUMN container_items.tax_rate IS ''نسبة الضريبة الجمركية المطبقة (مثل 5% VAT)''';
        EXECUTE 'COMMENT ON COLUMN container_items.allocated_tax IS ''إجمالي الضريبة الموزعة على هذا البند''';
        EXECUTE 'COMMENT ON COLUMN container_items.tax_per_unit IS ''الضريبة لكل وحدة — تُستخدم كأساس لضريبة المبيعات''';
    END IF;
END $$;

DO $$
BEGIN
    RAISE NOTICE ' ';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ تم إضافة أعمدة تتبع الضريبة لبنود الكونتينر';
    RAISE NOTICE '  • tax_rate     — نسبة الضريبة (%%)';
    RAISE NOTICE '  • allocated_tax — إجمالي الضريبة الموزعة';
    RAISE NOTICE '  • tax_per_unit  — ضريبة الوحدة (للمبيعات)';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;
