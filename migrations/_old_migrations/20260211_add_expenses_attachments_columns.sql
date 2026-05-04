-- ═══════════════════════════════════════════════════════════════
-- Migration: Add expenses & attachments JSONB columns to trade tables
-- Date: 2026-02-11
-- Purpose: Support inline expenses (payment vouchers) and attachments
--          on purchase invoices and other trade documents
-- ═══════════════════════════════════════════════════════════════

-- ─── purchase_invoices ───
ALTER TABLE purchase_invoices 
  ADD COLUMN IF NOT EXISTS expenses JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expenses_total NUMERIC(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- ─── sales_invoices ───
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS expenses JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expenses_total NUMERIC(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- ─── quotations ───
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS expenses JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expenses_total NUMERIC(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- ─── sales_orders ───
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS expenses JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expenses_total NUMERIC(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- ─── sales_deliveries ───
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_deliveries' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE sales_deliveries ADD COLUMN IF NOT EXISTS expenses JSONB DEFAULT ''[]''::jsonb';
    EXECUTE 'ALTER TABLE sales_deliveries ADD COLUMN IF NOT EXISTS expenses_total NUMERIC(18,2) DEFAULT 0';
    EXECUTE 'ALTER TABLE sales_deliveries ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT ''[]''::jsonb';
  END IF;
END
$$;

-- ─── Also ensure purchase-specific fields exist ───
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS supplier_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS supplier_invoice_date DATE,
  ADD COLUMN IF NOT EXISTS supplier_notes TEXT;

-- ═══ Comments ═══
COMMENT ON COLUMN purchase_invoices.expenses IS 'مصاريف إضافية على الفاتورة (شحن/جمارك/تأمين) كـ JSONB array';
COMMENT ON COLUMN purchase_invoices.expenses_total IS 'إجمالي المصاريف الإضافية';
COMMENT ON COLUMN purchase_invoices.attachments IS 'مرفقات المستند (PDF/صور) كـ JSONB array';
COMMENT ON COLUMN purchase_invoices.supplier_invoice_number IS 'رقم فاتورة المورد الأصلية';
COMMENT ON COLUMN purchase_invoices.supplier_invoice_date IS 'تاريخ فاتورة المورد';
COMMENT ON COLUMN purchase_invoices.supplier_notes IS 'ملاحظات المورد';
