-- 20260717j: موديول التصنيع — P3b — تسجيل مطبوعات P3b في print_templates (قوالب نظام)
-- ═══════════════════════════════════════════════════════════════════════════
-- يُكمل بذور 20260716h + 20260717c بمطبوعات P3b كقوالب نظام (tenant_id NULL, is_system):
--   • coa_certificate        — شهادة تحليل الدفعة (Certificate of Analysis).
--   • order_traveler         — رحلة الأمر / تذكرة المراحل (Order Traveler).
--   • subcontract_delivery   — إذن تسليم مواد لمقاول الباطن.
--   • subcontract_receipt    — محضر استلام من مقاول الباطن.
-- الطباعة الفعلية تُنتَج من مولّدات مضمّنة (mfgPrintService.ts) بنمط بقية مطبوعات التصنيع —
-- موثوقة ومستقلة عن هذا الجدول. هذه البذور تسجّل الأنواع وتوفّر قالباً افتراضياً للتخصيص المستقبلي.
-- doc_type حرّ (VARCHAR بلا CHECK). idempotent: INSERT ... WHERE NOT EXISTS (doc_type + tenant_id NULL).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 8) شهادة تحليل الدفعة (Certificate of Analysis)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'coa_certificate', 'manufacturing', 'شهادة تحليل', 'Certificate of Analysis', true, true, 8, true,
'[{"key":"batch.number","label_ar":"رقم الدفعة","label_en":"Batch No.","type":"text","group":"document"},
  {"key":"product.name","label_ar":"المنتج","label_en":"Product","type":"text","group":"document"},
  {"key":"batch.mfg_date","label_ar":"تاريخ الإنتاج","label_en":"Mfg Date","type":"date","group":"document"},
  {"key":"batch.expiry_date","label_ar":"تاريخ الانتهاء","label_en":"Expiry","type":"date","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px} .sig{margin-top:48px;display:flex;gap:40px} .sig div{flex:1;border-top:1px solid #9ca3af;text-align:center;padding-top:4px}',
'<h1>{{doc_title}}</h1><div>{{product.name}} — {{batch.number}}</div>{{LINES_ROWS}}<div class="sig"><div>مسؤول الجودة / QA</div><div>مدير الإنتاج / Production manager</div></div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'coa_certificate' AND tenant_id IS NULL);

-- 9) رحلة الأمر / تذكرة المراحل (Order Traveler)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'order_traveler', 'manufacturing', 'رحلة الأمر', 'Order Traveler', true, true, 9, true,
'[{"key":"order.number","label_ar":"رقم الأمر","label_en":"Order No.","type":"text","group":"document"},
  {"key":"product.name","label_ar":"المنتج","label_en":"Product","type":"text","group":"document"},
  {"key":"order.qty","label_ar":"الكمية","label_en":"Qty","type":"number","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px}',
'<h1>{{doc_title}}</h1><div>{{order.number}} — {{product.name}} — {{order.qty}}</div>{{LINES_ROWS}}'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'order_traveler' AND tenant_id IS NULL);

-- 10) إذن تسليم مواد لمقاول الباطن (Subcontract Delivery Note)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'subcontract_delivery', 'manufacturing', 'إذن تسليم مقاول', 'Subcontract Delivery Note', true, true, 10, true,
'[{"key":"doc.number","label_ar":"رقم المستند","label_en":"Doc No.","type":"text","group":"document"},
  {"key":"subcontractor.name","label_ar":"المقاول","label_en":"Subcontractor","type":"text","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px} .sig{margin-top:48px;display:flex;gap:40px} .sig div{flex:1;border-top:1px solid #9ca3af;text-align:center;padding-top:4px}',
'<h1>{{doc_title}}</h1><div>{{doc.number}} — {{subcontractor.name}}</div>{{LINES_ROWS}}<div class="sig"><div>المُسلِّم / Sender</div><div>المقاول / Subcontractor</div></div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'subcontract_delivery' AND tenant_id IS NULL);

-- 11) محضر استلام من مقاول الباطن (Subcontract Receipt Note)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'subcontract_receipt', 'manufacturing', 'محضر استلام مقاول', 'Subcontract Receipt Note', true, true, 11, true,
'[{"key":"doc.number","label_ar":"رقم المستند","label_en":"Doc No.","type":"text","group":"document"},
  {"key":"subcontractor.name","label_ar":"المقاول","label_en":"Subcontractor","type":"text","group":"document"},
  {"key":"service.cost","label_ar":"تكلفة الخدمة","label_en":"Service Cost","type":"number","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px} .sig{margin-top:48px;display:flex;gap:40px} .sig div{flex:1;border-top:1px solid #9ca3af;text-align:center;padding-top:4px}',
'<h1>{{doc_title}}</h1><div>{{doc.number}} — {{subcontractor.name}} — {{service.cost}}</div>{{LINES_ROWS}}<div class="sig"><div>المستلِم / Receiver</div><div>المقاول / Subcontractor</div></div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'subcontract_receipt' AND tenant_id IS NULL);

COMMIT;
