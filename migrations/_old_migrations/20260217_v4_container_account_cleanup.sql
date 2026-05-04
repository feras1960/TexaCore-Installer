-- ============================================================
-- Container Account Cleanup Trigger
-- When a container is deleted:
--   1. If account has journal entries → deactivate only
--   2. If account has NO entries → delete from chart_of_accounts
-- ============================================================

-- AFTER DELETE trigger function
CREATE OR REPLACE FUNCTION cleanup_container_transit_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_has_entries BOOLEAN;
BEGIN
    -- Skip if no container_account_id
    IF OLD.container_account_id IS NULL THEN
        RETURN OLD;
    END IF;

    -- Check if the account has any journal entry lines
    SELECT EXISTS(
        SELECT 1 FROM journal_entry_lines 
        WHERE account_id = OLD.container_account_id
        LIMIT 1
    ) INTO v_has_entries;

    IF v_has_entries THEN
        -- Account has transactions → deactivate only (preserve audit trail)
        UPDATE chart_of_accounts 
        SET is_active = false
        WHERE id = OLD.container_account_id;
    ELSE
        -- No transactions → safe to delete the account
        -- Clear references in container_expenses first
        UPDATE container_expenses SET container_account_id = NULL 
        WHERE container_account_id = OLD.container_account_id;
        
        DELETE FROM chart_of_accounts 
        WHERE id = OLD.container_account_id;
    END IF;

    RETURN OLD;
END;
$$;

-- Create the trigger (AFTER DELETE — container row already gone, no FK conflict)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_cleanup_container_account ON containers';
        EXECUTE '
        CREATE TRIGGER trg_cleanup_container_account
            AFTER DELETE ON containers
            FOR EACH ROW
            EXECUTE FUNCTION cleanup_container_transit_account();';
    END IF;
END $$;
