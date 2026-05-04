-- Rollup balances from child accounts to parent group accounts
DO $$
DECLARE
    v_level INT;
    v_max_level INT;
BEGIN
    -- Reset all group balances to 0 first
    UPDATE chart_of_accounts SET current_balance = 0 WHERE is_group = true;

    -- Find the deepest level in the chart of accounts
    SELECT COALESCE(MAX(level), 10) INTO v_max_level FROM chart_of_accounts;

    -- Rollup balances from bottom (leaves/deepest levels) to top (level 1)
    FOR v_level IN REVERSE v_max_level..1 LOOP
        -- For each group at this level, set its balance to the sum of its immediate children's balances
        UPDATE chart_of_accounts parent
        SET current_balance = COALESCE(
            (SELECT SUM(child.current_balance) 
             FROM chart_of_accounts child 
             WHERE child.parent_id = parent.id), 
            0
        )
        WHERE parent.is_group = true AND parent.level = v_level;
    END LOOP;
END;
$$;
