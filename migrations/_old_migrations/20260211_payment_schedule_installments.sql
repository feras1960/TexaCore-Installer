-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: جداول خطة الدفع والأقساط + ربط الخزينة
-- Payment Schedule / Installments + Treasury Integration
-- Date: 2026-02-11
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. جدول خطة الدفع / الأقساط
-- Payment Schedule (Installment Plan)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),

    -- ربط بالمستند المصدر (أي واحد منهم)
    quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE,
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
    sales_invoice_id UUID REFERENCES sales_invoices(id) ON DELETE CASCADE,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    purchase_invoice_id UUID REFERENCES purchase_invoices(id) ON DELETE CASCADE,

    -- معلومات الطرف
    customer_id UUID REFERENCES customers(id),
    supplier_id UUID REFERENCES suppliers(id),

    -- إعدادات الخطة
    plan_type VARCHAR(20) NOT NULL DEFAULT 'installment',
    -- 'installment' = أقساط متساوية
    -- 'custom' = مبالغ مخصصة لكل دفعة
    -- 'deposit' = عربون + باقي
    -- 'milestone' = مرتبط بمراحل

    total_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- عدد الدفعات والفترة
    installment_count INT NOT NULL DEFAULT 1,
    installment_period VARCHAR(20) DEFAULT 'monthly',
    -- 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'custom'
    
    -- العربون (اختياري)
    deposit_amount DECIMAL(15,2) DEFAULT 0,
    deposit_paid BOOLEAN DEFAULT false,
    deposit_paid_date DATE,
    deposit_voucher_id UUID, -- REFERENCES payment_vouchers(id) or payment_receipts(id)

    -- هل الدفعة ضرورية لتأكيد المستند؟
    payment_required_for_confirmation BOOLEAN DEFAULT false,
    -- true = لا يمكن تأكيد الحجز/الفاتورة بدون دفعة
    -- false = يمكن المتابعة بدون دفعة

    -- حالة الخطة
    status VARCHAR(20) DEFAULT 'active',
    -- 'active' | 'completed' | 'cancelled' | 'overdue'

    -- إجماليات محسوبة
    paid_amount DECIMAL(15,2) DEFAULT 0,
    remaining_amount DECIMAL(15,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,

    -- إشعارات تلغرام
    telegram_reminder_enabled BOOLEAN DEFAULT false,
    telegram_reminder_days_before INT DEFAULT 3,
    -- 3 = إرسال تذكير قبل 3 أيام من تاريخ الاستحقاق
    telegram_chat_id VARCHAR(100),

    notes TEXT,

    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. جدول بنود الأقساط (كل دفعة)
-- Payment Schedule Items (Individual Installments)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_schedule_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES payment_schedule(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,

    -- ترتيب الدفعة
    installment_number INT NOT NULL,
    
    -- المبلغ المطلوب
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- تاريخ الاستحقاق
    due_date DATE NOT NULL,
    
    -- حالة الدفعة
    status VARCHAR(20) DEFAULT 'pending',
    -- 'pending' | 'paid' | 'partial' | 'overdue' | 'cancelled'
    
    -- تفاصيل الدفع (عند الدفع)
    paid_amount DECIMAL(15,2) DEFAULT 0,
    paid_date DATE,
    payment_method VARCHAR(50),
    -- 'cash' | 'bank_transfer' | 'check' | 'credit_card' | 'pos'
    
    -- ربط بصندوق أو بنك
    treasury_account_id UUID, -- حساب الصندوق/البنك في chart_of_accounts
    cash_register_id VARCHAR(100), -- صندوق فرعي
    
    -- ربط بسند القبض/الصرف
    payment_voucher_id UUID, -- payment_vouchers or payment_receipts
    receipt_number VARCHAR(50),

    -- تذكير
    reminder_sent BOOLEAN DEFAULT false,
    reminder_sent_at TIMESTAMPTZ,
    
    -- تأكيد الاستلام
    confirmed BOOLEAN DEFAULT false,
    confirmed_by UUID,
    confirmed_at TIMESTAMPTZ,

    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 3. فهارس الأداء
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_payment_schedule_tenant ON payment_schedule(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedule_company ON payment_schedule(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedule_customer ON payment_schedule(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedule_supplier ON payment_schedule(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedule_quotation ON payment_schedule(quotation_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedule_sales_order ON payment_schedule(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedule_sales_invoice ON payment_schedule(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedule_status ON payment_schedule(status);

CREATE INDEX IF NOT EXISTS idx_schedule_items_schedule ON payment_schedule_items(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_due_date ON payment_schedule_items(due_date);
CREATE INDEX IF NOT EXISTS idx_schedule_items_status ON payment_schedule_items(status);
CREATE INDEX IF NOT EXISTS idx_schedule_items_tenant ON payment_schedule_items(tenant_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. إضافة أعمدة جديدة للجداول الموجودة
-- ═══════════════════════════════════════════════════════════════

-- إضافة payment_required_for_confirmation لجداول المبيعات
DO $$
BEGIN
    -- quotations
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'quotations' AND column_name = 'payment_required') THEN
        ALTER TABLE quotations ADD COLUMN payment_required BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'quotations' AND column_name = 'payment_confirmed') THEN
        ALTER TABLE quotations ADD COLUMN payment_confirmed BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'quotations' AND column_name = 'payment_schedule_id') THEN
        ALTER TABLE quotations ADD COLUMN payment_schedule_id UUID;
    END IF;

    -- sales_orders
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_orders' AND column_name = 'payment_required') THEN
        ALTER TABLE sales_orders ADD COLUMN payment_required BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_orders' AND column_name = 'payment_confirmed') THEN
        ALTER TABLE sales_orders ADD COLUMN payment_confirmed BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_orders' AND column_name = 'payment_schedule_id') THEN
        ALTER TABLE sales_orders ADD COLUMN payment_schedule_id UUID;
    END IF;

    -- sales_invoices
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_invoices' AND column_name = 'payment_required') THEN
        ALTER TABLE sales_invoices ADD COLUMN payment_required BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_invoices' AND column_name = 'payment_confirmed') THEN
        ALTER TABLE sales_invoices ADD COLUMN payment_confirmed BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_invoices' AND column_name = 'payment_schedule_id') THEN
        ALTER TABLE sales_invoices ADD COLUMN payment_schedule_id UUID;
    END IF;

    -- payment_vouchers — إضافة sales_order_id + quotation_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payment_vouchers' AND column_name = 'sales_order_id') THEN
        ALTER TABLE payment_vouchers ADD COLUMN sales_order_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payment_vouchers' AND column_name = 'quotation_id') THEN
        ALTER TABLE payment_vouchers ADD COLUMN quotation_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payment_vouchers' AND column_name = 'schedule_item_id') THEN
        ALTER TABLE payment_vouchers ADD COLUMN schedule_item_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payment_vouchers' AND column_name = 'treasury_account_id') THEN
        ALTER TABLE payment_vouchers ADD COLUMN treasury_account_id UUID;
    END IF;

    -- payment_receipts — إضافة sales_order_id + quotation_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payment_receipts' AND column_name = 'sales_order_id') THEN
        ALTER TABLE payment_receipts ADD COLUMN sales_order_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payment_receipts' AND column_name = 'quotation_id') THEN
        ALTER TABLE payment_receipts ADD COLUMN quotation_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payment_receipts' AND column_name = 'schedule_item_id') THEN
        ALTER TABLE payment_receipts ADD COLUMN schedule_item_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payment_receipts' AND column_name = 'treasury_account_id') THEN
        ALTER TABLE payment_receipts ADD COLUMN treasury_account_id UUID;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS Policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE payment_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_schedule_items ENABLE ROW LEVEL SECURITY;

-- payment_schedule policies
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payment_schedule_tenant_read' AND tablename = 'payment_schedule') THEN
        CREATE POLICY payment_schedule_tenant_read ON payment_schedule
            FOR SELECT USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payment_schedule_tenant_write' AND tablename = 'payment_schedule') THEN
        CREATE POLICY payment_schedule_tenant_write ON payment_schedule
            FOR ALL USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
END $$;

-- payment_schedule_items policies
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'schedule_items_tenant_read' AND tablename = 'payment_schedule_items') THEN
        CREATE POLICY schedule_items_tenant_read ON payment_schedule_items
            FOR SELECT USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'schedule_items_tenant_write' AND tablename = 'payment_schedule_items') THEN
        CREATE POLICY schedule_items_tenant_write ON payment_schedule_items
            FOR ALL USING (is_super_admin() OR tenant_id = get_current_tenant_id());
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 6. Trigger: تحديث paid_amount في payment_schedule عند تحديث بنود الأقساط
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_update_schedule_paid_amount()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE payment_schedule
    SET 
        paid_amount = (
            SELECT COALESCE(SUM(paid_amount), 0)
            FROM payment_schedule_items
            WHERE schedule_id = COALESCE(NEW.schedule_id, OLD.schedule_id)
        ),
        status = CASE
            WHEN (SELECT COALESCE(SUM(paid_amount), 0) FROM payment_schedule_items WHERE schedule_id = COALESCE(NEW.schedule_id, OLD.schedule_id)) >= total_amount THEN 'completed'
            WHEN (SELECT COUNT(*) FROM payment_schedule_items WHERE schedule_id = COALESCE(NEW.schedule_id, OLD.schedule_id) AND status = 'overdue') > 0 THEN 'overdue'
            ELSE 'active'
        END,
        updated_at = NOW()
    WHERE id = COALESCE(NEW.schedule_id, OLD.schedule_id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_schedule_paid ON payment_schedule_items;
CREATE TRIGGER trg_update_schedule_paid
    AFTER INSERT OR UPDATE OR DELETE ON payment_schedule_items
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_schedule_paid_amount();

-- ═══════════════════════════════════════════════════════════════
-- 7. Trigger: تحديث حالة الأقساط المتأخرة تلقائياً
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_mark_overdue_installments()
RETURNS void AS $$
BEGIN
    UPDATE payment_schedule_items
    SET status = 'overdue', updated_at = NOW()
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- يمكن تشغيلها كـ cron job
-- SELECT cron.schedule('mark-overdue-installments', '0 8 * * *', 'SELECT fn_mark_overdue_installments()');

-- ═══════════════════════════════════════════════════════════════
-- 8. إعلام PostgREST بإعادة تحميل الـ Schema
-- ═══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
-- 9. تقرير التحقق
-- ═══════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM information_schema.tables WHERE table_name = 'payment_schedule';
    RAISE NOTICE '✅ payment_schedule: %', CASE WHEN v_count > 0 THEN 'EXISTS' ELSE 'MISSING' END;
    
    SELECT COUNT(*) INTO v_count FROM information_schema.tables WHERE table_name = 'payment_schedule_items';
    RAISE NOTICE '✅ payment_schedule_items: %', CASE WHEN v_count > 0 THEN 'EXISTS' ELSE 'MISSING' END;
    
    SELECT COUNT(*) INTO v_count FROM information_schema.columns WHERE table_name = 'quotations' AND column_name = 'payment_required';
    RAISE NOTICE '✅ quotations.payment_required: %', CASE WHEN v_count > 0 THEN 'EXISTS' ELSE 'MISSING' END;
    
    SELECT COUNT(*) INTO v_count FROM information_schema.columns WHERE table_name = 'sales_orders' AND column_name = 'payment_required';
    RAISE NOTICE '✅ sales_orders.payment_required: %', CASE WHEN v_count > 0 THEN 'EXISTS' ELSE 'MISSING' END;
    
    SELECT COUNT(*) INTO v_count FROM information_schema.columns WHERE table_name = 'sales_invoices' AND column_name = 'payment_required';
    RAISE NOTICE '✅ sales_invoices.payment_required: %', CASE WHEN v_count > 0 THEN 'EXISTS' ELSE 'MISSING' END;
    
    SELECT COUNT(*) INTO v_count FROM information_schema.columns WHERE table_name = 'payment_vouchers' AND column_name = 'treasury_account_id';
    RAISE NOTICE '✅ payment_vouchers.treasury_account_id: %', CASE WHEN v_count > 0 THEN 'EXISTS' ELSE 'MISSING' END;
    
    RAISE NOTICE '═══════════════════════════════════════';
    RAISE NOTICE '✅ Migration Complete: Payment Schedule & Installments';
    RAISE NOTICE '═══════════════════════════════════════';
END $$;
