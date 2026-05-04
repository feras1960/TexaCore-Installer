-- ═══════════════════════════════════════════════════════════════
-- 🌐 Translate Chart of Accounts → Russian & Ukrainian
-- ═══════════════════════════════════════════════════════════════

-- ═══ 1. Assets (Активы / Активи) ═══
UPDATE chart_of_accounts SET name_ru = 'Активы', name_uk = 'Активи' WHERE account_code = '1' AND name_en = 'Assets';
UPDATE chart_of_accounts SET name_ru = 'Оборотные активы', name_uk = 'Оборотні активи' WHERE account_code = '11';
UPDATE chart_of_accounts SET name_ru = 'Касса', name_uk = 'Каса' WHERE account_code = '111';
UPDATE chart_of_accounts SET name_ru = 'Касса - Местная валюта', name_uk = 'Каса - Місцева валюта' WHERE account_code = '1111';
UPDATE chart_of_accounts SET name_ru = 'Касса - Базовая валюта', name_uk = 'Каса - Базова валюта' WHERE account_code = '1112';
UPDATE chart_of_accounts SET name_ru = 'Мелкая наличность', name_uk = 'Дрібна готівка' WHERE account_code = '1113';
UPDATE chart_of_accounts SET name_ru = 'Банки', name_uk = 'Банки' WHERE account_code = '112';
UPDATE chart_of_accounts SET name_ru = 'Банк - Местная валюта', name_uk = 'Банк - Місцева валюта' WHERE account_code = '1121';
UPDATE chart_of_accounts SET name_ru = 'Банк - Базовая валюта', name_uk = 'Банк - Базова валюта' WHERE account_code = '1122';
UPDATE chart_of_accounts SET name_ru = 'Дебиторская задолженность', name_uk = 'Дебіторська заборгованість' WHERE account_code = '113';
UPDATE chart_of_accounts SET name_ru = 'Оптовые дебиторы', name_uk = 'Оптові дебітори' WHERE account_code = '1131';
UPDATE chart_of_accounts SET name_ru = 'Итого дебиторы', name_uk = 'Разом дебітори' WHERE account_code = '1131-SUM';
UPDATE chart_of_accounts SET name_ru = 'Розничные дебиторы', name_uk = 'Роздрібні дебітори' WHERE account_code = '1132';
UPDATE chart_of_accounts SET name_ru = 'Векселя к получению', name_uk = 'Векселі до отримання' WHERE account_code = '1133';
UPDATE chart_of_accounts SET name_ru = 'Запасы', name_uk = 'Запаси' WHERE account_code = '114';
UPDATE chart_of_accounts SET name_ru = 'Готовая продукция', name_uk = 'Готова продукція' WHERE account_code = '1141';
UPDATE chart_of_accounts SET name_ru = 'Сырьё и материалы', name_uk = 'Сировина та матеріали' WHERE account_code = '1142';
UPDATE chart_of_accounts SET name_ru = 'Закупки в пути', name_uk = 'Закупівлі в дорозі' WHERE account_code = '1145';
UPDATE chart_of_accounts SET name_ru = 'Товары в пути', name_uk = 'Товари в дорозі' WHERE account_code = '115';
UPDATE chart_of_accounts SET name_ru = 'Расходы будущих периодов', name_uk = 'Витрати майбутніх періодів' WHERE account_code = '116';
UPDATE chart_of_accounts SET name_ru = 'НДС входящий', name_uk = 'ПДВ вхідний' WHERE account_code = '117';
UPDATE chart_of_accounts SET name_ru = 'Авансы поставщикам', name_uk = 'Аванси постачальникам' WHERE account_code = '118';

-- Fixed Assets
UPDATE chart_of_accounts SET name_ru = 'Основные средства', name_uk = 'Основні засоби' WHERE account_code = '12';
UPDATE chart_of_accounts SET name_ru = 'Здания и склады', name_uk = 'Будівлі та склади' WHERE account_code = '121';
UPDATE chart_of_accounts SET name_ru = 'Складское оборудование', name_uk = 'Складське обладнання' WHERE account_code = '122';
UPDATE chart_of_accounts SET name_ru = 'Мебель и оснащение', name_uk = 'Меблі та обладнання' WHERE account_code = '123';
UPDATE chart_of_accounts SET name_ru = 'Транспортные средства', name_uk = 'Транспортні засоби' WHERE account_code = '124';
UPDATE chart_of_accounts SET name_ru = 'ИТ и системы', name_uk = 'ІТ та системи' WHERE account_code = '125';
UPDATE chart_of_accounts SET name_ru = 'Накопленная амортизация', name_uk = 'Накопичена амортизація' WHERE account_code = '129';

