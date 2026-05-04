-- ═══════════════════════════════════════════════════════════
-- Migration: INSTEAD OF UPDATE trigger for company_accounting_settings view
-- Purpose: Allow PATCH requests on the view via PostgREST
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_company_accounting_settings()
RETURNS TRIGGER AS $$
DECLARE
  new_settings jsonb;
BEGIN
  -- Start from existing settings
  SELECT COALESCE(c.accounting_settings, '{}'::jsonb)
    INTO new_settings
    FROM companies c
    WHERE c.id = OLD.company_id;

  -- Merge all updatable fields from the NEW row into the JSONB
  IF NEW.base_currency IS DISTINCT FROM OLD.base_currency THEN
    new_settings = new_settings || jsonb_build_object('base_currency', NEW.base_currency);
  END IF;
  IF NEW.local_currency IS DISTINCT FROM OLD.local_currency THEN
    new_settings = new_settings || jsonb_build_object('local_currency', NEW.local_currency);
  END IF;
  IF NEW.supported_currencies IS DISTINCT FROM OLD.supported_currencies THEN
    new_settings = new_settings || jsonb_build_object('supported_currencies', NEW.supported_currencies);
  END IF;
  IF NEW.fiscal_year_start IS DISTINCT FROM OLD.fiscal_year_start THEN
    new_settings = new_settings || jsonb_build_object('fiscal_year_start', NEW.fiscal_year_start);
  END IF;
  IF NEW.default_cash_account_id IS DISTINCT FROM OLD.default_cash_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_cash_account_id', NEW.default_cash_account_id);
  END IF;
  IF NEW.default_bank_account_id IS DISTINCT FROM OLD.default_bank_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_bank_account_id', NEW.default_bank_account_id);
  END IF;
  IF NEW.default_revenue_account_id IS DISTINCT FROM OLD.default_revenue_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_revenue_account_id', NEW.default_revenue_account_id);
  END IF;
  IF NEW.default_expense_account_id IS DISTINCT FROM OLD.default_expense_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_expense_account_id', NEW.default_expense_account_id);
  END IF;
  IF NEW.default_receivable_account_id IS DISTINCT FROM OLD.default_receivable_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_receivable_account_id', NEW.default_receivable_account_id);
  END IF;
  IF NEW.default_payable_account_id IS DISTINCT FROM OLD.default_payable_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_payable_account_id', NEW.default_payable_account_id);
  END IF;
  IF NEW.default_purchase_account_id IS DISTINCT FROM OLD.default_purchase_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_purchase_account_id', NEW.default_purchase_account_id);
  END IF;
  IF NEW.default_cogs_account_id IS DISTINCT FROM OLD.default_cogs_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_cogs_account_id', NEW.default_cogs_account_id);
  END IF;
  IF NEW.default_sales_account_id IS DISTINCT FROM OLD.default_sales_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_sales_account_id', NEW.default_sales_account_id);
  END IF;
  IF NEW.default_tax_input_account_id IS DISTINCT FROM OLD.default_tax_input_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_tax_input_account_id', NEW.default_tax_input_account_id);
  END IF;
  IF NEW.default_tax_output_account_id IS DISTINCT FROM OLD.default_tax_output_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_tax_output_account_id', NEW.default_tax_output_account_id);
  END IF;
  IF NEW.default_inventory_account_id IS DISTINCT FROM OLD.default_inventory_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_inventory_account_id', NEW.default_inventory_account_id);
  END IF;
  IF NEW.default_transit_purchase_account_id IS DISTINCT FROM OLD.default_transit_purchase_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_transit_purchase_account_id', NEW.default_transit_purchase_account_id);
  END IF;
  IF NEW.default_fx_gain_account_id IS DISTINCT FROM OLD.default_fx_gain_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_fx_gain_account_id', NEW.default_fx_gain_account_id);
  END IF;
  IF NEW.default_fx_loss_account_id IS DISTINCT FROM OLD.default_fx_loss_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_fx_loss_account_id', NEW.default_fx_loss_account_id);
  END IF;
  IF NEW.default_freight_in_account_id IS DISTINCT FROM OLD.default_freight_in_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_freight_in_account_id', NEW.default_freight_in_account_id);
  END IF;
  IF NEW.default_retained_earnings_account_id IS DISTINCT FROM OLD.default_retained_earnings_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_retained_earnings_account_id', NEW.default_retained_earnings_account_id);
  END IF;
  IF NEW.default_customer_advance_account_id IS DISTINCT FROM OLD.default_customer_advance_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_customer_advance_account_id', NEW.default_customer_advance_account_id);
  END IF;
  IF NEW.default_supplier_advance_account_id IS DISTINCT FROM OLD.default_supplier_advance_account_id THEN
    new_settings = new_settings || jsonb_build_object('default_supplier_advance_account_id', NEW.default_supplier_advance_account_id);
  END IF;
  IF NEW.profit_account_id IS DISTINCT FROM OLD.profit_account_id THEN
    new_settings = new_settings || jsonb_build_object('profit_account_id', NEW.profit_account_id);
  END IF;
  IF NEW.tax_system IS DISTINCT FROM OLD.tax_system THEN
    new_settings = new_settings || jsonb_build_object('tax_system', NEW.tax_system);
  END IF;
  IF NEW.tax_rate IS DISTINCT FROM OLD.tax_rate THEN
    new_settings = new_settings || jsonb_build_object('tax_rate', NEW.tax_rate);
  END IF;
  IF NEW.rounding_method IS DISTINCT FROM OLD.rounding_method THEN
    new_settings = new_settings || jsonb_build_object('rounding_method', NEW.rounding_method);
  END IF;
  IF NEW.vat_enabled IS DISTINCT FROM OLD.vat_enabled THEN
    new_settings = new_settings || jsonb_build_object('vat_enabled', NEW.vat_enabled);
  END IF;
  IF NEW.vat_rate IS DISTINCT FROM OLD.vat_rate THEN
    new_settings = new_settings || jsonb_build_object('vat_rate', NEW.vat_rate);
  END IF;

  -- If the raw accounting_settings JSONB was passed directly, merge it
  IF NEW.accounting_settings IS DISTINCT FROM OLD.accounting_settings AND NEW.accounting_settings IS NOT NULL THEN
    new_settings = COALESCE(OLD.accounting_settings, '{}'::jsonb) || NEW.accounting_settings;
  END IF;

  -- Update the actual companies table
  UPDATE companies
  SET accounting_settings = new_settings,
      updated_at = now()
  WHERE id = OLD.company_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the INSTEAD OF trigger (drop if exists for idempotency)
DROP TRIGGER IF EXISTS trg_update_company_accounting_settings ON company_accounting_settings;
CREATE TRIGGER trg_update_company_accounting_settings
  INSTEAD OF UPDATE ON company_accounting_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_company_accounting_settings();
