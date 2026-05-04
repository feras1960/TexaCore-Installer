-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00013: ربط الفواتير بالمحاسبة
-- Invoice Accounting Triggers
-- ═══════════════════════════════════════════════════════════════════════════
-- المحتويات:
-- 1. Trigger فاتورة مبيعات -> قيد يومي
-- 2. Trigger فاتورة مشتريات -> قيد يومي
-- 3. Trigger سند قبض -> قيد يومي
-- 4. Trigger سند صرف -> قيد يومي
-- 5. Trigger فاتورة مبيعات -> خصم مخزون
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- دالة مساعدة: الحصول على حساب بالكود
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_account_by_code(
    p_company_id UUID,
    p_account_code VARCHAR(50)
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_account_id UUID;
BEGIN
    SELECT id INTO v_account_id
    FROM chart_of_accounts
    WHERE company_id = p_company_id
      AND account_code = p_account_code
      AND is_active = true;
    
    RETURN v_account_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 1. Trigger فاتورة مبيعات -> قيد يومي
-- ═══════════════════════════════════════════════════════════════
-- القيد:
-- مدين: حساب العميل (receivable_account_id) = المبلغ الإجمالي
-- دائن: المبيعات (4100) = المبلغ قبل الضريبة
-- دائن: ضريبة القيمة المضافة - مخرجات (2130) = مبلغ الضريبة

CREATE OR REPLACE FUNCTION create_sales_invoice_journal_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry_id UUID;
    v_entry_number VARCHAR(50);
    v_customer_account_id UUID;
    v_sales_account_id UUID;
    v_vat_account_id UUID;
    v_fiscal_year_id UUID;
BEGIN
    -- فقط عند تأكيد الفاتورة (posted)
    IF NEW.status != 'posted' OR NEW.is_posted = false THEN
        RETURN NEW;
    END IF;
    
    -- تخطي إذا كان القيد موجود مسبقاً
    IF NEW.journal_entry_id IS NOT NULL THEN
        RETURN NEW;
    END IF;
    
    -- الحصول على حساب العميل
    v_customer_account_id := (
        SELECT receivable_account_id 
        FROM customers 
        WHERE id = NEW.customer_id
    );
    
    IF v_customer_account_id IS NULL THEN
        -- استخدام حساب العملاء العام
        v_customer_account_id := get_account_by_code(NEW.company_id, '1130');
    END IF;
    
    -- الحصول على حساب المبيعات
    v_sales_account_id := get_account_by_code(NEW.company_id, '4100');
    IF v_sales_account_id IS NULL THEN
        RAISE EXCEPTION 'حساب المبيعات (4100) غير موجود';
    END IF;
    
    -- الحصول على حساب ضريبة القيمة المضافة
    v_vat_account_id := get_account_by_code(NEW.company_id, '2130');
    
    -- الحصول على السنة المالية الحالية
    SELECT id INTO v_fiscal_year_id
    FROM fiscal_years
    WHERE company_id = NEW.company_id
      AND is_current = true
    LIMIT 1;
    
    -- توليد رقم القيد
    v_entry_number := 'JE-SI-' || NEW.invoice_number;
    
    -- إنشاء القيد اليومي
    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id,
        entry_number, entry_date,
        fiscal_year_id,
        entry_type,
        reference_type, reference_id, reference_number,
        description,
        currency, exchange_rate,
        total_debit, total_credit,
        status, is_posted, posted_at,
        created_by, created_at
    )
    VALUES (
        NEW.tenant_id, NEW.company_id, NEW.branch_id,
        v_entry_number, NEW.invoice_date,
        v_fiscal_year_id,
        'sales_invoice',
        'sales_invoice', NEW.id, NEW.invoice_number,
        'قيد فاتورة مبيعات رقم ' || NEW.invoice_number,
        NEW.currency, NEW.exchange_rate,
        NEW.total_amount, NEW.total_amount,
        'posted', true, NOW(),
        NEW.created_by, NOW()
    )
    RETURNING id INTO v_entry_id;
    
    -- إضافة بنود القيد
    -- 1. مدين: حساب العميل
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number,
        account_id, debit, credit,
        currency, exchange_rate,
        description,
        party_type, party_id,
        reference_type, reference_id
    )
    VALUES (
        NEW.tenant_id, v_entry_id, 1,
        v_customer_account_id, NEW.total_amount, 0,
        NEW.currency, NEW.exchange_rate,
        CASE WHEN NEW.notes IS NOT NULL AND NEW.notes != '' THEN 'ذمة العميل - فاتورة ' || NEW.invoice_number || ' - ' || NEW.notes ELSE 'ذمة العميل - فاتورة ' || NEW.invoice_number END,
        'customer', NEW.customer_id,
        'sales_invoice', NEW.id
    );
    
    -- 2. دائن: حساب المبيعات (المبلغ قبل الضريبة)
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number,
        account_id, debit, credit,
        currency, exchange_rate,
        description,
        reference_type, reference_id
    )
    VALUES (
        NEW.tenant_id, v_entry_id, 2,
        v_sales_account_id, 0, NEW.taxable_amount,
        NEW.currency, NEW.exchange_rate,
        CASE WHEN NEW.notes IS NOT NULL AND NEW.notes != '' THEN 'إيراد مبيعات - فاتورة ' || NEW.invoice_number || ' - ' || NEW.notes ELSE 'إيراد مبيعات - فاتورة ' || NEW.invoice_number END,
        'sales_invoice', NEW.id
    );
    
    -- 3. دائن: حساب ضريبة القيمة المضافة (إذا وجدت)
    IF NEW.tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number,
            account_id, debit, credit,
            currency, exchange_rate,
            description,
            reference_type, reference_id
        )
        VALUES (
            NEW.tenant_id, v_entry_id, 3,
            v_vat_account_id, 0, NEW.tax_amount,
            NEW.currency, NEW.exchange_rate,
            'ضريبة القيمة المضافة - فاتورة ' || NEW.invoice_number,
            'sales_invoice', NEW.id
        );
    END IF;
    
    -- تحديث الفاتورة بربط القيد
    NEW.journal_entry_id := v_entry_id;
    NEW.posted_at := NOW();
    
    -- تحديث رصيد العميل
    UPDATE customers
    SET balance = balance + NEW.total_amount,
        total_sales = total_sales + NEW.total_amount
    WHERE id = NEW.customer_id;
    
    RAISE NOTICE 'تم إنشاء قيد فاتورة المبيعات: % - المبلغ: %', v_entry_number, NEW.total_amount;
    
    RETURN NEW;
