-- 20260716h: موديول التصنيع — تسجيل أنواع مطبوعات التصنيع في print_templates — P1b
-- ═══════════════════════════════════════════════════════════════════════════
-- يسجّل أنواع مستندات التصنيع الخمسة كقوالب نظام (tenant_id NULL, is_system) بنمط
-- بذور 20260223_print_engine.sql — فتظهر قابلة للتخصيص في محرّر القوالب (PrintSettingsTab).
--
-- ملاحظة تنفيذية (P1b): الطباعة الفعلية لأزرار P1b تُنتَج من مولّدات مضمّنة
-- (src/features/manufacturing/prints/mfgPrintService.ts + LabelDialogs.tsx) بنمط
-- RollLabelPreviewDialog المرجعي (§4-ب) — موثوقة ومستقلة عن هذا الجدول. هذه البذور
-- تسجّل الأنواع وتوفّر قالباً افتراضياً للتخصيص المستقبلي؛ ربط usePrintData
-- (fetchers + mapDocData) لمسار EnhancedPrintDialog الكامل مؤجّل إلى P2.
--
-- doc_type حرّ (VARCHAR بلا CHECK) — لا تغيير مخطط. idempotent: INSERT ... WHERE NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) أمر إنتاج / تذكرة تشغيل
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'production_order', 'manufacturing', 'أمر إنتاج / تذكرة تشغيل', 'Production Order / Work Order', true, true, 1, true,
'[{"key":"order.number","label_ar":"رقم الأمر","label_en":"Order No","type":"text","group":"document"},
  {"key":"product.name","label_ar":"المنتج","label_en":"Product","type":"text","group":"document"},
  {"key":"order.qty_planned","label_ar":"الكمية المخطّطة","label_en":"Planned Qty","type":"number","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px}',
'<h1>{{doc_title}}</h1><div>{{order.number}} — {{product.name}} — {{order.qty_planned}}</div>{{QR_CODE}}'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'production_order' AND tenant_id IS NULL);

-- 2) قسيمة صرف مواد (Pick List)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'material_pick_list', 'manufacturing', 'قسيمة صرف مواد', 'Material Pick List', true, true, 2, true,
'[{"key":"issue.number","label_ar":"رقم الصرف","label_en":"Issue No","type":"text","group":"document"},
  {"key":"order.number","label_ar":"رقم الأمر","label_en":"Order No","type":"text","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} .sig{margin-top:48px;display:flex;gap:40px} .sig div{flex:1;border-top:1px solid #9ca3af;text-align:center;padding-top:4px}',
'<h1>{{doc_title}}</h1><div>{{issue.number}} — {{order.number}}</div>{{LINES_ROWS}}{{QR_CODE}}<div class="sig"><div>أمين المستودع / Warehouse keeper</div><div>المستلم / Receiver</div></div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'material_pick_list' AND tenant_id IS NULL);

-- 3) سند استلام إنتاج
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'production_receipt', 'manufacturing', 'سند استلام إنتاج', 'Production Receipt', true, true, 3, true,
'[{"key":"receipt.number","label_ar":"رقم السند","label_en":"Receipt No","type":"text","group":"document"},
  {"key":"order.number","label_ar":"رقم الأمر","label_en":"Order No","type":"text","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px}',
'<h1>{{doc_title}}</h1><div>{{receipt.number}} — {{order.number}}</div>{{LINES_ROWS}}{{QR_CODE}}'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'production_receipt' AND tenant_id IS NULL);

-- 4) ملصق دفعة
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'batch_label', 'manufacturing', 'ملصق دفعة', 'Batch Label', true, true, 4, true,
'[{"key":"batch.number","label_ar":"رقم الدفعة","label_en":"Batch No","type":"text","group":"label"},
  {"key":"product.name","label_ar":"المنتج","label_en":"Product","type":"text","group":"label"},
  {"key":"batch.expiry","label_ar":"الانتهاء","label_en":"Expiry","type":"date","group":"label"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif} .label{width:62mm;padding:4mm}',
'<div class="label"><b>{{product.name}}</b><div>{{batch.number}}</div><div>{{batch.expiry}}</div>{{QR_CODE}}</div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'batch_label' AND tenant_id IS NULL);

-- 5) ملصق عبوة/كيس
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'package_label', 'manufacturing', 'ملصق عبوة/كيس', 'Package Label', true, true, 5, true,
'[{"key":"product.name","label_ar":"المنتج","label_en":"Product","type":"text","group":"label"},
  {"key":"package.size","label_ar":"حجم العبوة","label_en":"Package Size","type":"text","group":"label"},
  {"key":"batch.number","label_ar":"رقم الدفعة","label_en":"Batch No","type":"text","group":"label"},
  {"key":"batch.expiry","label_ar":"الانتهاء","label_en":"Expiry","type":"date","group":"label"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif} .label{width:62mm;padding:4mm}',
'<div class="label"><b>{{product.name}}</b><div>{{package.size}}</div><div>{{batch.number}}</div><div>{{batch.expiry}}</div>{{QR_CODE}}</div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'package_label' AND tenant_id IS NULL);

COMMIT;
