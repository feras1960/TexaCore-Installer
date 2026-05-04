CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_currency
  ON chart_of_accounts(company_id, currency)
  WHERE currency IS NOT NULL;