END;
$$;

-- حذف الـ Trigger إذا كان موجوداً
DROP TRIGGER IF EXISTS trg_sales_invoice_journal_entry ON sales_invoices;

-- إنشاء الـ Trigger
CREATE TRIGGER trg_sales_invoice_journal_entry
    BEFORE UPDATE ON sales_invoices
    FOR EACH ROW
    WHEN (NEW.status = 'posted' AND (OLD.status != 'posted' OR OLD.is_posted = false))
    EXECUTE FUNCTION create_sales_invoice_journal_entry();

COMMENT ON TRIGGER trg_sales_invoice_journal_entry ON sales_invoices IS 'إنشاء قيد يومي تلقائياً عند تأكيد فاتورة المبيعات';

-- ═══════════════════════════════════════════════════════════════
-- 2. Trigger فاتورة مشتريات -> قيد يومي
-- ═══════════════════════════════════════════════════════════════
-- القيد:
-- مدين: المشتريات/المخزون (5200/1140) = المبلغ قبل الضريبة
-- مدين: ضريبة القيمة المضافة - مدخلات (1160) = مبلغ الضريبة
-- دائن: حساب المورد (payable_account_id) = المبلغ الإجمالي

CREATE OR REPLACE FUNCTION create_purchase_invoice_journal_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry_id UUID;
    v_entry_number VARCHAR(50);
    v_supplier_account_id UUID;
    v_purchases_account_id UUID;
    v_vat_input_account_id UUID;
    v_fiscal_year_id UUID;
    v_line_number INT := 1;
