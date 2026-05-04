-- ═══════════════════════════════════════════════════════════════
-- Migration: دوال إدارة أرصدة الحسابات
-- Date: 2026-02-22
-- ═══════════════════════════════════════════════════════════════

-- 1. دالة إلغاء ترحيل القيد (مع عكس الأرصدة)
CREATE OR REPLACE FUNCTION unpost_journal_entry(
    p_entry_id UUID,
    p_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_entry RECORD;
    v_line RECORD;
    v_movement DECIMAL(15,2);
BEGIN
    SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'القيد غير موجود'; END IF;
    IF NOT v_entry.is_posted THEN RETURN true; END IF;
    
    FOR v_line IN 
        SELECT jel.*, at.normal_balance
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
        SET current_balance = current_balance - v_movement, updated_at = NOW()
        WHERE id = v_line.account_id;
    END LOOP;
    
    UPDATE journal_entries
    SET is_posted = false, posted_at = NULL, status = 'draft'
    WHERE id = p_entry_id;
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 2. إعادة حساب رصيد حساب (مع استبعاد الملغاة)
CREATE OR REPLACE FUNCTION recalculate_account_balance(p_account_id UUID)
RETURNS DECIMAL AS $$
DECLARE
    v_ob DECIMAL(15,2);
    v_total_debit DECIMAL(15,2);
    v_total_credit DECIMAL(15,2);
    v_calculated DECIMAL(15,2);
    v_normal VARCHAR(50);
BEGIN
    SELECT COALESCE(coa.opening_balance, 0), at.normal_balance 
    INTO v_ob, v_normal
    FROM chart_of_accounts coa
    JOIN account_types at ON coa.account_type_id = at.id
    WHERE coa.id = p_account_id;

    SELECT COALESCE(SUM(jel.debit), 0), COALESCE(SUM(jel.credit), 0)
    INTO v_total_debit, v_total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.entry_id = je.id
    WHERE jel.account_id = p_account_id 
      AND je.is_posted = true
      AND je.status != 'cancelled';
    
    IF v_normal = 'debit' THEN
        v_calculated := v_ob + (v_total_debit - v_total_credit);
    ELSE
        v_calculated := v_ob + (v_total_credit - v_total_debit);
    END IF;

    UPDATE chart_of_accounts 
    SET current_balance = v_calculated, updated_at = NOW()
    WHERE id = p_account_id;
    RETURN v_calculated;
END;
$$ LANGUAGE plpgsql;

-- 3. إعادة حساب جميع الأرصدة
CREATE OR REPLACE FUNCTION recalculate_all_accounts_balance()
RETURNS INTEGER AS $$
DECLARE
    acc RECORD;
    v_count INTEGER := 0;
BEGIN
    FOR acc IN SELECT id FROM chart_of_accounts LOOP
        PERFORM recalculate_account_balance(acc.id);
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
