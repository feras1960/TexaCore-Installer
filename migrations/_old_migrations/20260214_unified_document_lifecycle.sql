-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: توحيد دورة المستندات — Unified Document Lifecycle
-- التاريخ: 14 فبراير 2026
-- الهدف: دمج أوامر الشراء/البيع مع الفواتير في جدول واحد لكل جانب
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. تعديل جدول فواتير المشتريات — إضافة أعمدة الدورة الموحدة
-- ═══════════════════════════════════════════════════════════════

-- مرحلة المستند: أي مرحلة من الدورة (request, quotation, order, invoice)
ALTER TABLE purchase_invoices 
  ADD COLUMN IF NOT EXISTS document_stage VARCHAR(20) DEFAULT 'invoice';

-- أعمدة أوامر الشراء (لدعم مرحلة الأمر في نفس الجدول)
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS order_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS order_date DATE,
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms TEXT,
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS discount_value DECIMAL(15,2) DEFAULT 0;

-- فهارس جديدة
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_stage ON purchase_invoices(document_stage);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_order_number ON purchase_invoices(order_number);

COMMENT ON COLUMN purchase_invoices.document_stage IS 'مرحلة المستند: request=طلب, quotation=عرض سعر, order=أمر شراء, invoice=فاتورة';

-- ═══════════════════════════════════════════════════════════════
-- 2. تعديل جدول فواتير المبيعات — إضافة أعمدة الدورة الموحدة
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE sales_invoices 
  ADD COLUMN IF NOT EXISTS document_stage VARCHAR(20) DEFAULT 'invoice';

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS order_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS order_date DATE,
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms TEXT,
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS discount_value DECIMAL(15,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_stage ON sales_invoices(document_stage);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_order_number ON sales_invoices(order_number);

COMMENT ON COLUMN sales_invoices.document_stage IS 'مرحلة المستند: request=طلب, quotation=عرض سعر, order=أمر بيع, invoice=فاتورة';

-- ═══════════════════════════════════════════════════════════════
-- 3. تحديث حالات المشتريات — الدورة الموحدة الكاملة
-- ═══════════════════════════════════════════════════════════════

-- حذف الحالات القديمة وإعادة إنشائها بالدورة الموحدة
DELETE FROM status_transitions WHERE doc_type IN ('purchase_invoice', 'purchase_order');
DELETE FROM custom_statuses WHERE doc_type IN ('purchase_invoice', 'purchase_order');

-- إدخال الحالات الموحدة لدورة المشتريات (كلها في purchase_invoice)
INSERT INTO custom_statuses (doc_type, code, name_ar, name_en, color, icon, sort_order, is_initial, is_final)
VALUES
  ('purchase_invoice', 'draft',            'مسودة',              'Draft',              'gray',    'FileText',      10, true,  false),
  ('purchase_invoice', 'requested',        'طلب شراء',           'Purchase Request',   'yellow',  'Send',          20, false, false),
  ('purchase_invoice', 'quoted',           'عرض سعر',            'Quotation',          'purple',  'BookOpen',      30, false, false),
  ('purchase_invoice', 'ordered',          'أمر شراء',           'Purchase Order',     'blue',    'ShieldCheck',   40, false, false),
  ('purchase_invoice', 'received',         'تم الاستلام',        'Goods Received',     'teal',    'Package',       50, false, false),
  ('purchase_invoice', 'invoiced',         'فاتورة',             'Invoiced',           'indigo',  'Receipt',       60, false, false),
  ('purchase_invoice', 'posted',           'مرحّلة',             'Posted',             'cyan',    'CheckCircle2',  70, false, false),
  ('purchase_invoice', 'partially_paid',   'مدفوعة جزئياً',      'Partially Paid',     'orange',  'Coins',         80, false, false),
  ('purchase_invoice', 'paid',             'مدفوعة بالكامل',     'Fully Paid',         'green',   'CircleCheck',   90, false, true),
  ('purchase_invoice', 'cancelled',        'ملغية',              'Cancelled',          'red',     'XCircle',       100, false, true),
  ('purchase_invoice', 'rejected',         'مرفوضة',             'Rejected',           'rose',    'Ban',           110, false, true);

-- إدخال التحولات المسموحة
INSERT INTO status_transitions (doc_type, from_status_id, to_status_id, requires_comment, requires_approval)
SELECT 'purchase_invoice', f.id, t.id,
  CASE 
    WHEN t.code IN ('cancelled', 'rejected') THEN true 
    ELSE false 
  END,
  CASE 
    WHEN t.code = 'posted' THEN true 
    ELSE false 
  END
FROM custom_statuses f, custom_statuses t
WHERE f.doc_type = 'purchase_invoice' AND t.doc_type = 'purchase_invoice'
AND (
  (f.code = 'draft'          AND t.code IN ('requested', 'quoted', 'ordered', 'invoiced', 'cancelled'))
  OR (f.code = 'requested'   AND t.code IN ('quoted', 'ordered', 'cancelled', 'rejected'))
  OR (f.code = 'quoted'      AND t.code IN ('ordered', 'invoiced', 'cancelled', 'rejected'))
  OR (f.code = 'ordered'     AND t.code IN ('received', 'invoiced', 'cancelled'))
  OR (f.code = 'received'    AND t.code IN ('invoiced'))
  OR (f.code = 'invoiced'    AND t.code IN ('posted', 'cancelled'))
  OR (f.code = 'posted'      AND t.code IN ('partially_paid', 'paid'))
  OR (f.code = 'partially_paid' AND t.code IN ('paid'))
  OR (f.code = 'cancelled'   AND t.code IN ('draft'))
);

-- ═══════════════════════════════════════════════════════════════
-- 4. تحديث حالات المبيعات — الدورة الموحدة الكاملة
-- ═══════════════════════════════════════════════════════════════

DELETE FROM status_transitions WHERE doc_type IN ('sales_invoice', 'sales_order');
DELETE FROM custom_statuses WHERE doc_type IN ('sales_invoice', 'sales_order');

INSERT INTO custom_statuses (doc_type, code, name_ar, name_en, color, icon, sort_order, is_initial, is_final)
VALUES
  ('sales_invoice', 'draft',            'مسودة',              'Draft',              'gray',    'FileText',      10, true,  false),
  ('sales_invoice', 'requested',        'طلب بيع',            'Sales Request',      'yellow',  'Send',          20, false, false),
  ('sales_invoice', 'quoted',           'عرض سعر',            'Quotation',          'purple',  'BookOpen',      30, false, false),
  ('sales_invoice', 'ordered',          'أمر بيع',            'Sales Order',        'blue',    'ShieldCheck',   40, false, false),
  ('sales_invoice', 'processing',       'قيد التجهيز',        'Processing',         'indigo',  'Loader2',       45, false, false),
  ('sales_invoice', 'delivered',        'تم التسليم',         'Delivered',          'teal',    'Truck',         50, false, false),
  ('sales_invoice', 'invoiced',         'فاتورة',             'Invoiced',           'cyan',    'Receipt',       60, false, false),
  ('sales_invoice', 'posted',           'مرحّلة',             'Posted',             'blue',    'CheckCircle2',  70, false, false),
  ('sales_invoice', 'partially_paid',   'مدفوعة جزئياً',      'Partially Paid',     'orange',  'Coins',         80, false, false),
  ('sales_invoice', 'paid',             'مدفوعة بالكامل',     'Fully Paid',         'green',   'CircleCheck',   90, false, true),
  ('sales_invoice', 'cancelled',        'ملغية',              'Cancelled',          'red',     'XCircle',       100, false, true),
  ('sales_invoice', 'rejected',         'مرفوضة',             'Rejected',           'rose',    'Ban',           110, false, true);

INSERT INTO status_transitions (doc_type, from_status_id, to_status_id, requires_comment, requires_approval)
SELECT 'sales_invoice', f.id, t.id,
  CASE WHEN t.code IN ('cancelled', 'rejected') THEN true ELSE false END,
  CASE WHEN t.code = 'posted' THEN true ELSE false END
FROM custom_statuses f, custom_statuses t
WHERE f.doc_type = 'sales_invoice' AND t.doc_type = 'sales_invoice'
AND (
  (f.code = 'draft'          AND t.code IN ('requested', 'quoted', 'ordered', 'invoiced', 'cancelled'))
  OR (f.code = 'requested'   AND t.code IN ('quoted', 'ordered', 'cancelled', 'rejected'))
  OR (f.code = 'quoted'      AND t.code IN ('ordered', 'invoiced', 'cancelled', 'rejected'))
  OR (f.code = 'ordered'     AND t.code IN ('processing', 'delivered', 'invoiced', 'cancelled'))
  OR (f.code = 'processing'  AND t.code IN ('delivered', 'invoiced'))
  OR (f.code = 'delivered'   AND t.code IN ('invoiced'))
  OR (f.code = 'invoiced'    AND t.code IN ('posted', 'cancelled'))
  OR (f.code = 'posted'      AND t.code IN ('partially_paid', 'paid'))
  OR (f.code = 'partially_paid' AND t.code IN ('paid'))
  OR (f.code = 'cancelled'   AND t.code IN ('draft'))
);

-- ═══════════════════════════════════════════════════════════════
-- 5. تنظيف: تحديث document_stage تلقائياً بناءً على الحالة
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_document_stage()
RETURNS TRIGGER AS $$
BEGIN
  -- تحديث مرحلة المستند تلقائياً بناءً على الحالة
  IF NEW.status IN ('draft', 'requested') THEN
    NEW.document_stage := 'request';
  ELSIF NEW.status = 'quoted' THEN
    NEW.document_stage := 'quotation';
  ELSIF NEW.status IN ('ordered', 'processing', 'received', 'delivered') THEN
    NEW.document_stage := 'order';
  ELSIF NEW.status IN ('invoiced', 'posted', 'partially_paid', 'paid', 'cancelled', 'rejected') THEN
    NEW.document_stage := 'invoice';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- تطبيق الـ trigger على كلا الجدولين
DROP TRIGGER IF EXISTS trg_purchase_invoice_stage ON purchase_invoices;
CREATE TRIGGER trg_purchase_invoice_stage
  BEFORE INSERT OR UPDATE OF status ON purchase_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_document_stage();

DROP TRIGGER IF EXISTS trg_sales_invoice_stage ON sales_invoices;
CREATE TRIGGER trg_sales_invoice_stage
  BEFORE INSERT OR UPDATE OF status ON sales_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_document_stage();

-- ═══════════════════════════════════════════════════════════════
-- ✅ النتيجة النهائية:
-- purchase_invoices = الدورة الكاملة من طلب شراء إلى دفع
-- sales_invoices = الدورة الكاملة من طلب بيع إلى تحصيل
-- document_stage يتحدث تلقائياً بناءً على الحالة
-- ═══════════════════════════════════════════════════════════════