BEGIN
    -- فقط عند تأكيد الفاتورة
    IF NEW.status != 'posted' OR NEW.is_posted = false THEN
        RETURN NEW;
    END IF;
    
    -- تخطي إذا كان القيد موجود مسبقاً
    IF NEW.journal_entry_id IS NOT NULL THEN
        RETURN NEW;
    END IF;
    
    -- الحصول على حساب المورد
    v_supplier_account_id := (
        SELECT payable_account_id 
        FROM suppliers 
        WHERE id = NEW.supplier_id
    );
    
    IF v_supplier_account_id IS NULL THEN
        -- استخدام حساب الموردين العام
        v_supplier_account_id := get_account_by_code(NEW.company_id, '2110');
    END IF;
    
    -- الحصول على حساب المشتريات
    v_purchases_account_id := get_account_by_code(NEW.company_id, '5200');
    IF v_purchases_account_id IS NULL THEN
        -- محاولة استخدام حساب المخزون
        v_purchases_account_id := get_account_by_code(NEW.company_id, '1140');
    END IF;
    
    IF v_purchases_account_id IS NULL THEN
        RAISE EXCEPTION 'حساب المشتريات (5200) أو المخزون (1140) غير موجود';
    END IF;
    
    -- الحصول على حساب ضريبة المدخلات
    v_vat_input_account_id := get_account_by_code(NEW.company_id, '1160');
    
    -- الحصول على السنة المالية الحالية
    SELECT id INTO v_fiscal_year_id
    FROM fiscal_years
    WHERE company_id = NEW.company_id
      AND is_current = true
    LIMIT 1;
    
    -- توليد رقم القيد
    v_entry_number := 'JE-PI-' || NEW.invoice_number;
    
    -- إنشاء القيد اليومي
    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id,
        entry_number, entry_date,
        fiscal_year_id,
        entry_type,
        reference_type, reference_id, reference_number,
        description,
        currency, exchange_rate,
        total_debit, total_credit,
        status, is_posted, posted_at,
        created_by, created_at
    )
    VALUES (
        NEW.tenant_id, NEW.company_id, NEW.branch_id,
        v_entry_number, NEW.invoice_date,
        v_fiscal_year_id,
        'purchase_invoice',
        'purchase_invoice', NEW.id, NEW.invoice_number,
        'قيد فاتورة مشتريات رقم ' || NEW.invoice_number,
        NEW.currency, NEW.exchange_rate,
        NEW.total_amount, NEW.total_amount,
        'posted', true, NOW(),
        NEW.created_by, NOW()
    )
    RETURNING id INTO v_entry_id;
    
    -- إضافة بنود القيد
    -- 1. مدين: حساب المشتريات
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number,
        account_id, debit, credit,
        currency, exchange_rate,
        description,
        reference_type, reference_id
    )
    VALUES (
        NEW.tenant_id, v_entry_id, v_line_number,
        v_purchases_account_id, NEW.subtotal, 0,
        NEW.currency, NEW.exchange_rate,
        'مشتريات - فاتورة ' || NEW.invoice_number,
        'purchase_invoice', NEW.id
    );
    v_line_number := v_line_number + 1;
    
    -- 2. مدين: حساب ضريبة المدخلات (إذا وجدت)
    IF NEW.tax_amount > 0 AND v_vat_input_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number,
            account_id, debit, credit,
            currency, exchange_rate,
            description,
            reference_type, reference_id
        )
        VALUES (
            NEW.tenant_id, v_entry_id, v_line_number,
            v_vat_input_account_id, NEW.tax_amount, 0,
            NEW.currency, NEW.exchange_rate,
            'ضريبة مدخلات - فاتورة ' || NEW.invoice_number,
            'purchase_invoice', NEW.id
        );
        v_line_number := v_line_number + 1;
    END IF;
    
    -- 3. دائن: حساب المورد
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number,
        account_id, debit, credit,
        currency, exchange_rate,
        description,
        party_type, party_id,
        reference_type, reference_id
    )
    VALUES (
        NEW.tenant_id, v_entry_id, v_line_number,
        v_supplier_account_id, 0, NEW.total_amount,
        NEW.currency, NEW.exchange_rate,
        'ذمة المورد - فاتورة ' || NEW.invoice_number,
        'supplier', NEW.supplier_id,
        'purchase_invoice', NEW.id
    );
    
    -- تحديث الفاتورة بربط القيد
    NEW.journal_entry_id := v_entry_id;
    NEW.posted_at := NOW();
    
    -- تحديث رصيد المورد
    UPDATE suppliers
    SET balance = balance + NEW.total_amount,
        total_purchases = total_purchases + NEW.total_amount
    WHERE id = NEW.supplier_id;
    
    RAISE NOTICE 'تم إنشاء قيد فاتورة المشتريات: % - المبلغ: %', v_entry_number, NEW.total_amount;
    
    RETURN NEW;
