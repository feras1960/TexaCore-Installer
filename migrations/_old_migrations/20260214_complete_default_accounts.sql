-- ═══════════════════════════════════════════════════════════════════════════════
-- الإعدادات الشاملة: جميع الحسابات الافتراضية المطلوبة لبرنامج ERP متكامل
-- Complete Default Accounts — Based on SAP / Oracle / Odoo / ERPNext Standards
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- هذا السكربت يحل مشكلة جذرية: البرنامج كان يبحث عن حسابات بأكواد ثابتة،
-- لكن كل شجرة حسابات لها أكواد مختلفة. الحل: كل الحسابات تُقرأ من الإعدادات.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- الحسابات الافتراضية المطلوبة (26 حساب):
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ┌─────────────────────────────────────────────────────────────────────────────┐
-- │ 📦 المجموعة 1: الخزينة (Treasury) — 3 حسابات                              │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │  1. default_cash_account_id         — الصندوق                              │
-- │  2. default_bank_account_id         — البنك                                │
-- │  3. default_petty_cash_account_id   — المصروفات النثرية 🆕                  │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 👤 المجموعة 2: العملاء والمبيعات (Sales/AR) — 5 حسابات                    │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │  4. default_receivable_account_id   — الذمم المدينة (العملاء)               │
-- │  5. default_revenue_account_id      — الإيرادات                            │
-- │  6. default_sales_account_id        — المبيعات                             │
-- │  7. default_sales_returns_account_id — مردودات المبيعات 🆕                  │
-- │  8. default_sales_discount_account_id — خصم المبيعات 🆕                    │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 🏭 المجموعة 3: الموردين والمشتريات (Purchases/AP) — 5 حسابات              │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │  9. default_payable_account_id      — الذمم الدائنة (الموردين)              │
-- │ 10. default_purchase_account_id     — المشتريات                            │
-- │ 11. default_cogs_account_id         — تكلفة البضاعة المباعة                │
-- │ 12. default_purchase_returns_account_id — مردودات المشتريات 🆕             │
-- │ 13. default_purchase_discount_account_id — خصم المشتريات 🆕                │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 📦 المجموعة 4: المخزون (Inventory) — 2 حسابات                             │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 14. default_inventory_account_id    — المخزون                              │
-- │ 15. default_inventory_variance_account_id — فروق المخزون 🆕                │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 🧾 المجموعة 5: الضريبة (Tax) — 2 حسابات                                  │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 16. default_tax_input_account_id    — ضريبة المدخلات (أصول)                │
-- │ 17. default_tax_output_account_id   — ضريبة المخرجات (خصوم)               │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 💱 المجموعة 6: العملات (Currency) — 3 حسابات 🆕🔴 حرج                     │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 18. default_fx_gain_account_id      — أرباح فروقات العملة                  │
-- │ 19. default_fx_loss_account_id      — خسائر فروقات العملة                  │
-- │ 20. default_rounding_account_id     — فروق التقريب                        │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 💳 المجموعة 7: الدفعات المقدمة (Advances) — 2 حسابات 🆕                   │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 21. default_customer_advance_account_id  — دفعات مقدمة من العملاء          │
-- │ 22. default_supplier_advance_account_id  — دفعات مقدمة للموردين            │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 📊 المجموعة 8: المالية والإقفال (Financial/Closing) — 4 حسابات 🆕          │
-- ├─────────────────────────────────────────────────────────────────────────────┤
-- │ 23. default_expense_account_id      — المصروفات العامة                     │
-- │ 24. default_retained_earnings_account_id — الأرباح المحتجزة               │
-- │ 25. default_depreciation_account_id — مصاريف الإهلاك                      │
-- │ 26. default_freight_in_account_id   — مصاريف الشحن على المشتريات          │
-- └─────────────────────────────────────────────────────────────────────────────┘
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- خريطة الحسابات لكل نوع شجرة:
-- ═══════════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────┬──────────┬──────────┬────────────────┐
-- │ الحساب                       │ simple   │ extended │ fabric_extended│
-- ├──────────────────────────────┼──────────┼──────────┼────────────────┤
-- │ 💰 الصندوق                   │ 1110     │ 1111     │ 111            │
-- │ 🏦 البنك                     │ 1120     │ 1121     │ 112            │
-- │ 🪙 النثرية                   │ —        │ 1113     │ —              │
-- │ 📥 ذمم مدينة                 │ 1130     │ 1131     │ 115            │
-- │ 📤 ذمم دائنة                 │ 2110     │ 2111     │ 211            │
-- │ 💵 المبيعات/الإيرادات         │ 4100     │ 4110     │ 41             │
-- │ 🔄 مردودات المبيعات           │ 4200     │ 4200     │ 45             │
-- │ 🏷️ خصم المبيعات              │ —        │ 4150     │ 44             │
-- │ 🛒 المشتريات/COGS             │ 5200     │ 5200     │ 51             │
-- │ 📊 المصروفات                  │ 5600     │ 5600     │ 591            │
-- │ 🧾 ضريبة المدخلات             │ 1160     │ 1160     │ 215            │
-- │ 🧾 ضريبة المخرجات             │ 2130     │ 2130     │ 215            │
-- │ 📦 المخزون                    │ 1140     │ 1140     │ 131            │
-- │ 📉 فروق المخزون               │ —        │ —        │ 595            │
-- │ 💱 أرباح فروقات العملة         │ 4300     │ 4300     │ 47             │
-- │ 💱 خسائر فروقات العملة         │ 5800     │ 5800     │ 594            │
-- │ 💳 دفعات مقدمة - موردين       │ 1150     │ 1170     │ 118            │
-- │ 💳 دفعات مقدمة - عملاء        │ 2140     │ 2140     │ 216            │
-- │ 📊 الأرباح المحتجزة           │ 3300     │ 3300     │ 32             │
-- │ 🏗️ مصاريف الإهلاك             │ —        │ —        │ 592            │
-- │ 🚢 مصاريف الشحن               │ 5900     │ 5900     │ 54             │
-- │ 💸 فروق التقريب               │ 5900     │ 5900     │ 591            │
-- └──────────────────────────────┴──────────┴──────────┴────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- الخطوة 1: إضافة جميع الأعمدة المفقودة
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'company_accounting_settings') THEN
        EXECUTE 'ALTER TABLE company_accounting_settings
            -- التأكد من وجود الأعمدة السابقة
            ADD COLUMN IF NOT EXISTS default_cash_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_bank_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_receivable_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_payable_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_revenue_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_sales_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_expense_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_purchase_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_cogs_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_tax_input_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_tax_output_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_inventory_account_id UUID REFERENCES chart_of_accounts(id),
            
            -- 🆕 الحسابات الجديدة
            ADD COLUMN IF NOT EXISTS default_petty_cash_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_sales_returns_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_sales_discount_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_purchase_returns_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_purchase_discount_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_inventory_variance_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_fx_gain_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_fx_loss_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_rounding_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_customer_advance_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_supplier_advance_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_retained_earnings_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_depreciation_account_id UUID REFERENCES chart_of_accounts(id),
            ADD COLUMN IF NOT EXISTS default_freight_in_account_id UUID REFERENCES chart_of_accounts(id)';

        -- التعليقات
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_petty_cash_account_id IS ''🆕 المصروفات النثرية — Petty Cash''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_sales_returns_account_id IS ''🆕 مردودات المبيعات — Sales Returns''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_sales_discount_account_id IS ''🆕 خصم المبيعات — Sales Discount Allowed''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_purchase_returns_account_id IS ''🆕 مردودات المشتريات — Purchase Returns''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_purchase_discount_account_id IS ''🆕 خصم المشتريات — Purchase Discount Received''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_inventory_variance_account_id IS ''🆕 فروق المخزون — Inventory Variances/Write-offs''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_fx_gain_account_id IS ''🆕🔴 أرباح فروقات العملة — FX Realized/Unrealized Gains''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_fx_loss_account_id IS ''🆕🔴 خسائر فروقات العملة — FX Realized/Unrealized Losses''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_rounding_account_id IS ''🆕 فروق التقريب — Rounding Differences''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_customer_advance_account_id IS ''🆕 دفعات مقدمة من العملاء — Customer Advances (Liability)''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_supplier_advance_account_id IS ''🆕 دفعات مقدمة للموردين — Supplier Advances (Asset)''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_retained_earnings_account_id IS ''🆕 الأرباح المحتجزة — Retained Earnings (Equity)''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_depreciation_account_id IS ''🆕 مصاريف الإهلاك — Depreciation Expense''';
        EXECUTE 'COMMENT ON COLUMN company_accounting_settings.default_freight_in_account_id IS ''🆕 مصاريف الشحن على المشتريات — Freight-In / Landed Cost''';
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- الخطوة 2: إضافة الحسابات المفقودة في الشجرة البسيطة
-- (الشجرة البسيطة تفتقر لحسابات FX و Advances)
-- ═══════════════════════════════════════════════════════════════

