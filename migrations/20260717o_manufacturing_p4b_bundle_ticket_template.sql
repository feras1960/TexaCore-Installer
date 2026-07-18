-- 20260717o: موديول التصنيع — P4b — تسجيل مطبوعة تذكرة الرزمة (bundle_ticket) كقالب نظام
-- ═══════════════════════════════════════════════════════════════════════════
-- يُكمل بذور 20260716h + 20260717c + 20260717j بمطبوعة P4b كقالب نظام (tenant_id NULL, is_system):
--   • bundle_ticket — تذكرة رزمة أرضية المصنع (QR للرزمة + رقمها + المنتج + قائمة المراحل).
-- الطباعة الفعلية تُنتَج من مولّد مضمّن (mfgPrintService.printBundleTickets) بنمط بقية مطبوعات
-- التصنيع — موثوقة ومستقلة عن هذا الجدول. هذه البذرة تسجّل النوع وتوفّر قالباً افتراضياً للتخصيص المستقبلي.
-- doc_type حرّ (VARCHAR بلا CHECK). idempotent: INSERT ... WHERE NOT EXISTS (doc_type + tenant_id NULL).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 12) تذكرة رزمة (Bundle Ticket)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'bundle_ticket', 'manufacturing', 'تذكرة رزمة', 'Bundle Ticket', true, true, 12, true,
'[{"key":"bundle.number","label_ar":"رقم الرزمة","label_en":"Bundle No.","type":"number","group":"document"},
  {"key":"order.number","label_ar":"رقم الأمر","label_en":"Order No.","type":"text","group":"document"},
  {"key":"product.name","label_ar":"المنتج","label_en":"Product","type":"text","group":"document"},
  {"key":"bundle.qty","label_ar":"الكمية","label_en":"Qty","type":"number","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} .ticket{page-break-after:always;padding:6mm;border:1px dashed #cbd5e1} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px}',
'<div class="ticket"><h1>{{doc_title}}</h1><div>{{order.number}} — {{product.name}} — #{{bundle.number}} × {{bundle.qty}}</div>{{LINES_ROWS}}</div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'bundle_ticket' AND tenant_id IS NULL);

COMMIT;