END;
$$;

-- حذف الـ Trigger إذا كان موجوداً
DROP TRIGGER IF EXISTS trg_purchase_invoice_journal_entry ON purchase_invoices;

-- إنشاء الـ Trigger
CREATE TRIGGER trg_purchase_invoice_journal_entry
    BEFORE UPDATE ON purchase_invoices
    FOR EACH ROW
    WHEN (NEW.status = 'posted' AND (OLD.status != 'posted' OR OLD.is_posted = false))
    EXECUTE FUNCTION create_purchase_invoice_journal_entry();

COMMENT ON TRIGGER trg_purchase_invoice_journal_entry ON purchase_invoices IS 'إنشاء قيد يومي تلقائياً عند تأكيد فاتورة المشتريات';

-- ═══════════════════════════════════════════════════════════════
-- 3. Trigger سند قبض -> قيد يومي
-- ═══════════════════════════════════════════════════════════════
-- القيد:
-- مدين: الصندوق/البنك (1110/1120) = المبلغ
-- دائن: حساب العميل (receivable_account_id) = المبلغ

CREATE OR REPLACE FUNCTION create_payment_receipt_journal_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry_id UUID;
    v_entry_number VARCHAR(50);
    v_customer_account_id UUID;
    v_cash_account_id UUID;
    v_fiscal_year_id UUID;