-- لا نعدّل الشجرات هنا — الحسابات المفقودة تبقى NULL
-- والبرنامج يعرف أنها اختيارية. المهم أن الحسابات الموجودة تُربط.


-- ═══════════════════════════════════════════════════════════════
-- الخطوة 3: الدالة الشاملة — auto_set_default_accounts
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_set_default_accounts(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_chart_type VARCHAR(30);
    v_settings_id UUID;
    v_account_id UUID;
    v_count INT := 0;
BEGIN
    -- الحصول على نوع الشجرة
    SELECT chart_type INTO v_chart_type FROM companies WHERE id = p_company_id;
    IF v_chart_type IS NULL THEN
        RAISE NOTICE '⚠️ الشركة % ليس لها نوع شجرة محدد', p_company_id;
        RETURN;
    END IF;
    
    -- التأكد من وجود سجل الإعدادات
    SELECT id INTO v_settings_id FROM company_accounting_settings WHERE company_id = p_company_id;
    IF v_settings_id IS NULL THEN
        INSERT INTO company_accounting_settings (company_id, base_currency, fiscal_year_start_month, fiscal_year_end_month, enable_vat, decimal_places)
        VALUES (p_company_id, 'USD', 1, 12, true, 2)
        RETURNING id INTO v_settings_id;
        RAISE NOTICE '🆕 تم إنشاء إعدادات محاسبية للشركة %', p_company_id;
    END IF;
    
    RAISE NOTICE '═══════════════════════════════════════════════════════';
    RAISE NOTICE '🔧 تحديد الحسابات الافتراضية — الشركة %', p_company_id;
    RAISE NOTICE '   نوع الشجرة: %', v_chart_type;
    RAISE NOTICE '═══════════════════════════════════════════════════════';

    -- ═══════════════════════════════════════ --
    -- 📦 المجموعة 1: الخزينة (Treasury)      --
    -- ═══════════════════════════════════════ --

    -- 1️⃣ الصندوق (Cash)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND (CASE v_chart_type
          WHEN 'simple' THEN account_code = '1110'
          WHEN 'extended' THEN account_code = '1111'
          WHEN 'fabric_extended' THEN account_code = '111'
          ELSE false END OR is_cash_account = true)
    ORDER BY CASE
        WHEN v_chart_type = 'simple' AND account_code = '1110' THEN 0
        WHEN v_chart_type = 'extended' AND account_code = '1111' THEN 0
        WHEN v_chart_type = 'fabric_extended' AND account_code = '111' THEN 0
        WHEN is_cash_account = true THEN 1 ELSE 10 END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_cash_account_id = v_account_id WHERE id = v_settings_id AND default_cash_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ الصندوق';
    END IF;

    -- 2️⃣ البنك (Bank)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND (CASE v_chart_type
          WHEN 'simple' THEN account_code = '1120'
          WHEN 'extended' THEN account_code = '1121'
          WHEN 'fabric_extended' THEN account_code = '112'
          ELSE false END OR is_bank_account = true)
    ORDER BY CASE
        WHEN v_chart_type = 'simple' AND account_code = '1120' THEN 0
        WHEN v_chart_type = 'extended' AND account_code = '1121' THEN 0
        WHEN v_chart_type = 'fabric_extended' AND account_code = '112' THEN 0
        WHEN is_bank_account = true THEN 1 ELSE 10 END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_bank_account_id = v_account_id WHERE id = v_settings_id AND default_bank_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ البنك';
    END IF;

    -- 3️⃣ المصروفات النثرية (Petty Cash) — extended only
    IF v_chart_type = 'extended' THEN
        SELECT id INTO v_account_id FROM chart_of_accounts
        WHERE company_id = p_company_id AND account_code = '1113' AND is_active = true AND is_detail = true LIMIT 1;
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings SET default_petty_cash_account_id = v_account_id WHERE id = v_settings_id AND default_petty_cash_account_id IS NULL;
            v_count := v_count + 1; RAISE NOTICE '  ✅ النثرية';
        END IF;
    END IF;

    -- ═══════════════════════════════════════ --
    -- 👤 المجموعة 2: العملاء والمبيعات       --
    -- ═══════════════════════════════════════ --

    -- 4️⃣ الذمم المدينة (Accounts Receivable)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true
      AND (CASE v_chart_type
          WHEN 'simple' THEN account_code = '1130'
          WHEN 'extended' THEN account_code IN ('1131', '1130')
          WHEN 'fabric_extended' THEN account_code = '115'
          ELSE false END OR is_receivable = true)
    ORDER BY CASE
        WHEN is_receivable = true AND is_detail = true THEN 0
        WHEN account_code IN ('1131', '115', '1130') THEN 1 ELSE 10 END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_receivable_account_id = v_account_id WHERE id = v_settings_id AND default_receivable_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ الذمم المدينة';
    END IF;

    -- 5️⃣ + 6️⃣ المبيعات / الإيرادات (Sales / Revenue)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '4100'
          WHEN 'extended' THEN account_code = '4110'
          WHEN 'fabric_extended' THEN account_code = '41'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET
            default_revenue_account_id = v_account_id,
            default_sales_account_id = v_account_id
        WHERE id = v_settings_id AND default_revenue_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ المبيعات/الإيرادات';
    END IF;

    -- 7️⃣ مردودات المبيعات (Sales Returns) 🆕
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '4200'
          WHEN 'extended' THEN account_code = '4200'
          WHEN 'fabric_extended' THEN account_code = '45'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_sales_returns_account_id = v_account_id WHERE id = v_settings_id AND default_sales_returns_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ مردودات المبيعات';
    END IF;

    -- 8️⃣ خصم المبيعات (Sales Discount) 🆕
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'extended' THEN account_code = '4150'
          WHEN 'fabric_extended' THEN account_code = '44'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_sales_discount_account_id = v_account_id WHERE id = v_settings_id AND default_sales_discount_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ خصم المبيعات';
    END IF;

    -- ═══════════════════════════════════════ --
    -- 🏭 المجموعة 3: الموردين والمشتريات     --
    -- ═══════════════════════════════════════ --

    -- 9️⃣ الذمم الدائنة (Accounts Payable)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true
      AND (CASE v_chart_type
          WHEN 'simple' THEN account_code = '2110'
          WHEN 'extended' THEN account_code IN ('2111', '2110')
          WHEN 'fabric_extended' THEN account_code = '211'
          ELSE false END OR is_payable = true)
    ORDER BY CASE
        WHEN is_payable = true AND is_detail = true THEN 0
        WHEN account_code IN ('2111', '211', '2110') THEN 1 ELSE 10 END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_payable_account_id = v_account_id WHERE id = v_settings_id AND default_payable_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ الذمم الدائنة';
    END IF;

    -- 🔟 + 1️⃣1️⃣ المشتريات / COGS
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code IN ('5200', '5100')
          WHEN 'extended' THEN account_code IN ('5200', '5100')
          WHEN 'fabric_extended' THEN account_code = '51'
          ELSE false END
    ORDER BY CASE WHEN account_code IN ('5200', '51') THEN 0 WHEN account_code = '5100' THEN 1 ELSE 10 END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET
            default_purchase_account_id = v_account_id,
            default_cogs_account_id = v_account_id
        WHERE id = v_settings_id AND default_purchase_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ المشتريات/COGS';
    END IF;

    -- 1️⃣2️⃣ مردودات المشتريات (Purchase Returns) 🆕
    -- الشجرة البسيطة والموسعة لا تحتوي حساب مخصص — يمكن إضافته يدوياً
    -- شجرة الأقمشة: لا يوجد حساب مخصص أيضاً

    -- 1️⃣3️⃣ خصم المشتريات (Purchase Discount) 🆕
    -- نفس الشيء — يضيفه المستخدم يدوياً

    -- ═══════════════════════════════════════ --
    -- 📦 المجموعة 4: المخزون (Inventory)      --
    -- ═══════════════════════════════════════ --

    -- 1️⃣4️⃣ المخزون (Inventory)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '1140'
          WHEN 'extended' THEN account_code = '1140'
          WHEN 'fabric_extended' THEN account_code = '131'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_inventory_account_id = v_account_id WHERE id = v_settings_id AND default_inventory_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ المخزون';
    END IF;

    -- 1️⃣5️⃣ فروق المخزون (Inventory Variance) 🆕
    IF v_chart_type = 'fabric_extended' THEN
        SELECT id INTO v_account_id FROM chart_of_accounts
        WHERE company_id = p_company_id AND account_code = '595' AND is_active = true AND is_detail = true LIMIT 1;
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings SET default_inventory_variance_account_id = v_account_id WHERE id = v_settings_id AND default_inventory_variance_account_id IS NULL;
            v_count := v_count + 1; RAISE NOTICE '  ✅ فروق المخزون';
        END IF;
    END IF;

    -- ═══════════════════════════════════════ --
    -- 🧾 المجموعة 5: الضريبة (Tax)            --
    -- ═══════════════════════════════════════ --

    -- 1️⃣6️⃣ ضريبة المدخلات (VAT Input — Assets)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '1160'
          WHEN 'extended' THEN account_code = '1160'
          WHEN 'fabric_extended' THEN account_code = '215'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_tax_input_account_id = v_account_id WHERE id = v_settings_id AND default_tax_input_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ ضريبة المدخلات';
    END IF;

    -- 1️⃣7️⃣ ضريبة المخرجات (VAT Output — Liabilities)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '2130'
          WHEN 'extended' THEN account_code = '2130'
          WHEN 'fabric_extended' THEN account_code = '215'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_tax_output_account_id = v_account_id WHERE id = v_settings_id AND default_tax_output_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ ضريبة المخرجات';
    END IF;

    -- ═══════════════════════════════════════ --
    -- 💱 المجموعة 6: العملات (Currency) 🔴     --
    -- ═══════════════════════════════════════ --

    -- 1️⃣8️⃣ أرباح فروقات العملة (FX Gains)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '4300'  -- إيرادات أخرى
          WHEN 'extended' THEN account_code = '4300' -- إيرادات أخرى
          WHEN 'fabric_extended' THEN account_code = '47' -- أرباح فروقات العملة
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_fx_gain_account_id = v_account_id WHERE id = v_settings_id AND default_fx_gain_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ أرباح فروقات العملة 💱';
    END IF;

    -- 1️⃣9️⃣ خسائر فروقات العملة (FX Losses)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '5800'  -- مصاريف مالية
          WHEN 'extended' THEN account_code = '5800' -- مصاريف مالية
          WHEN 'fabric_extended' THEN account_code = '594' -- خسائر فروقات العملة
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_fx_loss_account_id = v_account_id WHERE id = v_settings_id AND default_fx_loss_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ خسائر فروقات العملة 💱';
    END IF;

    -- 2️⃣0️⃣ فروق التقريب (Rounding)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '5900'
          WHEN 'extended' THEN account_code = '5900'
          WHEN 'fabric_extended' THEN account_code = '591'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_rounding_account_id = v_account_id WHERE id = v_settings_id AND default_rounding_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ فروق التقريب';
    END IF;

    -- ═══════════════════════════════════════ --
    -- 💳 المجموعة 7: الدفعات المقدمة          --
    -- ═══════════════════════════════════════ --

    -- 2️⃣1️⃣ دفعات مقدمة من العملاء (Customer Advances — Liability)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '2140'
          WHEN 'extended' THEN account_code = '2140'
          WHEN 'fabric_extended' THEN account_code = '216'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_customer_advance_account_id = v_account_id WHERE id = v_settings_id AND default_customer_advance_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ دفعات مقدمة - عملاء';
    END IF;

    -- 2️⃣2️⃣ دفعات مقدمة للموردين (Supplier Advances — Asset)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '1150'
          WHEN 'extended' THEN account_code = '1170'
          WHEN 'fabric_extended' THEN account_code = '118'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_supplier_advance_account_id = v_account_id WHERE id = v_settings_id AND default_supplier_advance_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ دفعات مقدمة - موردين';
    END IF;

    -- ═══════════════════════════════════════ --
    -- 📊 المجموعة 8: المالية والإقفال         --
    -- ═══════════════════════════════════════ --

    -- 2️⃣3️⃣ المصروفات العامة (General Expense)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '5600'
          WHEN 'extended' THEN account_code = '5600'
          WHEN 'fabric_extended' THEN account_code = '591'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_expense_account_id = v_account_id WHERE id = v_settings_id AND default_expense_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ المصروفات العامة';
    END IF;

    -- 2️⃣4️⃣ الأرباح المحتجزة (Retained Earnings)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '3300'
          WHEN 'extended' THEN account_code = '3300'
          WHEN 'fabric_extended' THEN account_code = '32'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_retained_earnings_account_id = v_account_id WHERE id = v_settings_id AND default_retained_earnings_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ الأرباح المحتجزة';
    END IF;

    -- 2️⃣5️⃣ مصاريف الإهلاك (Depreciation Expense)
    IF v_chart_type = 'fabric_extended' THEN
        SELECT id INTO v_account_id FROM chart_of_accounts
        WHERE company_id = p_company_id AND account_code = '592' AND is_active = true AND is_detail = true LIMIT 1;
        IF v_account_id IS NOT NULL THEN
            UPDATE company_accounting_settings SET default_depreciation_account_id = v_account_id WHERE id = v_settings_id AND default_depreciation_account_id IS NULL;
            v_count := v_count + 1; RAISE NOTICE '  ✅ مصاريف الإهلاك';
        END IF;
    END IF;

    -- 2️⃣6️⃣ مصاريف الشحن على المشتريات (Freight-In)
    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE company_id = p_company_id AND is_active = true AND is_detail = true
      AND CASE v_chart_type
          WHEN 'simple' THEN account_code = '5900'
          WHEN 'extended' THEN account_code = '5900'
          WHEN 'fabric_extended' THEN account_code = '54'
          ELSE false END
    LIMIT 1;
    IF v_account_id IS NOT NULL THEN
        UPDATE company_accounting_settings SET default_freight_in_account_id = v_account_id WHERE id = v_settings_id AND default_freight_in_account_id IS NULL;
        v_count := v_count + 1; RAISE NOTICE '  ✅ مصاريف الشحن';
    END IF;

    RAISE NOTICE '═══════════════════════════════════════════════════════';
    RAISE NOTICE '✅ تم تحديد %/26 حساب افتراضي', v_count;
    RAISE NOTICE '═══════════════════════════════════════════════════════';
END;
$$;

COMMENT ON FUNCTION auto_set_default_accounts(UUID) IS 'تحديد جميع الحسابات الافتراضية (26 حساب) حسب نوع الشجرة — يُستدعى تلقائياً عند التسجيل وعند تطبيق القالب';


-- ═══════════════════════════════════════════════════════════════
-- الخطوة 4: تنفيذ على الشركات الموجودة
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_rec RECORD;
    v_total INT := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '🚀 بدء تحديد الحسابات الافتراضية الشاملة (26 حساب)...';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'company_accounting_settings') THEN
            FOR v_rec IN 
                SELECT c.id as company_id, c.name_ar, c.chart_type
                FROM companies c WHERE c.chart_type IS NOT NULL
            LOOP
                BEGIN
                    RAISE NOTICE '';
                    RAISE NOTICE '🏢 % (نوع الشجرة: %)', v_rec.name_ar, v_rec.chart_type;
                    PERFORM auto_set_default_accounts(v_rec.company_id);
                    v_total := v_total + 1;
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE '  ❌ خطأ: %', SQLERRM;
                END;
            END LOOP;
        END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ تم معالجة % شركة', v_total;
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- الخطوة 5: استعلام التحقق الشامل
-- ═══════════════════════════════════════════════════════════════

