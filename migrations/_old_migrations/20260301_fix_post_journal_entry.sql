-- ═══════════════════════════════════════════════════════════
-- Fix post_journal_entry to use Net (Dr-Cr) convention
-- ═══════════════════════════════════════════════════════════
-- BEFORE: Used Natural Balance (always positive) based on account_type.normal_balance
-- AFTER:  Uses Net (Dr-Cr) — assets/expenses positive, liabilities/revenue negative
-- This matches how we store current_balance in chart_of_accounts
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION post_journal_entry(
    p_entry_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry RECORD;
    v_line RECORD;
BEGIN
    -- Input Validation
    IF p_entry_id IS NULL THEN
        RAISE EXCEPTION 'رقم القيد مطلوب';
    END IF;

    -- Fetch Entry
    SELECT * INTO v_entry
    FROM journal_entries
    WHERE id = p_entry_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'القيد غير موجود: %', p_entry_id;
    END IF;
    
    IF v_entry.is_posted THEN
        RAISE EXCEPTION 'القيد مرحّل مسبقاً: %', v_entry.entry_number;
    END IF;
    
    -- Strict Balance Check
    IF ABS(v_entry.total_debit - v_entry.total_credit) > 0.01 THEN
        RAISE EXCEPTION 'القيد غير متوازن! الفرق: % (مدين: %, دائن: %)', 
            ABS(v_entry.total_debit - v_entry.total_credit), v_entry.total_debit, v_entry.total_credit;
    END IF;

    -- Ensure lines exist
    IF NOT EXISTS (SELECT 1 FROM journal_entry_lines WHERE entry_id = p_entry_id) THEN
        RAISE EXCEPTION 'القيد لا يحتوي على أسطر';
    END IF;
    
    -- Process Lines: ALWAYS use Net (Dr-Cr)
    -- Assets/Expenses → positive when debited
    -- Liabilities/Revenue → negative when credited
    FOR v_line IN 
        SELECT * FROM journal_entry_lines WHERE entry_id = p_entry_id
    LOOP
        UPDATE chart_of_accounts
        SET current_balance = COALESCE(current_balance, 0) + (v_line.debit - v_line.credit),
            updated_at = NOW()
        WHERE id = v_line.account_id;
    END LOOP;
    
    -- Mark as Posted
    UPDATE journal_entries
    SET is_posted = true,
        posted_at = NOW(),
        posted_by = p_user_id,
        status = 'posted'
    WHERE id = p_entry_id;
    
    RETURN true;
END;
$$;


-- ═══════════════════════════════════════════════════════════
-- Fix unpost_journal_entry to reverse Net (Dr-Cr)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION unpost_journal_entry(
    p_entry_id UUID
) RETURNS BOOLEAN 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry RECORD;
    v_line RECORD;
BEGIN
    SELECT * INTO v_entry
    FROM journal_entries
    WHERE id = p_entry_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'القيد غير موجود';
    END IF;
    
    IF NOT v_entry.is_posted THEN
        RAISE EXCEPTION 'القيد غير مرحّل';
    END IF;
    
    -- Reverse: subtract Net (Dr-Cr) that was added during posting
    FOR v_line IN 
        SELECT * FROM journal_entry_lines WHERE entry_id = p_entry_id
    LOOP
        UPDATE chart_of_accounts
        SET current_balance = COALESCE(current_balance, 0) - (v_line.debit - v_line.credit),
            updated_at = NOW()
        WHERE id = v_line.account_id;
    END LOOP;
    
    UPDATE journal_entries
    SET is_posted = false,
        posted_at = NULL,
        posted_by = NULL,
        status = 'draft'
    WHERE id = p_entry_id;
    
    RETURN true;
END;
$$;
