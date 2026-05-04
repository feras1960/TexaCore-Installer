-- Migration: 20260428100000_accounting_schema_stabilization.sql
-- Description: Stabilizing ERP Accounting Schema

-- 1. company_accounting_settings fixes
ALTER TABLE public.company_accounting_settings 
ADD COLUMN IF NOT EXISTS vat_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) DEFAULT 0.00;

-- Ensure RLS is enabled
ALTER TABLE public.company_accounting_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing to avoid conflicts if they exist
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.company_accounting_settings;
DROP POLICY IF EXISTS "Enable write access for authenticated users" ON public.company_accounting_settings;

CREATE POLICY "Enable read access for authenticated users" 
ON public.company_accounting_settings FOR SELECT 
TO authenticated USING (true);

CREATE POLICY "Enable write access for authenticated users" 
ON public.company_accounting_settings FOR ALL 
TO authenticated USING (true) WITH CHECK (true);

-- 2. get_ticker_kpis RPC permissions
GRANT EXECUTE ON FUNCTION public.get_ticker_kpis(uuid) TO authenticated;

-- 3. payment_vouchers columns
ALTER TABLE public.payment_vouchers 
ADD COLUMN IF NOT EXISTS container_id UUID REFERENCES public.containers(id),
ADD COLUMN IF NOT EXISTS purchase_invoice_id UUID REFERENCES public.trade_documents(id);

-- 4. containers columns
ALTER TABLE public.containers
ADD COLUMN IF NOT EXISTS receiving_warehouse_id UUID REFERENCES public.warehouses(id),
ADD COLUMN IF NOT EXISTS expected_arrival_date DATE,
ADD COLUMN IF NOT EXISTS total_purchase_value NUMERIC(15,2) DEFAULT 0.00;

-- 5. saas_payments table
CREATE TABLE IF NOT EXISTS public.saas_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    status VARCHAR(50) DEFAULT 'completed',
    payment_method VARCHAR(50),
    reference_number VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.saas_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for users based on company_id" ON public.saas_payments;
CREATE POLICY "Enable read access for users based on company_id" 
ON public.saas_payments FOR SELECT 
TO authenticated USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

-- Also create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_saas_payments_company_id ON public.saas_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_container_id ON public.payment_vouchers(container_id);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_purchase_invoice_id ON public.payment_vouchers(purchase_invoice_id);