-- 5️⃣ استعلام التحقق الشامل (Commented out because table might not exist)
/*
SELECT 
    c.name_ar AS "الشركة",
    c.chart_type AS "الشجرة",
    cas.base_currency AS "العملة",
    -- الخزينة
    CASE WHEN cas.default_cash_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "الصندوق",
    CASE WHEN cas.default_bank_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "البنك",
    -- المبيعات
    CASE WHEN cas.default_receivable_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "ذمم مدينة",
    CASE WHEN cas.default_sales_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "المبيعات",
    CASE WHEN cas.default_sales_returns_account_id IS NOT NULL THEN '✅' ELSE '—' END AS "مردودات بيع",
    CASE WHEN cas.default_sales_discount_account_id IS NOT NULL THEN '✅' ELSE '—' END AS "خصم بيع",
    -- المشتريات
    CASE WHEN cas.default_payable_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "ذمم دائنة",
    CASE WHEN cas.default_purchase_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "المشتريات",
    CASE WHEN cas.default_inventory_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "المخزون",
    -- الضريبة
    CASE WHEN cas.default_tax_input_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "ضريبة",
    -- العملات 🔴
    CASE WHEN cas.default_fx_gain_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "أرباح FX",
    CASE WHEN cas.default_fx_loss_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "خسائر FX",
    -- الدفعات المقدمة
    CASE WHEN cas.default_customer_advance_account_id IS NOT NULL THEN '✅' ELSE '—' END AS "مقدمة عملاء",
    CASE WHEN cas.default_supplier_advance_account_id IS NOT NULL THEN '✅' ELSE '—' END AS "مقدمة موردين",
    -- المالية
    CASE WHEN cas.default_retained_earnings_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "أرباح محتجزة",
    CASE WHEN cas.default_expense_account_id IS NOT NULL THEN '✅' ELSE '❌' END AS "المصروفات"
FROM companies c
LEFT JOIN company_accounting_settings cas ON cas.company_id = c.id
ORDER BY c.name_ar;
*/