BEGIN
    -- فقط للسندات المؤكدة
    IF NEW.status != 'confirmed' THEN
        RETURN NEW;
    END IF;
    
    -- تخطي إذا كان القيد موجود مسبقاً
    IF NEW.journal_entry_id IS NOT NULL THEN
        RETURN NEW;
    END IF;
    
    -- الحصول على حساب العميل
    v_customer_account_id := (
        SELECT receivable_account_id 
        FROM customers 
        WHERE id = NEW.customer_id
    );
    
    IF v_customer_account_id IS NULL THEN
        v_customer_account_id := get_account_by_code(NEW.company_id, '1130');
    END IF;
    
    -- تحديد حساب النقدية بناءً على طريقة الدفع
    IF NEW.payment_method IN ('cash', 'نقدي', 'نقداً') THEN
        v_cash_account_id := get_account_by_code(NEW.company_id, '1110');
    ELSE
        v_cash_account_id := get_account_by_code(NEW.company_id, '1120');
    END IF;
    
    IF v_cash_account_id IS NULL THEN
        v_cash_account_id := get_account_by_code(NEW.company_id, '1110');
    END IF;
    
    -- الحصول على السنة المالية الحالية
    SELECT id INTO v_fiscal_year_id
    FROM fiscal_years
    WHERE company_id = NEW.company_id
      AND is_current = true
    LIMIT 1;
    
    -- توليد رقم القيد
    v_entry_number := 'JE-PR-' || NEW.receipt_number;
    
    -- إنشاء القيد اليومي
    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id,
        entry_number, entry_date,
        fiscal_year_id,
        entry_type,
        reference_type, reference_id, reference_number,
        description,
        currency, exchange_rate,
        total_debit, total_credit,
        status, is_posted, posted_at,
        created_by, created_at
    )
    VALUES (
        NEW.tenant_id, NEW.company_id, NEW.branch_id,
        v_entry_number, NEW.receipt_date,
        v_fiscal_year_id,
        'payment_receipt',
        'payment_receipt', NEW.id, NEW.receipt_number,
        'سند قبض رقم ' || NEW.receipt_number || ' - ' || COALESCE(NEW.customer_name, ''),
        NEW.currency, NEW.exchange_rate,
        NEW.amount, NEW.amount,
        'posted', true, NOW(),
        NEW.created_by, NOW()
    )
    RETURNING id INTO v_entry_id;
    
    -- إضافة بنود القيد
    -- 1. مدين: حساب النقدية
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number,
        account_id, debit, credit,
        currency, exchange_rate,
        description,
        reference_type, reference_id
    )
    VALUES (
        NEW.tenant_id, v_entry_id, 1,
        v_cash_account_id, NEW.amount, 0,
        NEW.currency, NEW.exchange_rate,
        'تحصيل من العميل - سند ' || NEW.receipt_number,
        'payment_receipt', NEW.id
    );
    
    -- 2. دائن: حساب العميل
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number,
        account_id, debit, credit,
        currency, exchange_rate,
        description,
        party_type, party_id,
        reference_type, reference_id
    )
    VALUES (
        NEW.tenant_id, v_entry_id, 2,
        v_customer_account_id, 0, NEW.amount,
        NEW.currency, NEW.exchange_rate,
        'تسديد ذمة العميل - سند ' || NEW.receipt_number,
        'customer', NEW.customer_id,
        'payment_receipt', NEW.id
    );
    
    -- تحديث السند بربط القيد
    NEW.journal_entry_id := v_entry_id;
    
    RAISE NOTICE 'تم إنشاء قيد سند القبض: % - المبلغ: %', v_entry_number, NEW.amount;
    
    RETURN NEW;
END;
$$;

-- حذف الـ Trigger إذا كان موجوداً
DROP TRIGGER IF EXISTS trg_payment_receipt_journal_entry ON payment_receipts;

-- إنشاء الـ Trigger
CREATE TRIGGER trg_payment_receipt_journal_entry
    BEFORE INSERT OR UPDATE ON payment_receipts
    FOR EACH ROW
    WHEN (NEW.status = 'confirmed')
    EXECUTE FUNCTION create_payment_receipt_journal_entry();

COMMENT ON TRIGGER trg_payment_receipt_journal_entry ON payment_receipts IS 'إنشاء قيد يومي تلقائياً عند تأكيد سند القبض';

-- ═══════════════════════════════════════════════════════════════
-- 4. Trigger سند صرف -> قيد يومي
-- ═══════════════════════════════════════════════════════════════
-- القيد:
-- مدين: حساب المورد (payable_account_id) = المبلغ
-- دائن: الصندوق/البنك (1110/1120) = المبلغ

CREATE OR REPLACE FUNCTION create_payment_voucher_journal_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry_id UUID;
    v_entry_number VARCHAR(50);
    v_supplier_account_id UUID;
    v_cash_account_id UUID;
    v_fiscal_year_id UUID;
