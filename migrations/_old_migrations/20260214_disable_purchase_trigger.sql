-- Disable the database trigger for automatic journal entry creation on purchase invoices
-- This trigger conflicts with the new manual service (purchaseAccountingService.ts) which handles JE creation appropriately.
-- The trigger was causing 'duplicate key' errors and 'account not found' errors because it ran in parallel with the service
-- and likely had outdated logic/account ids.

DROP TRIGGER IF EXISTS trg_purchase_invoice_journal_entry ON purchase_invoices;
DROP FUNCTION IF EXISTS create_purchase_invoice_journal_entry();
