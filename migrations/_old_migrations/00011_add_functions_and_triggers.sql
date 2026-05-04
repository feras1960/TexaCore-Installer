-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: إضافة Functions و Triggers
-- Migration: Add Functions and Triggers
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. دوال مساعدة
-- ═══════════════════════════════════════════════════════════════

-- توليد رقم تسلسلي
CREATE OR REPLACE FUNCTION generate_sequence_number(
    p_tenant_id UUID,
    p_company_id UUID,
    p_sequence_type VARCHAR(50)
) RETURNS VARCHAR(50) AS $$
DECLARE
    v_sequence RECORD;
    v_new_value BIGINT;
    v_result VARCHAR(50);
BEGIN
    SELECT * INTO v_sequence
    FROM sequences
    WHERE tenant_id = p_tenant_id 
      AND (company_id = p_company_id OR company_id IS NULL)
      AND sequence_type = p_sequence_type
    ORDER BY company_id NULLS LAST
    LIMIT 1;
    
    IF NOT FOUND THEN
        INSERT INTO sequences (tenant_id, company_id, sequence_type, current_value)
        VALUES (p_tenant_id, p_company_id, p_sequence_type, 1)
        RETURNING current_value INTO v_new_value;
    ELSE
        UPDATE sequences
        SET current_value = current_value + 1
        WHERE id = v_sequence.id
        RETURNING current_value INTO v_new_value;
        
        v_sequence.prefix := COALESCE(v_sequence.prefix, '');
        v_sequence.suffix := COALESCE(v_sequence.suffix, '');
        v_sequence.padding := COALESCE(v_sequence.padding, 5);
    END IF;
    
    v_result := COALESCE(v_sequence.prefix, '') || 
                LPAD(v_new_value::TEXT, COALESCE(v_sequence.padding, 5), '0') || 
                COALESCE(v_sequence.suffix, '');
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- الحصول على حساب من دليل الحسابات
CREATE OR REPLACE FUNCTION get_account_id(
    p_tenant_id UUID,
    p_company_id UUID,
    p_account_code VARCHAR(50)
) RETURNS UUID AS $$
DECLARE
    v_account_id UUID;
BEGIN
    SELECT id INTO v_account_id
    FROM chart_of_accounts
    WHERE tenant_id = p_tenant_id
      AND company_id = p_company_id
      AND account_code = p_account_code
      AND is_active = true;
    
    RETURN v_account_id;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- 2. تحديث مجاميع القيد تلقائياً
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION check_journal_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_total_debit DECIMAL(15,2);
    v_total_credit DECIMAL(15,2);
BEGIN
    SELECT 
        COALESCE(SUM(debit), 0),
        COALESCE(SUM(credit), 0)
    INTO v_total_debit, v_total_credit
    FROM journal_entry_lines
    WHERE entry_id = COALESCE(NEW.entry_id, OLD.entry_id);
    
    UPDATE journal_entries
    SET total_debit = v_total_debit,
        total_credit = v_total_credit
    WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_journal_balance ON journal_entry_lines;
CREATE TRIGGER trg_check_journal_balance
    AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
    FOR EACH ROW
    EXECUTE FUNCTION check_journal_entry_balance();

