-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00012: البنية التحتية المحاسبية المتقدمة
-- Advanced Accounting Infrastructure
-- ═══════════════════════════════════════════════════════════════════════════
-- المحتويات:
-- 1. إضافة حقل نوع الشجرة للشركات
-- 2. دالة توليد رقم الحساب التلقائي
-- 3. دالة الشجرة البسيطة (~40 حساب)
-- 4. دالة الشجرة الموسعة (~80 حساب)
-- 5. دالة الترقية من البسيطة للموسعة
-- 6. Trigger إنشاء الشجرة عند إنشاء شركة
-- 7. Trigger إنشاء حساب للعميل الجديد
-- 8. Trigger إنشاء حساب للمورد الجديد
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. إضافة حقل نوع الشجرة للشركات
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE companies ADD COLUMN IF NOT EXISTS chart_type VARCHAR(20) DEFAULT 'simple';
COMMENT ON COLUMN companies.chart_type IS 'نوع شجرة الحسابات: simple (~40 حساب) أو extended (~80 حساب)';

-- ═══════════════════════════════════════════════════════════════
-- 2. دالة توليد رقم الحساب التلقائي
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION generate_next_account_code(
    p_tenant_id UUID,
    p_company_id UUID,
    p_parent_code VARCHAR(50)
) RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
    v_max_code VARCHAR(50);
    v_next_number INT;
    v_parent_length INT;
    v_new_code VARCHAR(50);
BEGIN
    v_parent_length := LENGTH(p_parent_code);
    
    -- البحث عن آخر رقم حساب تحت هذا الأب
    SELECT MAX(account_code) INTO v_max_code
    FROM chart_of_accounts
    WHERE tenant_id = p_tenant_id
      AND company_id = p_company_id
      AND account_code LIKE p_parent_code || '%'
      AND LENGTH(account_code) = v_parent_length + 2;
    
    IF v_max_code IS NULL THEN
        -- أول حساب فرعي
        v_new_code := p_parent_code || '01';
    ELSE
        -- استخراج الرقم الأخير وزيادته
        v_next_number := CAST(RIGHT(v_max_code, 2) AS INT) + 1;
        IF v_next_number > 99 THEN
            RAISE EXCEPTION 'تم تجاوز الحد الأقصى للحسابات الفرعية تحت %', p_parent_code;
        END IF;
        v_new_code := p_parent_code || LPAD(v_next_number::TEXT, 2, '0');
    END IF;
    
    RETURN v_new_code;
END;
$$;

COMMENT ON FUNCTION generate_next_account_code(UUID, UUID, VARCHAR) IS 'توليد رقم حساب جديد تلقائياً تحت حساب أب محدد';