BEGIN
    -- فقط للسندات المؤكدة
    IF NEW.status != 'confirmed' THEN
        RETURN NEW;
    END IF;
    
    -- تخطي إذا كان القيد موجود مسبقاً
    IF NEW.journal_entry_id IS NOT NULL THEN
        RETURN NEW;
    END IF;
    
    -- الحصول على حساب المورد
    v_supplier_account_id := (
        SELECT payable_account_id 
        FROM suppliers 
        WHERE id = NEW.supplier_id
    );
    
    IF v_supplier_account_id IS NULL THEN
        v_supplier_account_id := get_account_by_code(NEW.company_id, '2110');
    END IF;
    
    -- تحديد حساب النقدية بناءً على طريقة الدفع
    IF NEW.payment_method IN ('cash', 'نقدي', 'نقداً') THEN
        v_cash_account_id := get_account_by_code(NEW.company_id, '1110');
    ELSE
        v_cash_account_id := get_account_by_code(NEW.company_id, '1120');
    END IF;
    
    IF v_cash_account_id IS NULL THEN
        v_cash_account_id := get_account_by_code(NEW.company_id, '1110');
    END IF;
    
    -- الحصول على السنة المالية الحالية
    SELECT id INTO v_fiscal_year_id
    FROM fiscal_years
    WHERE company_id = NEW.company_id
      AND is_current = true
    LIMIT 1;
    
    -- توليد رقم القيد
    v_entry_number := 'JE-PV-' || NEW.voucher_number;
    
    -- إنشاء القيد اليومي
    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id,
        entry_number, entry_date,
        fiscal_year_id,
        entry_type,
        reference_type, reference_id, reference_number,
        description,
        currency, exchange_rate,
        total_debit, total_credit,
        status, is_posted, posted_at,
        created_by, created_at
    )
    VALUES (
        NEW.tenant_id, NEW.company_id, NEW.branch_id,
        v_entry_number, NEW.voucher_date,
        v_fiscal_year_id,
        'payment_voucher',
        'payment_voucher', NEW.id, NEW.voucher_number,
        'سند صرف رقم ' || NEW.voucher_number || ' - ' || COALESCE(NEW.supplier_name, ''),
        NEW.currency, NEW.exchange_rate,
        NEW.amount, NEW.amount,
        'posted', true, NOW(),
        NEW.created_by, NOW()
    )
    RETURNING id INTO v_entry_id;
    
    -- إضافة بنود القيد
    -- 1. مدين: حساب المورد
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number,
        account_id, debit, credit,
        currency, exchange_rate,
        description,
        party_type, party_id,
        reference_type, reference_id
    )
    VALUES (
        NEW.tenant_id, v_entry_id, 1,
        v_supplier_account_id, NEW.amount, 0,
        NEW.currency, NEW.exchange_rate,
        'تسديد ذمة المورد - سند ' || NEW.voucher_number,
        'supplier', NEW.supplier_id,
        'payment_voucher', NEW.id
    );
    
    -- 2. دائن: حساب النقدية
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number,
        account_id, debit, credit,
        currency, exchange_rate,
        description,
        reference_type, reference_id
    )
    VALUES (
        NEW.tenant_id, v_entry_id, 2,
        v_cash_account_id, 0, NEW.amount,
        NEW.currency, NEW.exchange_rate,
        'دفع للمورد - سند ' || NEW.voucher_number,
        'payment_voucher', NEW.id
    );
    
    -- تحديث السند بربط القيد
    NEW.journal_entry_id := v_entry_id;
    
    RAISE NOTICE 'تم إنشاء قيد سند الصرف: % - المبلغ: %', v_entry_number, NEW.amount;
    
    RETURN NEW;
END;
$$;

-- حذف الـ Trigger إذا كان موجوداً
DROP TRIGGER IF EXISTS trg_payment_voucher_journal_entry ON payment_vouchers;

-- إنشاء الـ Trigger
CREATE TRIGGER trg_payment_voucher_journal_entry
    BEFORE INSERT OR UPDATE ON payment_vouchers
    FOR EACH ROW
    WHEN (NEW.status = 'confirmed')
    EXECUTE FUNCTION create_payment_voucher_journal_entry();

COMMENT ON TRIGGER trg_payment_voucher_journal_entry ON payment_vouchers IS 'إنشاء قيد يومي تلقائياً عند تأكيد سند الصرف';

