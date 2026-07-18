-- 20260717c: موديول التصنيع — تسجيل مطبوعتَي P2 (كشف أجور عامل + تقرير إنتاج يومي) في print_templates
-- ═══════════════════════════════════════════════════════════════════════════
-- يُكمل بذور 20260716h بمطبوعتَي P2 (§4-ب / §4-ج-24) كقوالب نظام (tenant_id NULL, is_system)
-- بنفس نمط 20260716h — فتظهر قابلة للتخصيص في محرّر القوالب.
--
-- ملاحظة تنفيذية: الطباعة الفعلية لأزرار P2b تُنتَج من مولّدات مضمّنة
-- (src/features/manufacturing/prints/mfgPrintService.ts) بنمط بقية مطبوعات التصنيع — موثوقة
-- ومستقلة عن هذا الجدول. هذه البذور تسجّل النوعين وتوفّر قالباً افتراضياً للتخصيص المستقبلي.
--
-- doc_type حرّ (VARCHAR بلا CHECK). idempotent: INSERT ... WHERE NOT EXISTS (doc_type + tenant_id NULL).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 6) كشف أجور عامل (Worker Wage Statement)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'wage_statement', 'manufacturing', 'كشف أجور عامل', 'Worker Wage Statement', true, true, 6, false,
'[{"key":"employee.name","label_ar":"العامل","label_en":"Worker","type":"text","group":"document"},
  {"key":"period.name","label_ar":"الفترة","label_en":"Period","type":"text","group":"document"},
  {"key":"total.wage","label_ar":"إجمالي الأجر","label_en":"Total Wage","type":"number","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px} .sig{margin-top:48px;display:flex;gap:40px} .sig div{flex:1;border-top:1px solid #9ca3af;text-align:center;padding-top:4px}',
'<h1>{{doc_title}}</h1><div>{{employee.name}} — {{period.name}}</div>{{LINES_ROWS}}<div>{{total.wage}}</div><div class="sig"><div>العامل / Worker</div><div>مدير الإنتاج / Production manager</div></div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'wage_statement' AND tenant_id IS NULL);

-- 7) تقرير إنتاج يومي (Daily Production Report)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr, variables, template_css, template_html)
SELECT NULL, 'daily_production_report', 'manufacturing', 'تقرير إنتاج يومي', 'Daily Production Report', true, true, 7, false,
'[{"key":"report.date","label_ar":"التاريخ","label_en":"Date","type":"date","group":"document"},
  {"key":"total.good","label_ar":"إجمالي الجيّد","label_en":"Total Good","type":"number","group":"document"},
  {"key":"total.scrap","label_ar":"إجمالي الخردة","label_en":"Total Scrap","type":"number","group":"document"}]'::jsonb,
'body{font-family:Tahoma,Arial,sans-serif;color:#1a1a2e} table{width:100%;border-collapse:collapse} th,td{border:1px solid #d1d5db;padding:6px}',
'<h1>{{doc_title}}</h1><div>{{report.date}}</div>{{LINES_ROWS}}<div>{{total.good}} — {{total.scrap}}</div>'
WHERE NOT EXISTS (SELECT 1 FROM print_templates WHERE doc_type = 'daily_production_report' AND tenant_id IS NULL);

COMMIT;