-- ═══════════════════════════════════════════════════════════════
-- 3. دالة الشجرة البسيطة (~40 حساب)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_simple_chart_of_accounts(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_asset_type_id UUID;
    v_current_asset_type_id UUID;
    v_fixed_asset_type_id UUID;
    v_liability_type_id UUID;
    v_current_liability_type_id UUID;
    v_long_term_liability_type_id UUID;
    v_equity_type_id UUID;
    v_revenue_type_id UUID;
    v_expense_type_id UUID;
    v_cogs_type_id UUID;
    v_other_income_type_id UUID;
    v_other_expense_type_id UUID;
    
    -- Parent IDs
    v_assets_id UUID;
    v_current_assets_id UUID;
    v_fixed_assets_id UUID;
    v_liabilities_id UUID;
    v_current_liabilities_id UUID;
    v_long_term_liabilities_id UUID;
    v_equity_id UUID;
    v_revenue_id UUID;
    v_expenses_id UUID;
BEGIN
    -- Get tenant_id
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'الشركة غير موجودة أو ليس لها tenant_id';
    END IF;
    
    -- التحقق من عدم وجود شجرة مسبقة
    IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id LIMIT 1) THEN
        RAISE NOTICE 'شجرة الحسابات موجودة مسبقاً لهذه الشركة';
        RETURN;
    END IF;
    
    -- Get account type IDs
    SELECT id INTO v_asset_type_id FROM account_types WHERE code = 'ASSET';
    SELECT id INTO v_current_asset_type_id FROM account_types WHERE code = 'CURRENT_ASSET';
    SELECT id INTO v_fixed_asset_type_id FROM account_types WHERE code = 'FIXED_ASSET';
    SELECT id INTO v_liability_type_id FROM account_types WHERE code = 'LIABILITY';
    SELECT id INTO v_current_liability_type_id FROM account_types WHERE code = 'CURRENT_LIABILITY';
    SELECT id INTO v_long_term_liability_type_id FROM account_types WHERE code = 'LONG_TERM_LIABILITY';
    SELECT id INTO v_equity_type_id FROM account_types WHERE code = 'EQUITY';
    SELECT id INTO v_revenue_type_id FROM account_types WHERE code = 'REVENUE';
    SELECT id INTO v_expense_type_id FROM account_types WHERE code = 'EXPENSE';
    SELECT id INTO v_cogs_type_id FROM account_types WHERE code = 'COGS';
    SELECT id INTO v_other_income_type_id FROM account_types WHERE code = 'OTHER_INCOME';
    SELECT id INTO v_other_expense_type_id FROM account_types WHERE code = 'OTHER_EXPENSE';

    -- ═══════════════════════════════════════════════════════════════
    -- 1000 الأصول
    -- ═══════════════════════════════════════════════════════════════
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '1000', 'الأصول', 'Assets', 'Активы', 'Активи', 'Active', 'Aktywa', 'Varlıklar', 'Vermögenswerte', 'Attività', v_asset_type_id, NULL, true, false, 1, '1000', 'SAR', true, true)
    RETURNING id INTO v_assets_id;

    -- 1100 الأصول المتداولة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '1100', 'الأصول المتداولة', 'Current Assets', 'Оборотные активы', 'Оборотні активи', 'Active curente', 'Aktywa obrotowe', 'Dönen Varlıklar', 'Umlaufvermögen', 'Attività correnti', v_current_asset_type_id, v_assets_id, true, false, 2, '1000.1100', 'SAR', true, true)
    RETURNING id INTO v_current_assets_id;

    -- 1110 الصندوق
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_cash_account, is_system)
    VALUES (v_tenant_id, p_company_id, '1110', 'الصندوق', 'Cash', 'Касса', 'Каса', 'Numerar', 'Kasa', 'Kasa', 'Kasse', 'Cassa', v_current_asset_type_id, v_current_assets_id, false, true, 3, '1000.1100.1110', 'SAR', true, true, true);

    -- 1120 البنك
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_bank_account, is_system)
    VALUES (v_tenant_id, p_company_id, '1120', 'البنك', 'Bank', 'Банк', 'Банк', 'Bancă', 'Bank', 'Banka', 'Bank', 'Banca', v_current_asset_type_id, v_current_assets_id, false, true, 3, '1000.1100.1120', 'SAR', true, true, true);

    -- 1130 العملاء (مجموعة)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_receivable, is_system)
    VALUES (v_tenant_id, p_company_id, '1130', 'العملاء', 'Accounts Receivable', 'Дебиторская задолженность', 'Дебіторська заборгованість', 'Creanțe', 'Należności', 'Alacaklar', 'Forderungen', 'Crediti', v_current_asset_type_id, v_current_assets_id, true, false, 3, '1000.1100.1130', 'SAR', true, true, true);

    -- 1140 المخزون
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '1140', 'المخزون', 'Inventory', 'Запасы', 'Запаси', 'Stocuri', 'Zapasy', 'Stok', 'Vorräte', 'Magazzino', v_current_asset_type_id, v_current_assets_id, false, true, 3, '1000.1100.1140', 'SAR', true, true);

    -- 1150 مصاريف مقدمة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '1150', 'مصاريف مقدمة', 'Prepaid Expenses', 'Авансы', 'Аванси', 'Cheltuieli în avans', 'Przedpłaty', 'Peşin Ödemeler', 'Vorauszahlungen', 'Risconti attivi', v_current_asset_type_id, v_current_assets_id, false, true, 3, '1000.1100.1150', 'SAR', true, true);

    -- 1160 ضريبة القيمة المضافة - مدخلات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '1160', 'ضريبة القيمة المضافة - مدخلات', 'VAT Input', 'НДС к возмещению', 'ПДВ до відшкодування', 'TVA deductibilă', 'VAT naliczony', 'KDV Alacak', 'Vorsteuer', 'IVA a credito', v_current_asset_type_id, v_current_assets_id, false, true, 3, '1000.1100.1160', 'SAR', true, true);

    -- 1200 الأصول الثابتة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '1200', 'الأصول الثابتة', 'Fixed Assets', 'Основные средства', 'Основні засоби', 'Active fixe', 'Aktywa trwałe', 'Duran Varlıklar', 'Anlagevermögen', 'Immobilizzazioni', v_fixed_asset_type_id, v_assets_id, true, false, 2, '1000.1200', 'SAR', true, true)
    RETURNING id INTO v_fixed_assets_id;

    -- 1210 الأصول الثابتة (تفصيلي)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '1210', 'أصول ثابتة', 'Fixed Assets', 'Основные средства', 'Основні засоби', 'Active fixe', 'Środki trwałe', 'Sabit Varlıklar', 'Sachanlagen', 'Immobilizzazioni materiali', v_fixed_asset_type_id, v_fixed_assets_id, false, true, 3, '1000.1200.1210', 'SAR', true, true);

    -- 1220 مجمع الإهلاك
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '1220', 'مجمع الإهلاك', 'Accumulated Depreciation', 'Накопленная амортизация', 'Накопичена амортизація', 'Amortizare cumulată', 'Umorzenie', 'Birikmiş Amortisman', 'Kumulierte Abschreibung', 'Fondo ammortamento', v_fixed_asset_type_id, v_fixed_assets_id, false, true, 3, '1000.1200.1220', 'SAR', true, true);

    -- ═══════════════════════════════════════════════════════════════
    -- 2000 الخصوم
    -- ═══════════════════════════════════════════════════════════════
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '2000', 'الخصوم', 'Liabilities', 'Обязательства', 'Зобов''язання', 'Datorii', 'Zobowiązania', 'Borçlar', 'Verbindlichkeiten', 'Passività', v_liability_type_id, NULL, true, false, 1, '2000', 'SAR', true, true)
    RETURNING id INTO v_liabilities_id;

    -- 2100 الخصوم المتداولة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '2100', 'الخصوم المتداولة', 'Current Liabilities', 'Краткосрочные обязательства', 'Поточні зобов''язання', 'Datorii curente', 'Zobowiązania krótkoterminowe', 'Kısa Vadeli Borçlar', 'Kurzfristige Verbindlichkeiten', 'Passività correnti', v_current_liability_type_id, v_liabilities_id, true, false, 2, '2000.2100', 'SAR', true, true)
    RETURNING id INTO v_current_liabilities_id;

    -- 2110 الموردون (مجموعة)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_payable, is_system)
    VALUES (v_tenant_id, p_company_id, '2110', 'الموردون', 'Accounts Payable', 'Кредиторская задолженность', 'Кредиторська заборгованість', 'Furnizori', 'Zobowiązania handlowe', 'Borçlar', 'Verbindlichkeiten L.u.L.', 'Debiti', v_current_liability_type_id, v_current_liabilities_id, true, false, 3, '2000.2100.2110', 'SAR', true, true, true);

    -- 2120 مستحقات الموظفين
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '2120', 'مستحقات الموظفين', 'Accrued Salaries', 'Задолженность по зарплате', 'Заборгованість по зарплаті', 'Salarii de plătit', 'Wynagrodzenia', 'Tahakkuk Eden Maaşlar', 'Lohnverbindlichkeiten', 'Debiti verso dipendenti', v_current_liability_type_id, v_current_liabilities_id, false, true, 3, '2000.2100.2120', 'SAR', true, true);

    -- 2130 ضريبة القيمة المضافة - مخرجات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '2130', 'ضريبة القيمة المضافة - مخرجات', 'VAT Output', 'НДС к уплате', 'ПДВ до сплати', 'TVA colectată', 'VAT należny', 'KDV Borç', 'Umsatzsteuer', 'IVA a debito', v_current_liability_type_id, v_current_liabilities_id, false, true, 3, '2000.2100.2130', 'SAR', true, true);

    -- 2140 دائنون آخرون
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '2140', 'دائنون آخرون', 'Other Payables', 'Прочие кредиторы', 'Інші кредитори', 'Alți creditori', 'Inni wierzyciele', 'Diğer Borçlar', 'Sonstige Verbindlichkeiten', 'Altri debiti', v_current_liability_type_id, v_current_liabilities_id, false, true, 3, '2000.2100.2140', 'SAR', true, true);

    -- 2200 الخصوم طويلة الأجل
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '2200', 'الخصوم طويلة الأجل', 'Long-term Liabilities', 'Долгосрочные обязательства', 'Довгострокові зобов''язання', 'Datorii pe termen lung', 'Zobowiązania długoterminowe', 'Uzun Vadeli Borçlar', 'Langfristige Verbindlichkeiten', 'Passività a lungo termine', v_long_term_liability_type_id, v_liabilities_id, true, false, 2, '2000.2200', 'SAR', true, true)
    RETURNING id INTO v_long_term_liabilities_id;

    -- 2210 قروض طويلة الأجل
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '2210', 'قروض طويلة الأجل', 'Long-term Loans', 'Долгосрочные кредиты', 'Довгострокові кредити', 'Credite pe termen lung', 'Kredyty długoterminowe', 'Uzun Vadeli Krediler', 'Langfristige Darlehen', 'Mutui a lungo termine', v_long_term_liability_type_id, v_long_term_liabilities_id, false, true, 3, '2000.2200.2210', 'SAR', true, true);

    -- ═══════════════════════════════════════════════════════════════
    -- 3000 حقوق الملكية
    -- ═══════════════════════════════════════════════════════════════
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '3000', 'حقوق الملكية', 'Equity', 'Собственный капитал', 'Власний капітал', 'Capitaluri proprii', 'Kapitał własny', 'Öz Sermaye', 'Eigenkapital', 'Patrimonio netto', v_equity_type_id, NULL, true, false, 1, '3000', 'SAR', true, true)
    RETURNING id INTO v_equity_id;

    -- 3100 رأس المال
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '3100', 'رأس المال', 'Capital', 'Уставный капитал', 'Статутний капітал', 'Capital social', 'Kapitał zakładowy', 'Sermaye', 'Gezeichnetes Kapital', 'Capitale sociale', v_equity_type_id, v_equity_id, false, true, 2, '3000.3100', 'SAR', true, true);

    -- 3200 الاحتياطيات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '3200', 'الاحتياطيات', 'Reserves', 'Резервы', 'Резерви', 'Rezerve', 'Rezerwy', 'Yedekler', 'Rücklagen', 'Riserve', v_equity_type_id, v_equity_id, false, true, 2, '3000.3200', 'SAR', true, true);

    -- 3300 الأرباح المحتجزة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '3300', 'الأرباح المحتجزة', 'Retained Earnings', 'Нераспределенная прибыль', 'Нерозподілений прибуток', 'Rezultat reportat', 'Zysk zatrzymany', 'Dağıtılmamış Karlar', 'Gewinnvortrag', 'Utili a nuovo', v_equity_type_id, v_equity_id, false, true, 2, '3000.3300', 'SAR', true, true);

    -- 3400 أرباح/خسائر العام
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '3400', 'أرباح/خسائر العام', 'Current Year P/L', 'Прибыль/убыток года', 'Прибуток/збиток року', 'Profit/pierdere curentă', 'Wynik bieżący', 'Cari Yıl Kar/Zarar', 'Jahresüberschuss', 'Utile/perdita d''esercizio', v_equity_type_id, v_equity_id, false, true, 2, '3000.3400', 'SAR', true, true);

    -- 3500 جاري الشركاء (مجموعة)
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '3500', 'جاري الشركاء', 'Partners Current', 'Текущий счет партнеров', 'Поточний рахунок партнерів', 'Cont curent asociați', 'Konto wspólników', 'Ortaklar Cari', 'Gesellschafterkonten', 'Conto corrente soci', v_equity_type_id, v_equity_id, true, false, 2, '3000.3500', 'SAR', true, true);

    -- ═══════════════════════════════════════════════════════════════
    -- 4000 الإيرادات
    -- ═══════════════════════════════════════════════════════════════
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '4000', 'الإيرادات', 'Revenue', 'Доходы', 'Доходи', 'Venituri', 'Przychody', 'Gelirler', 'Erträge', 'Ricavi', v_revenue_type_id, NULL, true, false, 1, '4000', 'SAR', true, true)
    RETURNING id INTO v_revenue_id;

    -- 4100 المبيعات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '4100', 'المبيعات', 'Sales', 'Продажи', 'Продажі', 'Vânzări', 'Sprzedaż', 'Satışlar', 'Umsatzerlöse', 'Vendite', v_revenue_type_id, v_revenue_id, false, true, 2, '4000.4100', 'SAR', true, true);

    -- 4200 مردودات المبيعات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '4200', 'مردودات المبيعات', 'Sales Returns', 'Возвраты продаж', 'Повернення продажів', 'Retururi vânzări', 'Zwroty sprzedaży', 'Satış İadeleri', 'Retouren', 'Resi su vendite', v_revenue_type_id, v_revenue_id, false, true, 2, '4000.4200', 'SAR', true, true);

    -- 4300 إيرادات أخرى
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '4300', 'إيرادات أخرى', 'Other Income', 'Прочие доходы', 'Інші доходи', 'Alte venituri', 'Pozostałe przychody', 'Diğer Gelirler', 'Sonstige Erträge', 'Altri ricavi', v_other_income_type_id, v_revenue_id, false, true, 2, '4000.4300', 'SAR', true, true);

    -- ═══════════════════════════════════════════════════════════════
    -- 5000 المصروفات
    -- ═══════════════════════════════════════════════════════════════
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5000', 'المصروفات', 'Expenses', 'Расходы', 'Витрати', 'Cheltuieli', 'Koszty', 'Giderler', 'Aufwendungen', 'Costi', v_expense_type_id, NULL, true, false, 1, '5000', 'SAR', true, true)
    RETURNING id INTO v_expenses_id;

    -- 5100 تكلفة المبيعات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5100', 'تكلفة المبيعات', 'Cost of Sales', 'Себестоимость', 'Собівартість', 'Costul vânzărilor', 'Koszt sprzedaży', 'Satış Maliyeti', 'Herstellungskosten', 'Costo del venduto', v_cogs_type_id, v_expenses_id, false, true, 2, '5000.5100', 'SAR', true, true);

    -- 5200 المشتريات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5200', 'المشتريات', 'Purchases', 'Закупки', 'Закупівлі', 'Achiziții', 'Zakupy', 'Satın Almalar', 'Wareneinkauf', 'Acquisti', v_cogs_type_id, v_expenses_id, false, true, 2, '5000.5200', 'SAR', true, true);

    -- 5300 الرواتب والأجور
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5300', 'الرواتب والأجور', 'Salaries & Wages', 'Зарплата', 'Зарплата', 'Salarii', 'Wynagrodzenia', 'Maaşlar', 'Löhne und Gehälter', 'Stipendi e salari', v_expense_type_id, v_expenses_id, false, true, 2, '5000.5300', 'SAR', true, true);

    -- 5400 الإيجارات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5400', 'الإيجارات', 'Rent Expense', 'Аренда', 'Оренда', 'Chirii', 'Czynsz', 'Kira', 'Miete', 'Affitti passivi', v_expense_type_id, v_expenses_id, false, true, 2, '5000.5400', 'SAR', true, true);

    -- 5500 المرافق
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5500', 'المرافق', 'Utilities', 'Коммунальные', 'Комунальні', 'Utilități', 'Media', 'Faturalar', 'Nebenkosten', 'Utenze', v_expense_type_id, v_expenses_id, false, true, 2, '5000.5500', 'SAR', true, true);

    -- 5600 مصاريف إدارية
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5600', 'مصاريف إدارية', 'Admin Expenses', 'Административные', 'Адміністративні', 'Administrative', 'Administracyjne', 'Yönetim Giderleri', 'Verwaltungskosten', 'Spese amministrative', v_expense_type_id, v_expenses_id, false, true, 2, '5000.5600', 'SAR', true, true);

    -- 5700 مصاريف تسويق
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5700', 'مصاريف تسويق', 'Marketing Expenses', 'Маркетинг', 'Маркетинг', 'Marketing', 'Marketing', 'Pazarlama', 'Marketing', 'Spese marketing', v_expense_type_id, v_expenses_id, false, true, 2, '5000.5700', 'SAR', true, true);

    -- 5800 مصاريف مالية
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5800', 'مصاريف مالية', 'Financial Expenses', 'Финансовые расходы', 'Фінансові витрати', 'Cheltuieli financiare', 'Koszty finansowe', 'Finansal Giderler', 'Finanzaufwendungen', 'Oneri finanziari', v_other_expense_type_id, v_expenses_id, false, true, 2, '5000.5800', 'SAR', true, true);

    -- 5900 مصاريف أخرى
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_system)
    VALUES (v_tenant_id, p_company_id, '5900', 'مصاريف أخرى', 'Other Expenses', 'Прочие расходы', 'Інші витрати', 'Alte cheltuieli', 'Pozostałe koszty', 'Diğer Giderler', 'Sonstige Aufwendungen', 'Altri costi', v_other_expense_type_id, v_expenses_id, false, true, 2, '5000.5900', 'SAR', true, true);

    -- تحديث نوع الشجرة للشركة
    UPDATE companies SET chart_type = 'simple' WHERE id = p_company_id;
    
    RAISE NOTICE 'تم إنشاء الشجرة البسيطة بنجاح للشركة % - عدد الحسابات: ~40', p_company_id;
