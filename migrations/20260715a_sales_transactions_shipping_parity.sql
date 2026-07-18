-- ═══════════════════════════════════════════════════════════════
-- 20260715a — تكافؤ أعمدة الشحن على sales_transactions
-- المشكلة (مكتشفة بتجربة E2E حية): هجرة 20260211_customer_shipping أضافت
-- shipping_address_id وأعمدة الناقل إلى الجداول القديمة (quotations/sales_orders/
-- sales_invoices) فقط، بينما الدورة الحية تعمل على sales_transactions —
-- فكان «تأكيد وإرسال» لأي فاتورة بعنوان توصيل يفشل بـ:
--   Could not find the 'shipping_address_id' column of 'sales_transactions'
-- ومسار «شركة شحن» (shipping_carrier/shipping_cost/np_*) كان سينكسر كذلك.
-- الحل: إضافات صرفة IF NOT EXISTS بلا أي تغيير سلوكي.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE sales_transactions
    ADD COLUMN IF NOT EXISTS shipping_address_id UUID REFERENCES customer_addresses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS shipping_recipient VARCHAR(200),
    ADD COLUMN IF NOT EXISTS shipping_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50),
    ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS np_document_ref TEXT,
    ADD COLUMN IF NOT EXISTS np_estimated_delivery TEXT,
    ADD COLUMN IF NOT EXISTS np_status TEXT,
    ADD COLUMN IF NOT EXISTS np_status_code INT,
    ADD COLUMN IF NOT EXISTS np_actual_delivery TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_transactions_shipping_address
    ON sales_transactions(shipping_address_id) WHERE shipping_address_id IS NOT NULL;

COMMENT ON COLUMN sales_transactions.shipping_address_id IS 'عنوان التوصيل المختار من customer_addresses (تكافؤ 20260211)';