-- Exchange & Remittance Receivables
UPDATE chart_of_accounts SET name_ru = 'Обменные и переводные дебиторы', name_uk = 'Обмінні та переказні дебітори' WHERE account_code = '13';
UPDATE chart_of_accounts SET name_ru = 'Исходящие переводы к получению', name_uk = 'Вихідні перекази до отримання' WHERE account_code = '131';
UPDATE chart_of_accounts SET name_ru = 'Входящие переводы к получению', name_uk = 'Вхідні перекази до отримання' WHERE account_code = '132';
UPDATE chart_of_accounts SET name_ru = 'Счета клиентов обмена', name_uk = 'Рахунки клієнтів обміну' WHERE account_code = '133';
UPDATE chart_of_accounts SET name_ru = 'Итого дебиторов обмена', name_uk = 'Разом дебіторів обміну' WHERE account_code = '133-SUM';
UPDATE chart_of_accounts SET name_ru = 'Счета агентов текущие', name_uk = 'Поточні рахунки агентів' WHERE account_code = '134';
UPDATE chart_of_accounts SET name_ru = 'Итого счета агентов', name_uk = 'Разом рахунки агентів' WHERE account_code = '134-SUM';
UPDATE chart_of_accounts SET name_ru = 'Счета партнёров текущие', name_uk = 'Поточні рахунки партнерів' WHERE account_code = '135';
UPDATE chart_of_accounts SET name_ru = 'Итого счета партнёров', name_uk = 'Разом рахунки партнерів' WHERE account_code = '135-SUM';