END;
$$;

COMMENT ON FUNCTION create_simple_chart_of_accounts(UUID) IS 'إنشاء شجرة حسابات بسيطة (~40 حساب) للشركة - 9 لغات';

-- ═══════════════════════════════════════════════════════════════
-- 4. دالة الشجرة الموسعة (~80 حساب)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_extended_chart_of_accounts(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_current_asset_type_id UUID;
    v_current_liability_type_id UUID;
    v_equity_type_id UUID;
    v_revenue_type_id UUID;
    v_expense_type_id UUID;
    v_other_income_type_id UUID;
    v_other_expense_type_id UUID;
    
    -- Parent IDs from existing simple chart
    v_cash_parent_id UUID;
    v_bank_parent_id UUID;
    v_receivables_parent_id UUID;
    v_inventory_parent_id UUID;
    v_prepaid_parent_id UUID;
    v_payables_parent_id UUID;
    v_partners_parent_id UUID;
    v_sales_parent_id UUID;
    v_cogs_parent_id UUID;
    v_payroll_parent_id UUID;
    v_operating_parent_id UUID;
    v_admin_parent_id UUID;
    v_marketing_parent_id UUID;
    v_financial_parent_id UUID;
BEGIN
    -- Get tenant_id
    SELECT tenant_id INTO v_tenant_id FROM companies WHERE id = p_company_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'الشركة غير موجودة';
    END IF;
    
    -- التحقق من وجود الشجرة البسيطة أولاً
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1000') THEN
        -- إنشاء الشجرة البسيطة أولاً
        PERFORM create_simple_chart_of_accounts(p_company_id);
    END IF;
    
    -- Get account type IDs
    SELECT id INTO v_current_asset_type_id FROM account_types WHERE code = 'CURRENT_ASSET';
    SELECT id INTO v_current_liability_type_id FROM account_types WHERE code = 'CURRENT_LIABILITY';
    SELECT id INTO v_equity_type_id FROM account_types WHERE code = 'EQUITY';
    SELECT id INTO v_revenue_type_id FROM account_types WHERE code = 'REVENUE';
    SELECT id INTO v_expense_type_id FROM account_types WHERE code = 'EXPENSE';
    SELECT id INTO v_other_income_type_id FROM account_types WHERE code = 'OTHER_INCOME';
    SELECT id INTO v_other_expense_type_id FROM account_types WHERE code = 'OTHER_EXPENSE';
    
    -- الحصول على معرفات الحسابات الأب
    SELECT id INTO v_receivables_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1130';
    SELECT id INTO v_payables_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2110';
    SELECT id INTO v_partners_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '3500';

    -- ═══════════════════════════════════════════════════════════════
    -- توسيع الأصول المتداولة
    -- ═══════════════════════════════════════════════════════════════
    
    -- تحويل الصندوق إلى مجموعة وإضافة فرعيات
    UPDATE chart_of_accounts SET is_group = true, is_detail = false WHERE company_id = p_company_id AND account_code = '1110';
    SELECT id INTO v_cash_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1110';
    
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_cash_account)
    VALUES 
        (v_tenant_id, p_company_id, '1111', 'الصندوق الرئيسي', 'Main Cash', 'Основная касса', 'Основна каса', 'Casa principală', 'Kasa główna', 'Ana Kasa', 'Hauptkasse', 'Cassa principale', v_current_asset_type_id, v_cash_parent_id, false, true, 4, '1000.1100.1110.1111', 'SAR', true, true),
        (v_tenant_id, p_company_id, '1112', 'صندوق العملات الأجنبية', 'Foreign Currency Cash', 'Валютная касса', 'Валютна каса', 'Casa valută', 'Kasa walutowa', 'Döviz Kasası', 'Fremdwährungskasse', 'Cassa valuta estera', v_current_asset_type_id, v_cash_parent_id, false, true, 4, '1000.1100.1110.1112', 'USD', true, true),
        (v_tenant_id, p_company_id, '1113', 'صندوق المصروفات النثرية', 'Petty Cash', 'Касса мелких расходов', 'Каса дрібних витрат', 'Casa mici cheltuieli', 'Kasa podręczna', 'Küçük Kasa', 'Handkasse', 'Piccola cassa', v_current_asset_type_id, v_cash_parent_id, false, true, 4, '1000.1100.1110.1113', 'SAR', true, true)
    ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING;
    
    -- تحويل البنك إلى مجموعة وإضافة فرعيات
    UPDATE chart_of_accounts SET is_group = true, is_detail = false WHERE company_id = p_company_id AND account_code = '1120';
    SELECT id INTO v_bank_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1120';
    
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_bank_account)
    VALUES 
        (v_tenant_id, p_company_id, '1121', 'البنك الرئيسي - محلي', 'Main Bank - Local', 'Основной банк - местный', 'Основний банк - місцевий', 'Banca principală - locală', 'Bank główny - lokalny', 'Ana Banka - Yerel', 'Hauptbank - Lokal', 'Banca principale - locale', v_current_asset_type_id, v_bank_parent_id, false, true, 4, '1000.1100.1120.1121', 'SAR', true, true),
        (v_tenant_id, p_company_id, '1122', 'البنك - عملات أجنبية', 'Bank - Foreign Currency', 'Банк - валютный', 'Банк - валютний', 'Bancă - valută', 'Bank - walutowy', 'Banka - Döviz', 'Bank - Fremdwährung', 'Banca - valuta estera', v_current_asset_type_id, v_bank_parent_id, false, true, 4, '1000.1100.1120.1122', 'USD', true, true)
    ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING;
    
    -- إضافة شيكات تحت التحصيل
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active)
    SELECT v_tenant_id, p_company_id, '1125', 'شيكات تحت التحصيل', 'Checks Under Collection', 'Чеки на инкассо', 'Чеки на інкасо', 'Cecuri în curs de încasare', 'Czeki do inkasa', 'Tahsildeki Çekler', 'Schecks zum Inkasso', 'Assegni in riscossione', v_current_asset_type_id, 
        (SELECT id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1100'), false, true, 3, '1000.1100.1125', 'SAR', true
    WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1125');
    
    -- توسيع العملاء
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_receivable)
    VALUES 
        (v_tenant_id, p_company_id, '1131', 'عملاء محليين', 'Local Customers', 'Местные клиенты', 'Місцеві клієнти', 'Clienți locali', 'Klienci lokalni', 'Yerel Müşteriler', 'Inlandskunden', 'Clienti locali', v_current_asset_type_id, v_receivables_parent_id, true, false, 4, '1000.1100.1130.1131', 'SAR', true, true),
        (v_tenant_id, p_company_id, '1132', 'عملاء خارجيين', 'Foreign Customers', 'Иностранные клиенты', 'Іноземні клієнти', 'Clienți străini', 'Klienci zagraniczni', 'Yabancı Müşteriler', 'Auslandskunden', 'Clienti esteri', v_current_asset_type_id, v_receivables_parent_id, true, false, 4, '1000.1100.1130.1132', 'SAR', true, true),
        (v_tenant_id, p_company_id, '1133', 'عملاء وكلاء', 'Agent Customers', 'Клиенты-агенты', 'Клієнти-агенти', 'Clienți agenți', 'Klienci agenci', 'Acente Müşteriler', 'Agentenkunden', 'Clienti agenti', v_current_asset_type_id, v_receivables_parent_id, true, false, 4, '1000.1100.1130.1133', 'SAR', true, true),
        (v_tenant_id, p_company_id, '1134', 'عملاء موزعين', 'Distributor Customers', 'Клиенты-дистрибьюторы', 'Клієнти-дистриб''ютори', 'Clienți distribuitori', 'Klienci dystrybutorzy', 'Distribütör Müşteriler', 'Vertriebskunden', 'Clienti distributori', v_current_asset_type_id, v_receivables_parent_id, true, false, 4, '1000.1100.1130.1134', 'SAR', true, true),
        (v_tenant_id, p_company_id, '1138', 'أوراق قبض', 'Notes Receivable', 'Векселя к получению', 'Векселі до отримання', 'Efecte de primit', 'Weksle do otrzymania', 'Alacak Senetleri', 'Wechselforderungen', 'Effetti attivi', v_current_asset_type_id, v_receivables_parent_id, false, true, 4, '1000.1100.1130.1138', 'SAR', true, true),
        (v_tenant_id, p_company_id, '1139', 'مخصص الديون المشكوك فيها', 'Allowance for Doubtful Debts', 'Резерв по сомнительным долгам', 'Резерв сумнівних боргів', 'Provizioane creanțe', 'Odpisy aktualizujące', 'Şüpheli Alacak Karşılığı', 'Wertberichtigung', 'Fondo svalutazione crediti', v_current_asset_type_id, v_receivables_parent_id, false, true, 4, '1000.1100.1130.1139', 'SAR', true, true)
    ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING;
    
    -- إضافة العهد والسلف
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active)
    SELECT v_tenant_id, p_company_id, '1170', 'العهد والسلف', 'Advances & Custody', 'Авансы и залоги', 'Аванси та застави', 'Avansuri și garanții', 'Zaliczki i depozyty', 'Avanslar ve Emanetler', 'Vorschüsse und Kautionen', 'Anticipi e cauzioni', v_current_asset_type_id, 
        (SELECT id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1100'), true, false, 3, '1000.1100.1170', 'SAR', true
    WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '1170');

    -- ═══════════════════════════════════════════════════════════════
    -- توسيع الخصوم
    -- ═══════════════════════════════════════════════════════════════
    
    -- توسيع الموردين
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active, is_payable)
    VALUES 
        (v_tenant_id, p_company_id, '2111', 'موردون محليين', 'Local Suppliers', 'Местные поставщики', 'Місцеві постачальники', 'Furnizori locali', 'Dostawcy lokalni', 'Yerel Tedarikçiler', 'Inlandslieferanten', 'Fornitori locali', v_current_liability_type_id, v_payables_parent_id, true, false, 4, '2000.2100.2110.2111', 'SAR', true, true),
        (v_tenant_id, p_company_id, '2112', 'موردون خارجيين', 'Foreign Suppliers', 'Иностранные поставщики', 'Іноземні постачальники', 'Furnizori străini', 'Dostawcy zagraniczni', 'Yabancı Tedarikçiler', 'Auslandslieferanten', 'Fornitori esteri', v_current_liability_type_id, v_payables_parent_id, true, false, 4, '2000.2100.2110.2112', 'SAR', true, true),
        (v_tenant_id, p_company_id, '2118', 'أوراق دفع', 'Notes Payable', 'Векселя к оплате', 'Векселі до сплати', 'Efecte de plătit', 'Weksle do zapłaty', 'Borç Senetleri', 'Wechselverbindlichkeiten', 'Effetti passivi', v_current_liability_type_id, v_payables_parent_id, false, true, 4, '2000.2100.2110.2118', 'SAR', true, true)
    ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING;
    
    -- إضافة شيكات صادرة
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active)
    SELECT v_tenant_id, p_company_id, '2150', 'شيكات صادرة', 'Checks Issued', 'Выданные чеки', 'Видані чеки', 'Cecuri emise', 'Czeki wystawione', 'Verilen Çekler', 'Ausgestellte Schecks', 'Assegni emessi', v_current_liability_type_id, 
        (SELECT id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2100'), false, true, 3, '2000.2100.2150', 'SAR', true
    WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '2150');

    -- ═══════════════════════════════════════════════════════════════
    -- توسيع حقوق الملكية - جاري الشركاء
    -- ═══════════════════════════════════════════════════════════════
    
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active)
    VALUES 
        (v_tenant_id, p_company_id, '3510', 'جاري الشريك 1', 'Partner 1 Current', 'Текущий счет партнера 1', 'Поточний рахунок партнера 1', 'Cont curent asociat 1', 'Konto wspólnika 1', 'Ortak 1 Cari', 'Gesellschafter 1 Konto', 'Conto socio 1', v_equity_type_id, v_partners_parent_id, false, true, 3, '3000.3500.3510', 'SAR', true),
        (v_tenant_id, p_company_id, '3520', 'جاري الشريك 2', 'Partner 2 Current', 'Текущий счет партнера 2', 'Поточний рахунок партнера 2', 'Cont curent asociat 2', 'Konto wspólnika 2', 'Ortak 2 Cari', 'Gesellschafter 2 Konto', 'Conto socio 2', v_equity_type_id, v_partners_parent_id, false, true, 3, '3000.3500.3520', 'SAR', true),
        (v_tenant_id, p_company_id, '3530', 'جاري الشريك 3', 'Partner 3 Current', 'Текущий счет партнера 3', 'Поточний рахунок партнера 3', 'Cont curent asociat 3', 'Konto wspólnika 3', 'Ortak 3 Cari', 'Gesellschafter 3 Konto', 'Conto socio 3', v_equity_type_id, v_partners_parent_id, false, true, 3, '3000.3500.3530', 'SAR', true)
    ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING;
    
    -- إضافة فروقات صرف العملات
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active)
    SELECT v_tenant_id, p_company_id, '3600', 'فروقات صرف العملات', 'Currency Exchange Differences', 'Курсовые разницы', 'Курсові різниці', 'Diferențe de curs', 'Różnice kursowe', 'Kur Farkları', 'Währungsdifferenzen', 'Differenze cambio', v_equity_type_id, 
        (SELECT id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '3000'), true, false, 2, '3000.3600', 'SAR', true
    WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '3600');

    -- ═══════════════════════════════════════════════════════════════
    -- توسيع الإيرادات
    -- ═══════════════════════════════════════════════════════════════
    
    -- تحويل المبيعات إلى مجموعة
    UPDATE chart_of_accounts SET is_group = true, is_detail = false WHERE company_id = p_company_id AND account_code = '4100';
    SELECT id INTO v_sales_parent_id FROM chart_of_accounts WHERE company_id = p_company_id AND account_code = '4100';
    
    INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, name_ru, name_uk, name_ro, name_pl, name_tr, name_de, name_it, account_type_id, parent_id, is_group, is_detail, level, full_code, currency, is_active)
    VALUES 
        (v_tenant_id, p_company_id, '4110', 'مبيعات بضاعة', 'Product Sales', 'Продажа товаров', 'Продаж товарів', 'Vânzări produse', 'Sprzedaż towarów', 'Ürün Satışları', 'Warenverkäufe', 'Vendite prodotti', v_revenue_type_id, v_sales_parent_id, false, true, 3, '4000.4100.4110', 'SAR', true),
        (v_tenant_id, p_company_id, '4120', 'مبيعات خدمات', 'Service Sales', 'Продажа услуг', 'Продаж послуг', 'Vânzări servicii', 'Sprzedaż usług', 'Hizmet Satışları', 'Dienstleistungserlöse', 'Vendite servizi', v_revenue_type_id, v_sales_parent_id, false, true, 3, '4000.4100.4120', 'SAR', true),
        (v_tenant_id, p_company_id, '4150', 'خصم مسموح به', 'Sales Discounts', 'Скидки продаж', 'Знижки продаж', 'Reduceri acordate', 'Rabaty udzielone', 'Satış İskontoları', 'Erlösschmälerungen', 'Sconti vendite', v_revenue_type_id, v_sales_parent_id, false, true, 3, '4000.4100.4150', 'SAR', true)
    ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING;

    -- تحديث نوع الشجرة للشركة
    UPDATE companies SET chart_type = 'extended' WHERE id = p_company_id;
    
    RAISE NOTICE 'تم إنشاء/ترقية الشجرة الموسعة بنجاح للشركة % - عدد الحسابات: ~80', p_company_id;
