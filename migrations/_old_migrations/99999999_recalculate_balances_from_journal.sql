-- Recalculate all account balances from posted journal entry lines
DO $$
DECLARE
    v_account RECORD;
    v_debit DECIMAL(15,2);
    v_credit DECIMAL(15,2);
    v_new_balance DECIMAL(15,2);
BEGIN
    FOR v_account IN 
        SELECT coa.id, coa.account_code, coa.name_ar, at.normal_balance
        FROM chart_of_accounts coa
        JOIN account_types at ON coa.account_type_id = at.id
        WHERE coa.is_group = false
    LOOP
        -- Get total debit and credit for this account from posted journal entries
        SELECT COALESCE(SUM(jel.debit), 0), COALESCE(SUM(jel.credit), 0)
        INTO v_debit, v_credit
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id
        WHERE jel.account_id = v_account.id
        AND je.is_posted = true;
        
        -- Calculate natural balance
        IF v_account.normal_balance = 'debit' THEN
            v_new_balance := v_debit - v_credit;
        ELSE
            v_new_balance := v_credit - v_debit;
        END IF;
        
        -- Update the account
        UPDATE chart_of_accounts
        SET current_balance = v_new_balance
        WHERE id = v_account.id;
        
    END LOOP;
END;
$$;
