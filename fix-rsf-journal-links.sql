-- ═══ Fix RSF Journal Entry Links & Stage ═══
-- This script fixes existing RSF-imported data:
-- 1. Links journal entries ↔ purchase transactions bidirectionally
-- 2. Updates stage from 'received' to 'posted' for RSF invoices
-- Run this ONCE on the local database to fix already-imported data

BEGIN;

-- Step 1: Update journal_entries with reference_type and reference_id
-- Journal entry_number: RSF-PI-JE-{N} → Purchase invoice_no: RSF-PI-{N}
UPDATE journal_entries je
SET reference_type = 'purchase_invoice',
    reference_id = pt.id
FROM purchase_transactions pt
WHERE je.entry_number LIKE 'RSF-PI-JE-%'
  AND pt.invoice_no = REPLACE(je.entry_number, 'RSF-PI-JE-', 'RSF-PI-')
  AND je.reference_id IS NULL
  AND je.tenant_id = pt.tenant_id;

-- Step 2: Update purchase_transactions with journal_entry_id
UPDATE purchase_transactions pt
SET journal_entry_id = je.id
FROM journal_entries je
WHERE je.entry_number LIKE 'RSF-PI-JE-%'
  AND pt.invoice_no = REPLACE(je.entry_number, 'RSF-PI-JE-', 'RSF-PI-')
  AND pt.journal_entry_id IS NULL
  AND je.tenant_id = pt.tenant_id;

-- Step 3: Fix stage from 'received' to 'posted' for RSF invoices
-- These invoices already have journal entries posted, so stage should be 'posted'
UPDATE purchase_transactions
SET stage = 'posted'
WHERE invoice_no LIKE 'RSF-PI-%'
  AND stage = 'received'
  AND is_posted = true;

COMMIT;

-- Step 4: Verify the fix
SELECT 
  pt.invoice_no,
  pt.stage,
  pt.is_posted,
  pt.journal_entry_id IS NOT NULL AS has_je_link,
  je.entry_number,
  je.is_posted AS je_posted,
  je.reference_type,
  je.reference_id IS NOT NULL AS has_ref_link
FROM purchase_transactions pt
LEFT JOIN journal_entries je ON je.id = pt.journal_entry_id
WHERE pt.invoice_no LIKE 'RSF-PI-%'
ORDER BY pt.invoice_no
LIMIT 20;