END;
$$;

COMMENT ON FUNCTION create_extended_chart_of_accounts(UUID) IS 'إنشاء شجرة حسابات موسعة (~80 حساب) للشركة - 9 لغات';

-- ═══════════════════════════════════════════════════════════════
-- 5. دالة الترقية من الشجرة البسيطة للموسعة
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION upgrade_to_extended_chart(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_chart_type VARCHAR(20);
BEGIN
    -- التحقق من نوع الشجرة الحالي
    SELECT chart_type INTO v_chart_type FROM companies WHERE id = p_company_id;
    
    IF v_chart_type = 'extended' THEN
        RAISE NOTICE 'الشركة لديها شجرة موسعة مسبقاً';
        RETURN;
    END IF;
    
    IF v_chart_type IS NULL OR v_chart_type = '' THEN
        -- لا توجد شجرة، إنشاء شجرة موسعة مباشرة
        PERFORM create_extended_chart_of_accounts(p_company_id);
    ELSE
        -- ترقية من البسيطة للموسعة
        PERFORM create_extended_chart_of_accounts(p_company_id);
    END IF;
    
    RAISE NOTICE 'تمت ترقية الشجرة بنجاح للشركة %', p_company_id;
END;
$$;

COMMENT ON FUNCTION upgrade_to_extended_chart(UUID) IS 'ترقية شجرة الحسابات من البسيطة (~40) إلى الموسعة (~80)';

-- ═══════════════════════════════════════════════════════════════
-- 6. Trigger إنشاء الشجرة عند إنشاء شركة جديدة
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION on_company_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- إنشاء الشجرة البسيطة تلقائياً للشركة الجديدة
    PERFORM create_simple_chart_of_accounts(NEW.id);
    
    RAISE NOTICE 'تم إنشاء شجرة الحسابات تلقائياً للشركة الجديدة: %', NEW.id;
    
    RETURN NEW;
END;
$$;

-- حذف الـ Trigger إذا كان موجوداً
DROP TRIGGER IF EXISTS trg_on_company_created ON companies;

-- إنشاء الـ Trigger
CREATE TRIGGER trg_on_company_created
    AFTER INSERT ON companies
    FOR EACH ROW
    EXECUTE FUNCTION on_company_created();

COMMENT ON TRIGGER trg_on_company_created ON companies IS 'إنشاء شجرة الحسابات البسيطة تلقائياً عند إنشاء شركة جديدة';

-- ═══════════════════════════════════════════════════════════════
-- 7. Trigger إنشاء حساب للعميل الجديد
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_customer_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_parent_id UUID;
    v_account_type_id UUID;
    v_new_code VARCHAR(50);
    v_new_account_id UUID;
    v_full_code VARCHAR(200);
BEGIN
    -- الحصول على حساب العملاء الأب (1130)
    SELECT id INTO v_parent_id 
    FROM chart_of_accounts 
    WHERE company_id = NEW.company_id 
      AND account_code = '1130';
    
    IF v_parent_id IS NULL THEN
        -- لا توجد شجرة حسابات، تخطي
        RAISE NOTICE 'لا توجد شجرة حسابات للشركة، تخطي إنشاء حساب العميل';
        RETURN NEW;
    END IF;
    
    -- الحصول على نوع الحساب
    SELECT id INTO v_account_type_id FROM account_types WHERE code = 'CURRENT_ASSET';
    
    -- توليد رقم الحساب الجديد
    v_new_code := generate_next_account_code(NEW.tenant_id, NEW.company_id, '1130');
    v_full_code := '1000.1100.1130.' || v_new_code;
    
    -- إنشاء الحساب الفرعي للعميل
    INSERT INTO chart_of_accounts (
        tenant_id, company_id, account_code, 
        name_ar, name_en, 
        account_type_id, parent_id, 
        is_group, is_detail, level, full_code, 
        currency, is_active, is_receivable
    )
    VALUES (
        NEW.tenant_id, NEW.company_id, v_new_code,
        NEW.name_ar, COALESCE(NEW.name_en, NEW.name_ar),
        v_account_type_id, v_parent_id,
        false, true, 4, v_full_code,
        COALESCE(NEW.currency, 'SAR'), true, true
    )
    RETURNING id INTO v_new_account_id;
    
    -- تحديث العميل بربط الحساب
    NEW.receivable_account_id := v_new_account_id;
    
    RAISE NOTICE 'تم إنشاء حساب للعميل: % - رقم الحساب: %', NEW.name_ar, v_new_code;
    
    RETURN NEW;
END;
$$;

-- حذف الـ Trigger إذا كان موجوداً
DROP TRIGGER IF EXISTS trg_create_customer_account ON customers;

-- إنشاء الـ Trigger
CREATE TRIGGER trg_create_customer_account
    BEFORE INSERT ON customers
    FOR EACH ROW
    EXECUTE FUNCTION create_customer_account();

COMMENT ON TRIGGER trg_create_customer_account ON customers IS 'إنشاء حساب فرعي تلقائياً لكل عميل جديد تحت حساب 1130';

-- ═══════════════════════════════════════════════════════════════
-- 8. Trigger إنشاء حساب للمورد الجديد
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_supplier_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_parent_id UUID;
    v_account_type_id UUID;
    v_new_code VARCHAR(50);
    v_new_account_id UUID;
    v_full_code VARCHAR(200);
BEGIN
    -- الحصول على حساب الموردين الأب (2110)
    SELECT id INTO v_parent_id 
    FROM chart_of_accounts 
    WHERE company_id = NEW.company_id 
      AND account_code = '2110';
    
    IF v_parent_id IS NULL THEN
        -- لا توجد شجرة حسابات، تخطي
        RAISE NOTICE 'لا توجد شجرة حسابات للشركة، تخطي إنشاء حساب المورد';
        RETURN NEW;
    END IF;
    
    -- الحصول على نوع الحساب
    SELECT id INTO v_account_type_id FROM account_types WHERE code = 'CURRENT_LIABILITY';
    
    -- توليد رقم الحساب الجديد
    v_new_code := generate_next_account_code(NEW.tenant_id, NEW.company_id, '2110');
    v_full_code := '2000.2100.2110.' || v_new_code;
    
    -- إنشاء الحساب الفرعي للمورد
    INSERT INTO chart_of_accounts (
        tenant_id, company_id, account_code, 
        name_ar, name_en, 
        account_type_id, parent_id, 
        is_group, is_detail, level, full_code, 
        currency, is_active, is_payable
    )
    VALUES (
        NEW.tenant_id, NEW.company_id, v_new_code,
        NEW.name_ar, COALESCE(NEW.name_en, NEW.name_ar),
        v_account_type_id, v_parent_id,
        false, true, 4, v_full_code,
        COALESCE(NEW.currency, 'SAR'), true, true
    )
    RETURNING id INTO v_new_account_id;
    
    -- تحديث المورد بربط الحساب
    NEW.payable_account_id := v_new_account_id;
    
    RAISE NOTICE 'تم إنشاء حساب للمورد: % - رقم الحساب: %', NEW.name_ar, v_new_code;
    
    RETURN NEW;
END;
$$;

-- حذف الـ Trigger إذا كان موجوداً
DROP TRIGGER IF EXISTS trg_create_supplier_account ON suppliers;

-- إنشاء الـ Trigger
CREATE TRIGGER trg_create_supplier_account
    BEFORE INSERT ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION create_supplier_account();

COMMENT ON TRIGGER trg_create_supplier_account ON suppliers IS 'إنشاء حساب فرعي تلقائياً لكل مورد جديد تحت حساب 2110';

-- ═══════════════════════════════════════════════════════════════
-- نهاية المرحلة 1: البنية التحتية المحاسبية
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'تم إنشاء المرحلة 1: البنية التحتية المحاسبية بنجاح';
    RAISE NOTICE '- دالة generate_next_account_code';
    RAISE NOTICE '- دالة create_simple_chart_of_accounts (~40 حساب)';
    RAISE NOTICE '- دالة create_extended_chart_of_accounts (~80 حساب)';
    RAISE NOTICE '- دالة upgrade_to_extended_chart';
    RAISE NOTICE '- Trigger إنشاء الشجرة عند إنشاء شركة';
    RAISE NOTICE '- Trigger إنشاء حساب للعميل الجديد';
    RAISE NOTICE '- Trigger إنشاء حساب للمورد الجديد';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