-- ═══════════════════════════════════════════════════════════════
-- 5. Trigger فاتورة مبيعات -> خصم مخزون
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION deduct_inventory_on_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item RECORD;
    v_movement_number VARCHAR(50);
    v_warehouse_id UUID;
BEGIN
    -- فقط عند تأكيد الفاتورة
    IF NEW.status != 'posted' THEN
        RETURN NEW;
    END IF;
    
    -- تخطي إذا تم معالجة المخزون مسبقاً
    IF OLD.status = 'posted' THEN
        RETURN NEW;
    END IF;
    
    -- الحصول على المستودع الافتراضي
    v_warehouse_id := NEW.warehouse_id;
    IF v_warehouse_id IS NULL THEN
        SELECT id INTO v_warehouse_id
        FROM warehouses
        WHERE company_id = NEW.company_id
          AND is_active = true
        ORDER BY created_at
        LIMIT 1;
    END IF;
    
    IF v_warehouse_id IS NULL THEN
        RAISE NOTICE 'لا يوجد مستودع، تخطي خصم المخزون';
        RETURN NEW;
    END IF;
    
    -- معالجة كل صنف في الفاتورة
    FOR v_item IN 
        SELECT * FROM sales_invoice_items 
        WHERE invoice_id = NEW.id 
          AND product_id IS NOT NULL
    LOOP
        -- توليد رقم الحركة
        v_movement_number := 'MV-SI-' || NEW.invoice_number || '-' || v_item.line_number;
        
        -- إنشاء حركة مخزون (صادر - بيع)
        INSERT INTO inventory_movements (
            tenant_id, company_id,
            movement_number, movement_date,
            movement_type,
            product_id, variant_id,
            from_warehouse_id,
            quantity, unit_id,
            unit_cost, total_cost,
            reference_type, reference_id, reference_number,
            notes,
            created_by
        )
        VALUES (
            NEW.tenant_id, NEW.company_id,
            v_movement_number, NEW.invoice_date,
            'sale',
            v_item.product_id, v_item.variant_id,
            COALESCE(v_item.warehouse_id, v_warehouse_id),
            v_item.quantity, v_item.unit_id,
            v_item.unit_cost, v_item.total_cost,
            'sales_invoice', NEW.id, NEW.invoice_number,
            'خصم مخزون - فاتورة مبيعات ' || NEW.invoice_number,
            NEW.created_by
        );
        
        RAISE NOTICE 'تم خصم المخزون للصنف: % - الكمية: %', v_item.product_id, v_item.quantity;
    END LOOP;
    
    RETURN NEW;
END;
$$;

-- حذف الـ Trigger إذا كان موجوداً
DROP TRIGGER IF EXISTS trg_deduct_inventory_on_sale ON sales_invoices;

-- إنشاء الـ Trigger
CREATE TRIGGER trg_deduct_inventory_on_sale
    AFTER UPDATE ON sales_invoices
    FOR EACH ROW
    WHEN (NEW.status = 'posted' AND OLD.status != 'posted')
    EXECUTE FUNCTION deduct_inventory_on_sale();

COMMENT ON TRIGGER trg_deduct_inventory_on_sale ON sales_invoices IS 'خصم المخزون تلقائياً عند تأكيد فاتورة المبيعات';

-- ═══════════════════════════════════════════════════════════════
-- نهاية المرحلة 2: ربط الفواتير بالمحاسبة
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'تم إنشاء المرحلة 2: ربط الفواتير بالمحاسبة بنجاح';
    RAISE NOTICE '- Trigger فاتورة مبيعات -> قيد يومي';
    RAISE NOTICE '- Trigger فاتورة مشتريات -> قيد يومي';
    RAISE NOTICE '- Trigger سند قبض -> قيد يومي';
    RAISE NOTICE '- Trigger سند صرف -> قيد يومي';
    RAISE NOTICE '- Trigger فاتورة مبيعات -> خصم مخزون';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
