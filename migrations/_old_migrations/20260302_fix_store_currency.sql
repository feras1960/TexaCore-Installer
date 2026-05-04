-- ============================================
-- Update store currency settings
-- Fix: default_currency should be USD (fabric_materials uses USD)
-- Add more supported currencies
-- Date: 2 March 2026
-- ============================================

UPDATE ecommerce_stores 
SET 
    default_currency = 'USD',
    supported_currencies = '["USD", "EUR", "TRY", "SAR", "AED", "UAH", "RUB"]'::jsonb
WHERE slug = 'textile-international';

-- Verify
DO $$ 
DECLARE v_cur TEXT;
BEGIN
    SELECT default_currency INTO v_cur FROM ecommerce_stores WHERE slug = 'textile-international';
    RAISE NOTICE '✅ Store currency updated to: %', v_cur;
END $$;