-- ═══════════════════════════════════════════════════════════════
-- 3. ترحيل القيد وتحديث أرصدة الحسابات
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION post_journal_entry(
    p_entry_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_entry RECORD;
    v_line RECORD;
    v_movement DECIMAL(15,2);
BEGIN
    SELECT * INTO v_entry
    FROM journal_entries
    WHERE id = p_entry_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'القيد غير موجود';
    END IF;
    
    IF v_entry.is_posted THEN
        RAISE EXCEPTION 'القيد مرحّل مسبقاً';
    END IF;
    
    IF ABS(v_entry.total_debit - v_entry.total_credit) > 0.01 THEN
        RAISE EXCEPTION 'القيد غير متوازن! مدين: %, دائن: %', 
            v_entry.total_debit, v_entry.total_credit;
    END IF;
    
    FOR v_line IN 
        SELECT jel.*, coa.account_type_id, at.normal_balance
        FROM journal_entry_lines jel
        JOIN chart_of_accounts coa ON jel.account_id = coa.id
        JOIN account_types at ON coa.account_type_id = at.id
        WHERE jel.entry_id = p_entry_id
    LOOP
        IF v_line.normal_balance = 'debit' THEN
            v_movement := v_line.debit - v_line.credit;
        ELSE
            v_movement := v_line.credit - v_line.debit;
        END IF;
        
        UPDATE chart_of_accounts
        SET current_balance = current_balance + v_movement,
            updated_at = NOW()
        WHERE id = v_line.account_id;
    END LOOP;
    
    UPDATE journal_entries
    SET is_posted = true,
        posted_at = NOW(),
        posted_by = p_user_id,
        status = 'posted'
    WHERE id = p_entry_id;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- 4. تحديث رصيد المخزون
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_inventory_stock()
RETURNS TRIGGER AS $$
DECLARE
    v_current_qty DECIMAL(15,3);
    v_current_cost DECIMAL(15,4);
    v_new_avg_cost DECIMAL(15,4);
BEGIN
    SELECT quantity_on_hand, average_cost
    INTO v_current_qty, v_current_cost
    FROM inventory_stock
    WHERE product_id = NEW.product_id
      AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000') = 
          COALESCE(NEW.variant_id, '00000000-0000-0000-0000-000000000000')
      AND warehouse_id = COALESCE(NEW.to_warehouse_id, NEW.from_warehouse_id);
    
    IF NOT FOUND THEN
        v_current_qty := 0;
        v_current_cost := 0;
    END IF;
    
    IF NEW.movement_type IN ('receipt', 'purchase', 'return_in', 'adjustment_in', 'transfer_in') THEN
        IF (v_current_qty + NEW.quantity) > 0 THEN
            v_new_avg_cost := (
                (v_current_qty * v_current_cost) + (NEW.quantity * COALESCE(NEW.unit_cost, v_current_cost))
            ) / (v_current_qty + NEW.quantity);
        ELSE
            v_new_avg_cost := COALESCE(NEW.unit_cost, v_current_cost);
        END IF;
        
        INSERT INTO inventory_stock (
            tenant_id, company_id,
            product_id, variant_id, warehouse_id,
            quantity_on_hand, average_cost, last_cost, last_movement_date
        ) VALUES (
            NEW.tenant_id, NEW.company_id,
            NEW.product_id, NEW.variant_id, NEW.to_warehouse_id,
            NEW.quantity, v_new_avg_cost, COALESCE(NEW.unit_cost, v_current_cost), NOW()
        )
        ON CONFLICT (product_id, variant_id, warehouse_id, location_id)
        DO UPDATE SET
            quantity_on_hand = inventory_stock.quantity_on_hand + NEW.quantity,
            average_cost = v_new_avg_cost,
            last_cost = COALESCE(NEW.unit_cost, inventory_stock.last_cost),
            last_movement_date = NOW(),
            updated_at = NOW();
            
    ELSIF NEW.movement_type IN ('sale', 'issue', 'return_out', 'adjustment_out', 'transfer_out') THEN
        UPDATE inventory_stock
        SET quantity_on_hand = quantity_on_hand - NEW.quantity,
            last_movement_date = NOW(),
            updated_at = NOW()
        WHERE product_id = NEW.product_id
          AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000') = 
              COALESCE(NEW.variant_id, '00000000-0000-0000-0000-000000000000')
          AND warehouse_id = NEW.from_warehouse_id;
    END IF;
    
    NEW.balance_after := v_current_qty + 
        CASE WHEN NEW.movement_type IN ('receipt', 'purchase', 'return_in', 'adjustment_in', 'transfer_in')
             THEN NEW.quantity
             ELSE -NEW.quantity
        END;
    NEW.balance_before := v_current_qty;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_inventory_stock ON inventory_movements;
CREATE TRIGGER trg_update_inventory_stock
    BEFORE INSERT ON inventory_movements
    FOR EACH ROW
    EXECUTE FUNCTION update_inventory_stock();

-- ═══════════════════════════════════════════════════════════════
-- 5. تحديث رصيد العميل عند سند القبض
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_payment_receipt()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'confirmed' THEN
        UPDATE customers
        SET balance = balance - NEW.amount,
            total_payments = total_payments + NEW.amount
        WHERE id = NEW.customer_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_process_payment_receipt ON payment_receipts;
CREATE TRIGGER trg_process_payment_receipt
    AFTER INSERT ON payment_receipts
    FOR EACH ROW
    WHEN (NEW.status = 'confirmed')
    EXECUTE FUNCTION process_payment_receipt();

-- ═══════════════════════════════════════════════════════════════
-- 6. تحديث حالة الدفع للفاتورة
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_invoice_payment_status()
RETURNS TRIGGER AS $$
DECLARE
    v_total_paid DECIMAL(15,2);
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM payment_receipt_allocations
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    UPDATE sales_invoices
    SET paid_amount = v_total_paid,
        payment_status = CASE
            WHEN v_total_paid >= total_amount THEN 'paid'
            WHEN v_total_paid > 0 THEN 'partial'
            ELSE 'unpaid'
        END
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_invoice_payment ON payment_receipt_allocations;
CREATE TRIGGER trg_update_invoice_payment
    AFTER INSERT OR UPDATE OR DELETE ON payment_receipt_allocations
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_payment_status();
