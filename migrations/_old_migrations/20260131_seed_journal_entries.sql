-- ═══════════════════════════════════════════════════════════════
-- Seed Data: Journal Entries
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_company_id uuid;
    v_cash_account_id uuid;
    v_sales_account_id uuid;
    v_salaries_account_id uuid;
    v_expenses_account_id uuid;
    v_entry_id uuid;
    v_tenant_id uuid;
BEGIN
    -- 1. Get Company ID
    SELECT id INTO v_company_id FROM companies WHERE code = 'COMP001' LIMIT 1;
    
    -- If no company, create one (fallback)
    IF v_company_id IS NULL THEN
        SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
        IF v_tenant_id IS NULL THEN
            INSERT INTO tenants (name, code) VALUES ('Default Tenant', 'TEN001') RETURNING id INTO v_tenant_id;
        END IF;

        INSERT INTO companies (code, name, name_en, default_currency, country, tenant_id)
        VALUES ('COMP001', 'شركة تجريبية', 'Test Company', 'SAR', 'SA', v_tenant_id)
        RETURNING id INTO v_company_id;
    END IF;

    -- 2. Get Account IDs (Assuming standard codes, or fallbacks)
    -- Cash (Assets)
    SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE company_id = v_company_id AND account_code LIKE '1%' AND is_detail = true LIMIT 1;
    -- Sales (Revenue)
    SELECT id INTO v_sales_account_id FROM chart_of_accounts WHERE company_id = v_company_id AND account_code LIKE '4%' AND is_detail = true LIMIT 1;
    -- Salaries (Expenses)
    SELECT id INTO v_salaries_account_id FROM chart_of_accounts WHERE company_id = v_company_id AND account_code LIKE '5%' AND is_detail = true LIMIT 1;
    
    -- Create dummy accounts if missing (for robustness)
    IF v_cash_account_id IS NULL OR v_sales_account_id IS NULL OR v_salaries_account_id IS NULL THEN
        PERFORM create_simple_chart_of_accounts(v_company_id);
        
        SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE company_id = v_company_id AND account_code LIKE '1%' AND is_detail = true LIMIT 1;
        SELECT id INTO v_sales_account_id FROM chart_of_accounts WHERE company_id = v_company_id AND account_code LIKE '4%' AND is_detail = true LIMIT 1;
        SELECT id INTO v_salaries_account_id FROM chart_of_accounts WHERE company_id = v_company_id AND account_code LIKE '5%' AND is_detail = true LIMIT 1;
    END IF;
    
    -- 3. Insert Journal Entries
    
    -- Entry 1: Sales Invoice (Posted)
    IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE company_id = v_company_id AND entry_number = '1/2026') THEN
        INSERT INTO journal_entries (
            tenant_id, company_id, entry_number, entry_date, description, status, 
            entry_type, total_debit, total_credit, created_by
        ) VALUES (
            v_tenant_id, v_company_id, '1/2026', '2026-01-10', 'Sales Invoice INV-001 / فاتورة مبيعات', 'posted', 
            'sales', 5000.00, 5000.00, auth.uid()
        ) RETURNING id INTO v_entry_id;
        
        -- Lines
        INSERT INTO journal_entry_lines (tenant_id, entry_id, account_id, description, debit, credit)
        VALUES 
            (v_tenant_id, v_entry_id, v_cash_account_id, 'Cash Receipt', 5000.00, 0),
            (v_tenant_id, v_entry_id, v_sales_account_id, 'Sales Revenue', 0, 5000.00);
    END IF;

    -- Entry 2: Salaries Payment (Draft)
    IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE company_id = v_company_id AND entry_number = '2/2026') THEN
        INSERT INTO journal_entries (
            tenant_id, company_id, entry_number, entry_date, description, status, 
            entry_type, total_debit, total_credit, created_by
        ) VALUES (
            v_tenant_id, v_company_id, '2/2026', '2026-01-25', 'January Salaries / رواتب يناير', 'draft', 
            'payroll', 12000.00, 12000.00, auth.uid()
        ) RETURNING id INTO v_entry_id;
        
        -- Lines
        INSERT INTO journal_entry_lines (tenant_id, entry_id, account_id, description, debit, credit)
        VALUES 
            (v_tenant_id, v_entry_id, v_salaries_account_id, 'Salaries Expense', 12000.00, 0),
            (v_tenant_id, v_entry_id, v_cash_account_id, 'Cash Payment', 0, 12000.00);
    END IF;

    -- Entry 3: Office Expense (Posted)
    IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE company_id = v_company_id AND entry_number = '3/2026') THEN
         INSERT INTO journal_entries (
            tenant_id, company_id, entry_number, entry_date, description, status, 
            entry_type, total_debit, total_credit, created_by
        ) VALUES (
            v_tenant_id, v_company_id, '3/2026', '2026-01-20', 'Office Supplies / قرطاسية', 'posted', 
            'expense', 450.00, 450.00, auth.uid()
        ) RETURNING id INTO v_entry_id;
        
        -- Lines
        INSERT INTO journal_entry_lines (tenant_id, entry_id, account_id, description, debit, credit)
        VALUES 
            (v_tenant_id, v_entry_id, v_salaries_account_id, 'Office Expense', 450.00, 0), -- Reusing salaries acc for simplicity or create robust
            (v_tenant_id, v_entry_id, v_cash_account_id, 'Cash', 0, 450.00);
    END IF;

END $$;