-- ═══ 2. Liabilities (Обязательства / Зобов'язання) ═══
UPDATE chart_of_accounts SET name_ru = 'Обязательства', name_uk = 'Зобов''язання' WHERE account_code = '2' AND name_en = 'Liabilities';
UPDATE chart_of_accounts SET name_ru = 'Краткосрочные обязательства', name_uk = 'Поточні зобов''язання' WHERE account_code = '21';
UPDATE chart_of_accounts SET name_ru = 'Кредиторская задолженность', name_uk = 'Кредиторська заборгованість' WHERE account_code = '211';
UPDATE chart_of_accounts SET name_ru = 'Основные поставщики', name_uk = 'Основні постачальники' WHERE account_code = '2111';
UPDATE chart_of_accounts SET name_ru = 'Итого кредиторы', name_uk = 'Разом кредитори' WHERE account_code = '2111-SUM';
UPDATE chart_of_accounts SET name_ru = 'Прочие поставщики', name_uk = 'Інші постачальники' WHERE account_code = '2112';
UPDATE chart_of_accounts SET name_ru = 'Логистические поставщики', name_uk = 'Логістичні постачальники' WHERE account_code = '212';
UPDATE chart_of_accounts SET name_ru = 'Морские перевозки', name_uk = 'Морські перевезення' WHERE account_code = '2121';
UPDATE chart_of_accounts SET name_ru = 'Таможенное оформление', name_uk = 'Митне оформлення' WHERE account_code = '2122';
UPDATE chart_of_accounts SET name_ru = 'Внутренний транспорт', name_uk = 'Внутрішній транспорт' WHERE account_code = '2123';
UPDATE chart_of_accounts SET name_ru = 'Страховые компании', name_uk = 'Страхові компанії' WHERE account_code = '2124';
UPDATE chart_of_accounts SET name_ru = 'Прочая логистика', name_uk = 'Інша логістика' WHERE account_code = '2125';
UPDATE chart_of_accounts SET name_ru = 'Начисленная зарплата', name_uk = 'Нарахована зарплата' WHERE account_code = '213';
UPDATE chart_of_accounts SET name_ru = 'Итого задолженность сотрудникам', name_uk = 'Разом заборгованість працівникам' WHERE account_code = '213-SUM';
UPDATE chart_of_accounts SET name_ru = 'НДС исходящий', name_uk = 'ПДВ вихідний' WHERE account_code = '214';
UPDATE chart_of_accounts SET name_ru = 'Авансы клиентов', name_uk = 'Аванси клієнтів' WHERE account_code = '215';
UPDATE chart_of_accounts SET name_ru = 'Налоги к уплате', name_uk = 'Податки до сплати' WHERE account_code = '216';
UPDATE chart_of_accounts SET name_ru = 'Векселя к оплате', name_uk = 'Векселі до оплати' WHERE account_code = '217';
UPDATE chart_of_accounts SET name_ru = 'Долгосрочные обязательства', name_uk = 'Довгострокові зобов''язання' WHERE account_code = '22';
UPDATE chart_of_accounts SET name_ru = 'Долгосрочные кредиты', name_uk = 'Довгострокові кредити' WHERE account_code = '221';
UPDATE chart_of_accounts SET name_ru = 'Обязательства по аренде', name_uk = 'Зобов''язання з оренди' WHERE account_code = '222';
UPDATE chart_of_accounts SET name_ru = 'Обменные и переводные обязательства', name_uk = 'Обмінні та переказні зобов''язання' WHERE account_code = '23';
UPDATE chart_of_accounts SET name_ru = 'Переводы к оплате', name_uk = 'Перекази до оплати' WHERE account_code = '231';
UPDATE chart_of_accounts SET name_ru = 'Задолженность агентам', name_uk = 'Заборгованість агентам' WHERE account_code = '232';
UPDATE chart_of_accounts SET name_ru = 'Задолженность партнёрам', name_uk = 'Заборгованість партнерам' WHERE account_code = '233';

-- ═══ 3. Equity (Капитал / Капітал) ═══
UPDATE chart_of_accounts SET name_ru = 'Капитал', name_uk = 'Капітал' WHERE account_code = '3' AND name_en = 'Equity';
UPDATE chart_of_accounts SET name_ru = 'Уставный капитал', name_uk = 'Статутний капітал' WHERE account_code = '31';
UPDATE chart_of_accounts SET name_ru = 'Нераспределённая прибыль', name_uk = 'Нерозподілений прибуток' WHERE account_code = '32';
UPDATE chart_of_accounts SET name_ru = 'П/У текущего года', name_uk = 'П/З поточного року' WHERE account_code = '33';
UPDATE chart_of_accounts SET name_ru = 'Резервы', name_uk = 'Резерви' WHERE account_code = '34';
UPDATE chart_of_accounts SET name_ru = 'Начальный баланс капитала', name_uk = 'Початковий баланс капіталу' WHERE account_code = '35';

-- ═══ 4. Revenue (Доходы / Доходи) ═══
UPDATE chart_of_accounts SET name_ru = 'Доходы', name_uk = 'Доходи' WHERE account_code = '4' AND name_en = 'Revenue';
UPDATE chart_of_accounts SET name_ru = 'Операционные и торговые доходы', name_uk = 'Операційні та торговельні доходи' WHERE account_code = '41';
UPDATE chart_of_accounts SET name_ru = 'Продажи', name_uk = 'Продажі' WHERE account_code = '411';
UPDATE chart_of_accounts SET name_ru = 'Доход от услуг', name_uk = 'Дохід від послуг' WHERE account_code = '412';
UPDATE chart_of_accounts SET name_ru = 'Скидки продаж', name_uk = 'Знижки продажів' WHERE account_code = '413';
UPDATE chart_of_accounts SET name_ru = 'Возвраты продаж', name_uk = 'Повернення продажів' WHERE account_code = '414';
UPDATE chart_of_accounts SET name_ru = 'Прочие доходы', name_uk = 'Інші доходи' WHERE account_code = '42';
UPDATE chart_of_accounts SET name_ru = 'Прочий доход', name_uk = 'Інший дохід' WHERE account_code = '421';
UPDATE chart_of_accounts SET name_ru = 'Курсовая прибыль', name_uk = 'Курсовий прибуток' WHERE account_code = '422';
UPDATE chart_of_accounts SET name_ru = 'Процентный доход', name_uk = 'Процентний дохід' WHERE account_code = '423';
UPDATE chart_of_accounts SET name_ru = 'Обменные и переводные доходы', name_uk = 'Обмінні та переказні доходи' WHERE account_code = '43';
UPDATE chart_of_accounts SET name_ru = 'Комиссия за обмен', name_uk = 'Комісія за обмін' WHERE account_code = '431';
UPDATE chart_of_accounts SET name_ru = 'Комиссия за переводы', name_uk = 'Комісія за перекази' WHERE account_code = '432';
UPDATE chart_of_accounts SET name_ru = 'Курсовая прибыль - обмен', name_uk = 'Курсовий прибуток - обмін' WHERE account_code = '433';

-- ═══ 5. Expenses (Расходы / Витрати) ═══
UPDATE chart_of_accounts SET name_ru = 'Расходы', name_uk = 'Витрати' WHERE account_code = '5' AND name_en = 'Expenses';
UPDATE chart_of_accounts SET name_ru = 'Себестоимость', name_uk = 'Собівартість' WHERE account_code = '51';
UPDATE chart_of_accounts SET name_ru = 'Основная себестоимость', name_uk = 'Основна собівартість' WHERE account_code = '511';
UPDATE chart_of_accounts SET name_ru = 'Общая себестоимость', name_uk = 'Загальна собівартість' WHERE account_code = '512';
UPDATE chart_of_accounts SET name_ru = 'Себестоимость услуг', name_uk = 'Собівартість послуг' WHERE account_code = '513';
UPDATE chart_of_accounts SET name_ru = 'Закупки', name_uk = 'Закупівлі' WHERE account_code = '52';
UPDATE chart_of_accounts SET name_ru = 'Общие закупки', name_uk = 'Загальні закупівлі' WHERE account_code = '521';
UPDATE chart_of_accounts SET name_ru = 'Возвраты закупок', name_uk = 'Повернення закупівель' WHERE account_code = '522';
UPDATE chart_of_accounts SET name_ru = 'Скидки закупок', name_uk = 'Знижки закупівель' WHERE account_code = '523';
UPDATE chart_of_accounts SET name_ru = 'Операционные расходы', name_uk = 'Операційні витрати' WHERE account_code = '53';
UPDATE chart_of_accounts SET name_ru = 'Зарплаты', name_uk = 'Зарплати' WHERE account_code = '531';
UPDATE chart_of_accounts SET name_ru = 'Аренда', name_uk = 'Оренда' WHERE account_code = '532';
UPDATE chart_of_accounts SET name_ru = 'Коммунальные услуги', name_uk = 'Комунальні послуги' WHERE account_code = '533';
UPDATE chart_of_accounts SET name_ru = 'Маркетинговые расходы', name_uk = 'Маркетингові витрати' WHERE account_code = '534';
UPDATE chart_of_accounts SET name_ru = 'Административные расходы', name_uk = 'Адміністративні витрати' WHERE account_code = '535';
UPDATE chart_of_accounts SET name_ru = 'Расходы обмена', name_uk = 'Витрати обміну' WHERE account_code = '54';
UPDATE chart_of_accounts SET name_ru = 'Комиссия агентам', name_uk = 'Комісія агентам' WHERE account_code = '541';
UPDATE chart_of_accounts SET name_ru = 'Комиссия партнёрам', name_uk = 'Комісія партнерам' WHERE account_code = '542';
UPDATE chart_of_accounts SET name_ru = 'Курсовой убыток - обмен', name_uk = 'Курсовий збиток - обмін' WHERE account_code = '543';
UPDATE chart_of_accounts SET name_ru = 'Расходы на закупки и доставку', name_uk = 'Витрати на закупівлі та доставку' WHERE account_code = '58';
UPDATE chart_of_accounts SET name_ru = 'Транспортные расходы', name_uk = 'Транспортні витрати' WHERE account_code = '581';
UPDATE chart_of_accounts SET name_ru = 'Таможенные расходы', name_uk = 'Митні витрати' WHERE account_code = '582';
UPDATE chart_of_accounts SET name_ru = 'Морское и грузовое страхование', name_uk = 'Морське та вантажне страхування' WHERE account_code = '583';
UPDATE chart_of_accounts SET name_ru = 'Прочие расходы на закупки', name_uk = 'Інші витрати на закупівлі' WHERE account_code = '584';
UPDATE chart_of_accounts SET name_ru = 'Прочие расходы (группа)', name_uk = 'Інші витрати (група)' WHERE account_code = '59';
UPDATE chart_of_accounts SET name_ru = 'Курсовые убытки', name_uk = 'Курсові збитки' WHERE account_code = '591';
UPDATE chart_of_accounts SET name_ru = 'Отклонения запасов', name_uk = 'Відхилення запасів' WHERE account_code = '592';
UPDATE chart_of_accounts SET name_ru = 'Расходы на обслуживание', name_uk = 'Витрати на обслуговування' WHERE account_code = '593';
UPDATE chart_of_accounts SET name_ru = 'Расходы на страхование', name_uk = 'Витрати на страхування' WHERE account_code = '594';
UPDATE chart_of_accounts SET name_ru = 'Юридические и профессиональные', name_uk = 'Юридичні та професійні' WHERE account_code = '595';
UPDATE chart_of_accounts SET name_ru = 'Прочие расходы', name_uk = 'Інші витрати' WHERE account_code = '596';
UPDATE chart_of_accounts SET name_ru = 'Амортизация', name_uk = 'Амортизація' WHERE account_code = '597';
UPDATE chart_of_accounts SET name_ru = 'Банковские комиссии', name_uk = 'Банківські комісії' WHERE account_code = '598';

-- ═══ Handle 134-001 (empty name) ═══
UPDATE chart_of_accounts SET name_ru = name_en, name_uk = name_en WHERE account_code = '134-001' AND (name_ru IS NULL OR name_ru = '');
