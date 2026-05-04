-- ════════════════════════════════════════════════════════════════
-- 🖨️ Print & Template Engine v3.0
-- ════════════════════════════════════════════════════════════════
-- Date: 2026-02-23
-- Rules:
--   1. Template language = company country language (NOT user UI)
--   2. Tax rate = from company_accounting_settings (NOT hardcoded)
--   3. QR Code = enabled by default for ALL document types
-- ════════════════════════════════════════════════════════════════

-- ═══ 1. Print Templates ═════════════════════════════════════════
CREATE TABLE IF NOT EXISTS print_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id),
    doc_type        VARCHAR(50) NOT NULL,
    name_ar         VARCHAR(200) NOT NULL,
    template_html   TEXT NOT NULL
);

DO $$
BEGIN
    -- Add new columns to existing print_templates table
    ALTER TABLE print_templates 
        ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id),
        ADD COLUMN IF NOT EXISTS name_en VARCHAR(200),
        ADD COLUMN IF NOT EXISTS description_ar TEXT,
        ADD COLUMN IF NOT EXISTS description_en TEXT,
        ADD COLUMN IF NOT EXISTS header_html TEXT,
        ADD COLUMN IF NOT EXISTS footer_html TEXT,
        ADD COLUMN IF NOT EXISTS custom_width NUMERIC,
        ADD COLUMN IF NOT EXISTS custom_height NUMERIC,
        ADD COLUMN IF NOT EXISTS include_logo BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS include_stamp BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS include_signature BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS created_by UUID;
        
    -- Update existing columns if needed (cannot change category NOT NULL easily if there is data, but let's assume it's fine)
END $$;

-- ═══ 2. Company Print Settings ══════════════════════════════════
CREATE TABLE IF NOT EXISTS company_print_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) UNIQUE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    
    -- Branding
    logo_url        TEXT,
    stamp_url       TEXT,
    signature_url   TEXT,
    
    -- Header info (supplements company table data)
    header_company_name_ar    VARCHAR(200),
    header_company_name_en    VARCHAR(200),
    header_address_ar         TEXT,
    header_address_en         TEXT,
    header_phone              VARCHAR(50),
    header_email              VARCHAR(100),
    header_website            VARCHAR(200),
    header_tax_number         VARCHAR(50),
    header_commercial_reg     VARCHAR(50),
    
    -- Footer
    footer_text_ar            TEXT DEFAULT 'شكراً لتعاملكم معنا',
    footer_text_en            TEXT DEFAULT 'Thank you for your business',
    footer_terms_ar           TEXT,
    footer_terms_en           TEXT,
    
    -- Defaults
    default_paper_size        VARCHAR(10) DEFAULT 'A4',
    default_copies            INTEGER DEFAULT 1,
    auto_print_on_confirm     BOOLEAN DEFAULT false,
    show_qr_by_default        BOOLEAN DEFAULT true,
    
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ═══ 3. Indexes ═════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_pt_doc_type ON print_templates(doc_type);
CREATE INDEX IF NOT EXISTS idx_pt_tenant ON print_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pt_company ON print_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_pt_category ON print_templates(category);

-- ═══ 4. Updated_at Trigger ══════════════════════════════════════
CREATE OR REPLACE FUNCTION update_print_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pt_updated') THEN
    CREATE TRIGGER trg_pt_updated BEFORE UPDATE ON print_templates
      FOR EACH ROW EXECUTE FUNCTION update_print_timestamp();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cps_updated') THEN
    CREATE TRIGGER trg_cps_updated BEFORE UPDATE ON company_print_settings
      FOR EACH ROW EXECUTE FUNCTION update_print_timestamp();
  END IF;
END $$;

-- ═══ 5. RLS ═════════════════════════════════════════════════════
ALTER TABLE print_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pt_sel" ON print_templates;
CREATE POLICY "pt_sel" ON print_templates FOR SELECT USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()) OR tenant_id IS NULL);
DROP POLICY IF EXISTS "pt_ins" ON print_templates;
CREATE POLICY "pt_ins" ON print_templates FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "pt_upd" ON print_templates;
CREATE POLICY "pt_upd" ON print_templates FOR UPDATE USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "pt_del" ON print_templates;
CREATE POLICY "pt_del" ON print_templates FOR DELETE USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()) AND is_system = false);

ALTER TABLE company_print_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cps_sel" ON company_print_settings;
CREATE POLICY "cps_sel" ON company_print_settings FOR SELECT USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "cps_ins" ON company_print_settings;
CREATE POLICY "cps_ins" ON company_print_settings FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "cps_upd" ON company_print_settings;
CREATE POLICY "cps_upd" ON company_print_settings FOR UPDATE USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "cps_del" ON company_print_settings;
CREATE POLICY "cps_del" ON company_print_settings FOR DELETE USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- ═══ 6. System Templates ═══════════════════════════════════════
-- All templates use {{variable}} syntax
-- Variables are country-aware: {{tax_id_label}}, {{doc_title}}, {{tax_name}}
-- Tax rate comes from the ACTUAL invoice/entry data, never hardcoded
-- Language adapts to company country_code via printService

-- 6.1 Sales Invoice (Universal — works for ALL countries)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr,
variables, template_css, template_html) VALUES
(NULL, 'sales_invoice', 'invoice', 'فاتورة مبيعات احترافية', 'Professional Sales Invoice', true, true, 1, true,
'[{"key":"company.name","label_ar":"اسم الشركة","label_en":"Company Name","type":"text","group":"company"},
{"key":"company.address","label_ar":"العنوان","label_en":"Address","type":"text","group":"company"},
{"key":"company.phone","label_ar":"الهاتف","label_en":"Phone","type":"text","group":"company"},
{"key":"company.email","label_ar":"البريد","label_en":"Email","type":"text","group":"company"},
{"key":"company.tax_id","label_ar":"الرقم الضريبي","label_en":"Tax ID","type":"text","group":"company"},
{"key":"company.commercial_reg","label_ar":"السجل التجاري","label_en":"Commercial Reg","type":"text","group":"company"},
{"key":"company.logo","label_ar":"الشعار","label_en":"Logo","type":"image","group":"company"},
{"key":"customer.name","label_ar":"اسم العميل","label_en":"Customer Name","type":"text","group":"party"},
{"key":"customer.phone","label_ar":"هاتف العميل","label_en":"Customer Phone","type":"text","group":"party"},
{"key":"customer.address","label_ar":"عنوان العميل","label_en":"Customer Address","type":"text","group":"party"},
{"key":"customer.tax_id","label_ar":"ضريبي العميل","label_en":"Customer Tax ID","type":"text","group":"party"},
{"key":"invoice.number","label_ar":"رقم الفاتورة","label_en":"Invoice No","type":"text","group":"document"},
{"key":"invoice.date","label_ar":"تاريخ الإصدار","label_en":"Issue Date","type":"date","group":"document"},
{"key":"invoice.due_date","label_ar":"تاريخ الاستحقاق","label_en":"Due Date","type":"date","group":"document"},
{"key":"invoice.supply_date","label_ar":"تاريخ التوريد","label_en":"Supply Date","type":"date","group":"document"},
{"key":"invoice.subtotal","label_ar":"المجموع الفرعي","label_en":"Subtotal","type":"number","group":"totals"},
{"key":"invoice.discount","label_ar":"الخصم","label_en":"Discount","type":"number","group":"totals"},
{"key":"invoice.tax_amount","label_ar":"الضريبة","label_en":"Tax","type":"number","group":"totals"},
{"key":"invoice.total","label_ar":"الإجمالي","label_en":"Grand Total","type":"number","group":"totals"},
{"key":"invoice.paid","label_ar":"المدفوع","label_en":"Paid","type":"number","group":"totals"},
{"key":"invoice.balance","label_ar":"المتبقي","label_en":"Balance","type":"number","group":"totals"},
{"key":"invoice.currency","label_ar":"العملة","label_en":"Currency","type":"text","group":"document"},
{"key":"invoice.payment_terms","label_ar":"شروط الدفع","label_en":"Payment Terms","type":"text","group":"document"},
{"key":"invoice.notes","label_ar":"ملاحظات","label_en":"Notes","type":"text","group":"document"},
{"key":"invoice.items","label_ar":"البنود","label_en":"Items","type":"table","group":"items"},
{"key":"tax_id_label","label_ar":"تسمية الرقم الضريبي","label_en":"Tax ID Label","type":"system","group":"country"},
{"key":"tax_name","label_ar":"اسم الضريبة","label_en":"Tax Name","type":"system","group":"country"},
{"key":"doc_title","label_ar":"عنوان المستند","label_en":"Document Title","type":"system","group":"country"},
{"key":"QR_CODE","label_ar":"رمز QR","label_en":"QR Code","type":"system","group":"system"},
{"key":"STAMP","label_ar":"الختم","label_en":"Stamp","type":"system","group":"system"},
{"key":"SIGNATURE","label_ar":"التوقيع","label_en":"Signature","type":"system","group":"system"}]'::jsonb,
-- CSS (Universal — supports RTL + LTR via {{direction}} variable)
'*{margin:0;padding:0;box-sizing:border-box}
body{font-family:{{font_family}};direction:{{direction}};color:#1a1a2e;font-size:12px;line-height:1.6}
.page{width:190mm;margin:0 auto;padding:10mm}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f3460;padding-bottom:12px;margin-bottom:16px}
.header .logo img{max-height:60px;max-width:140px}
.header .co-info h1{font-size:20px;color:#0f3460;margin-bottom:2px}
.header .co-info p{font-size:10px;color:#555;line-height:1.5}
.title{text-align:center;margin:16px 0}
.title h2{font-size:18px;color:#0f3460;border:2px solid #0f3460;display:inline-block;padding:6px 32px;border-radius:6px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.box{background:#f8f9fa;border:1px solid #e0e0e0;border-radius:6px;padding:10px 14px}
.box h4{font-size:11px;color:#0f3460;margin-bottom:6px;border-bottom:1px solid #ddd;padding-bottom:4px}
.box p{font-size:11px;line-height:1.8}
.box strong{color:#333}
table.items{width:100%;border-collapse:collapse;margin:16px 0}
table.items th{background:#0f3460;color:#fff;padding:8px 10px;font-size:11px;text-align:center}
table.items td{padding:7px 10px;border-bottom:1px solid #eee;font-size:11px;text-align:center}
table.items tr:nth-child(even){background:#f8f9fc}
.totals-wrap{display:flex;justify-content:flex-start;margin-top:12px}
.totals-wrap table{width:280px}
.totals-wrap td{padding:5px 12px;font-size:12px}
.totals-wrap tr.grand{background:#0f3460;color:#fff;font-size:14px;font-weight:bold}
.totals-wrap tr.grand td{padding:8px 12px;border-radius:4px}
.footer{margin-top:24px;display:flex;justify-content:space-between;align-items:flex-end;border-top:2px solid #0f3460;padding-top:12px}
.footer .notes{max-width:55%;font-size:10px;color:#555}
.footer .stamps{display:flex;gap:24px;align-items:center}
.footer .stamps img{max-height:50px;opacity:0.8}
.qr-box{text-align:center;margin-top:12px}
.qr-box img{width:80px;height:80px}
.terms{margin-top:10px;font-size:9px;color:#888;border-top:1px dashed #ccc;padding-top:8px}
.payment-terms{background:#f0f4ff;border-radius:4px;padding:6px 10px;margin-top:8px;font-size:10px}
@media print{.page{width:100%;padding:0}}',
-- HTML (Universal template — all {{variables}} resolved by printService)
'<div class="page">
<!-- HEADER_START -->
<div class="header">
<div class="logo"><img src="{{company.logo}}" alt=""/></div>
<div class="co-info">
<h1>{{company.name}}</h1>
<p>{{company.address}}</p>
<p>{{company.phone}} | {{company.email}}</p>
<p>{{tax_id_label}}: {{company.tax_id}} | {{company.commercial_reg}}</p>
</div>
</div>
<!-- HEADER_END -->
<div class="title"><h2>{{doc_title}}</h2></div>
<div class="grid2">
<div class="box">
<h4>{{party_section_title}}</h4>
<p><strong>{{customer.name}}</strong></p>
<p>{{customer.address}}</p>
<p>{{customer.phone}}</p>
<p>{{tax_id_label}}: {{customer.tax_id}}</p>
</div>
<div class="box">
<h4>{{doc_info_title}}</h4>
<p>{{invoice_number_label}}: <strong>{{invoice.number}}</strong></p>
<p>{{issue_date_label}}: <strong>{{invoice.date}}</strong></p>
<p>{{due_date_label}}: {{invoice.due_date}}</p>
<p>{{supply_date_label}}: {{invoice.supply_date}}</p>
<p>{{currency_label}}: {{invoice.currency}}</p>
</div>
</div>
<table class="items">
<thead><tr>
<th>#</th><th>{{item_desc_label}}</th><th>{{qty_label}}</th><th>{{unit_label}}</th>
<th>{{price_label}}</th><th>{{discount_label}}</th><th>{{tax_label}} %</th><th>{{tax_label}}</th><th>{{total_label}}</th>
</tr></thead>
<tbody>{{ITEMS_ROWS}}</tbody>
</table>
<div class="totals-wrap"><table>
<tr><td>{{subtotal_label}}</td><td>{{invoice.subtotal}} {{invoice.currency}}</td></tr>
<tr><td>{{discount_label}}</td><td>{{invoice.discount}} {{invoice.currency}}</td></tr>
<tr><td>{{tax_name}}</td><td>{{invoice.tax_amount}} {{invoice.currency}}</td></tr>
<tr class="grand"><td>{{grand_total_label}}</td><td>{{invoice.total}} {{invoice.currency}}</td></tr>
<tr><td>{{paid_label}}</td><td>{{invoice.paid}} {{invoice.currency}}</td></tr>
<tr><td><strong>{{balance_label}}</strong></td><td><strong>{{invoice.balance}} {{invoice.currency}}</strong></td></tr>
</table></div>
<div class="payment-terms">{{payment_terms_label}}: {{invoice.payment_terms}}</div>
<!-- FOOTER_START -->
<div class="footer">
<div class="notes"><p>{{invoice.notes}}</p><p>{{footer_text}}</p></div>
<div class="stamps">{{STAMP}}{{SIGNATURE}}</div>
</div>
<div class="qr-box">{{QR_CODE}}</div>
<div class="terms">{{footer_terms}}</div>
<!-- FOOTER_END -->
</div>');

-- 6.2 Purchase Invoice
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr,
variables, template_css, template_html) VALUES
(NULL, 'purchase_invoice', 'invoice', 'فاتورة مشتريات احترافية', 'Professional Purchase Invoice', true, true, 2, true,
'[{"key":"company.name","label_ar":"اسم الشركة","label_en":"Company Name","type":"text","group":"company"},
{"key":"supplier.name","label_ar":"اسم المورد","label_en":"Supplier Name","type":"text","group":"party"},
{"key":"supplier.tax_id","label_ar":"ضريبي المورد","label_en":"Supplier Tax ID","type":"text","group":"party"},
{"key":"invoice.number","label_ar":"رقم الفاتورة","label_en":"Invoice No","type":"text","group":"document"},
{"key":"invoice.date","label_ar":"التاريخ","label_en":"Date","type":"date","group":"document"},
{"key":"invoice.items","label_ar":"البنود","label_en":"Items","type":"table","group":"items"},
{"key":"invoice.total","label_ar":"الإجمالي","label_en":"Total","type":"number","group":"totals"}]'::jsonb,
'*{margin:0;padding:0;box-sizing:border-box}body{font-family:{{font_family}};direction:{{direction}};color:#1a1a2e;font-size:12px}.page{width:190mm;margin:0 auto;padding:10mm}.header{display:flex;justify-content:space-between;border-bottom:3px solid #16697a;padding-bottom:12px;margin-bottom:16px}.header .co-info h1{font-size:20px;color:#16697a}.header .co-info p{font-size:10px;color:#555}.title h2{text-align:center;font-size:18px;color:#16697a;border:2px solid #16697a;display:inline-block;padding:6px 32px;border-radius:6px;margin:16px auto;display:block;width:fit-content}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}.box{background:#f0f7f8;border:1px solid #d0e8ec;border-radius:6px;padding:10px 14px}.box h4{font-size:11px;color:#16697a;margin-bottom:6px}table.items{width:100%;border-collapse:collapse;margin:16px 0}table.items th{background:#16697a;color:#fff;padding:8px;font-size:11px}table.items td{padding:7px;border-bottom:1px solid #eee;font-size:11px;text-align:center}.totals-wrap table{width:260px}.totals-wrap td{padding:5px 12px}.totals-wrap tr.grand{background:#16697a;color:#fff;font-weight:bold}.footer{margin-top:20px;border-top:2px solid #16697a;padding-top:12px}.qr-box{text-align:center;margin-top:12px}.qr-box img{width:80px;height:80px}@media print{.page{width:100%;padding:0}}',
'<div class="page">
<div class="header"><div class="logo"><img src="{{company.logo}}" alt=""/></div><div class="co-info"><h1>{{company.name}}</h1><p>{{company.address}}</p><p>{{company.phone}} | {{company.email}}</p><p>{{tax_id_label}}: {{company.tax_id}}</p></div></div>
<div class="title"><h2>{{doc_title}}</h2></div>
<div class="grid2">
<div class="box"><h4>{{party_section_title}}</h4><p><strong>{{supplier.name}}</strong></p><p>{{supplier.address}}</p><p>{{supplier.phone}}</p><p>{{tax_id_label}}: {{supplier.tax_id}}</p></div>
<div class="box"><h4>{{doc_info_title}}</h4><p>{{invoice_number_label}}: <strong>{{invoice.number}}</strong></p><p>{{issue_date_label}}: <strong>{{invoice.date}}</strong></p><p>{{due_date_label}}: {{invoice.due_date}}</p><p>{{currency_label}}: {{invoice.currency}}</p></div>
</div>
<table class="items"><thead><tr><th>#</th><th>{{item_desc_label}}</th><th>{{qty_label}}</th><th>{{unit_label}}</th><th>{{price_label}}</th><th>{{discount_label}}</th><th>{{tax_label}} %</th><th>{{tax_label}}</th><th>{{total_label}}</th></tr></thead><tbody>{{ITEMS_ROWS}}</tbody></table>
<div class="totals-wrap"><table><tr><td>{{subtotal_label}}</td><td>{{invoice.subtotal}} {{invoice.currency}}</td></tr><tr><td>{{discount_label}}</td><td>{{invoice.discount}} {{invoice.currency}}</td></tr><tr><td>{{tax_name}}</td><td>{{invoice.tax_amount}} {{invoice.currency}}</td></tr><tr class="grand"><td>{{grand_total_label}}</td><td>{{invoice.total}} {{invoice.currency}}</td></tr></table></div>
<div class="footer"><p>{{invoice.notes}}</p><div class="qr-box">{{QR_CODE}}</div></div>
</div>');

-- 6.3 Receipt Voucher (سند قبض)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr,
variables, template_css, template_html) VALUES
(NULL, 'receipt_voucher', 'receipt', 'سند قبض', 'Receipt Voucher', true, true, 3, true,
'[{"key":"voucher.number","label_ar":"رقم السند","label_en":"Voucher No","type":"text","group":"document"},
{"key":"voucher.date","label_ar":"التاريخ","label_en":"Date","type":"date","group":"document"},
{"key":"voucher.amount","label_ar":"المبلغ","label_en":"Amount","type":"number","group":"totals"},
{"key":"voucher.amount_words","label_ar":"المبلغ كتابة","label_en":"Amount in Words","type":"text","group":"totals"},
{"key":"voucher.currency","label_ar":"العملة","label_en":"Currency","type":"text","group":"document"},
{"key":"voucher.description","label_ar":"البيان","label_en":"Description","type":"text","group":"document"},
{"key":"voucher.payment_method","label_ar":"طريقة الدفع","label_en":"Payment Method","type":"text","group":"document"},
{"key":"party.name","label_ar":"اسم الطرف","label_en":"Party Name","type":"text","group":"party"}]'::jsonb,
'body{font-family:{{font_family}};direction:{{direction}};font-size:12px}.v{width:170mm;margin:0 auto;border:2px solid #2d6a4f;border-radius:8px;padding:16px}.v-h{display:flex;justify-content:space-between;border-bottom:2px solid #2d6a4f;padding-bottom:10px;margin-bottom:12px}.v-h h2{color:#2d6a4f;font-size:20px}.v-no{background:#2d6a4f;color:#fff;padding:4px 16px;border-radius:4px;font-size:14px}.v-row{display:flex;margin-bottom:8px}.v-row .lbl{min-width:100px;color:#555}.v-row .val{flex:1;border-bottom:1px dotted #999;padding:0 8px;font-weight:bold}.v-amt{background:#f0f7f3;border:2px solid #2d6a4f;border-radius:6px;padding:12px;text-align:center;margin:16px 0}.v-amt .num{font-size:24px;color:#2d6a4f;font-weight:bold}.v-amt .words{font-size:12px;color:#555;margin-top:4px}.v-ft{display:flex;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid #ddd}.sig{text-align:center;min-width:80px}.sig .line{border-top:1px solid #333;margin-top:40px;padding-top:4px;font-size:10px}.qr-box{text-align:center;margin-top:12px}.qr-box img{width:60px;height:60px}',
'<div class="v">
<div class="v-h"><div><h2>{{doc_title}}</h2></div><div><div class="v-no">{{voucher.number}}</div><p style="text-align:center;margin-top:4px">{{voucher.date}}</p></div></div>
<div><div class="v-row"><span class="lbl">{{received_from_label}}:</span><span class="val">{{party.name}}</span></div>
<div class="v-row"><span class="lbl">{{amount_words_label}}:</span><span class="val">{{voucher.amount_words}}</span></div>
<div class="v-row"><span class="lbl">{{for_label}}:</span><span class="val">{{voucher.description}}</span></div>
<div class="v-row"><span class="lbl">{{payment_method_label}}:</span><span class="val">{{voucher.payment_method}}</span></div></div>
<div class="v-amt"><div class="num">{{voucher.amount}} {{voucher.currency}}</div><div class="words">{{voucher.amount_words}}</div></div>
<div class="qr-box">{{QR_CODE}}</div>
<div class="v-ft"><div class="sig">{{STAMP}}<div class="line">{{stamp_label}}</div></div><div class="sig"><div class="line">{{receiver_label}}</div></div><div class="sig">{{SIGNATURE}}<div class="line">{{accountant_label}}</div></div><div class="sig"><div class="line">{{manager_label}}</div></div></div>
</div>');

-- 6.4 Payment Voucher (سند صرف)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr,
variables, template_css, template_html) VALUES
(NULL, 'payment_voucher', 'receipt', 'سند صرف', 'Payment Voucher', true, true, 4, true,
'[{"key":"voucher.number","label_ar":"رقم السند","label_en":"Voucher No","type":"text","group":"document"},
{"key":"voucher.date","label_ar":"التاريخ","label_en":"Date","type":"date","group":"document"},
{"key":"voucher.amount","label_ar":"المبلغ","label_en":"Amount","type":"number","group":"totals"},
{"key":"voucher.amount_words","label_ar":"المبلغ كتابة","label_en":"Amount in Words","type":"text","group":"totals"},
{"key":"voucher.description","label_ar":"البيان","label_en":"Description","type":"text","group":"document"},
{"key":"party.name","label_ar":"اسم المستفيد","label_en":"Beneficiary","type":"text","group":"party"}]'::jsonb,
'body{font-family:{{font_family}};direction:{{direction}};font-size:12px}.v{width:170mm;margin:0 auto;border:2px solid #c0392b;border-radius:8px;padding:16px}.v-h{display:flex;justify-content:space-between;border-bottom:2px solid #c0392b;padding-bottom:10px}.v-h h2{color:#c0392b;font-size:20px}.v-no{background:#c0392b;color:#fff;padding:4px 16px;border-radius:4px}.v-row{display:flex;margin-bottom:8px}.v-row .lbl{min-width:100px;color:#555}.v-row .val{flex:1;border-bottom:1px dotted #999;padding:0 8px;font-weight:bold}.v-amt{background:#fdf2f2;border:2px solid #c0392b;border-radius:6px;padding:12px;text-align:center;margin:16px 0}.v-amt .num{font-size:24px;color:#c0392b;font-weight:bold}.v-ft{display:flex;justify-content:space-between;margin-top:16px;border-top:1px solid #ddd;padding-top:12px}.sig{text-align:center;min-width:80px}.sig .line{border-top:1px solid #333;margin-top:40px;padding-top:4px;font-size:10px}.qr-box{text-align:center;margin-top:12px}.qr-box img{width:60px;height:60px}',
'<div class="v">
<div class="v-h"><div><h2>{{doc_title}}</h2></div><div><div class="v-no">{{voucher.number}}</div><p style="text-align:center;margin-top:4px">{{voucher.date}}</p></div></div>
<div><div class="v-row"><span class="lbl">{{paid_to_label}}:</span><span class="val">{{party.name}}</span></div>
<div class="v-row"><span class="lbl">{{amount_words_label}}:</span><span class="val">{{voucher.amount_words}}</span></div>
<div class="v-row"><span class="lbl">{{for_label}}:</span><span class="val">{{voucher.description}}</span></div>
<div class="v-row"><span class="lbl">{{payment_method_label}}:</span><span class="val">{{voucher.payment_method}}</span></div></div>
<div class="v-amt"><div class="num">{{voucher.amount}} {{voucher.currency}}</div><div class="words">{{voucher.amount_words}}</div></div>
<div class="qr-box">{{QR_CODE}}</div>
<div class="v-ft"><div class="sig">{{STAMP}}<div class="line">{{stamp_label}}</div></div><div class="sig"><div class="line">{{receiver_label}}</div></div><div class="sig">{{SIGNATURE}}<div class="line">{{accountant_label}}</div></div><div class="sig"><div class="line">{{manager_label}}</div></div></div>
</div>');

-- 6.5 Account Statement (كشف حساب)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr,
variables, template_css, template_html) VALUES
(NULL, 'account_statement', 'report', 'كشف حساب', 'Account Statement', true, true, 5, true,
'[{"key":"account.name","label_ar":"اسم الحساب","label_en":"Account Name","type":"text","group":"document"},
{"key":"account.code","label_ar":"رمز الحساب","label_en":"Account Code","type":"text","group":"document"},
{"key":"period.from","label_ar":"من تاريخ","label_en":"From","type":"date","group":"document"},
{"key":"period.to","label_ar":"إلى تاريخ","label_en":"To","type":"date","group":"document"},
{"key":"account.opening","label_ar":"رصيد افتتاحي","label_en":"Opening Balance","type":"number","group":"totals"},
{"key":"account.closing","label_ar":"رصيد ختامي","label_en":"Closing Balance","type":"number","group":"totals"},
{"key":"account.total_debit","label_ar":"مجموع المدين","label_en":"Total Debit","type":"number","group":"totals"},
{"key":"account.total_credit","label_ar":"مجموع الدائن","label_en":"Total Credit","type":"number","group":"totals"},
{"key":"account.entries","label_ar":"الحركات","label_en":"Entries","type":"table","group":"items"}]'::jsonb,
'body{font-family:{{font_family}};direction:{{direction}};font-size:11px;color:#1a1a2e}.page{width:190mm;margin:0 auto;padding:10mm}.header{border-bottom:3px solid #34495e;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between}.header h1{color:#34495e;font-size:18px}.title{text-align:center;margin:14px 0}.title h2{color:#34495e;font-size:16px}.info-bar{display:flex;justify-content:space-between;background:#f5f6fa;padding:10px 14px;border-radius:6px;margin-bottom:14px}.info-bar span{font-size:11px}table.ledger{width:100%;border-collapse:collapse}table.ledger th{background:#34495e;color:#fff;padding:6px 8px;font-size:10px}table.ledger td{padding:5px 8px;border-bottom:1px solid #eee;font-size:10px}table.ledger tr:nth-child(even){background:#f9f9fb}.summary{margin-top:12px;display:flex;gap:12px}.summary .s-box{background:#f5f6fa;border-radius:6px;padding:10px 16px;text-align:center;flex:1}.summary .s-box .num{font-size:16px;font-weight:bold;color:#34495e}.summary .s-box .lbl{font-size:10px;color:#777}.qr-box{text-align:center;margin-top:12px}.qr-box img{width:60px;height:60px}@media print{.page{width:100%;padding:0}}',
'<div class="page">
<div class="header"><div><h1>{{company.name}}</h1><p>{{company.address}}</p></div><div class="logo"><img src="{{company.logo}}" alt=""/></div></div>
<div class="title"><h2>{{doc_title}}</h2></div>
<div class="info-bar"><span>{{account_label}}: <strong>{{account.name}}</strong> ({{account.code}})</span><span>{{from_label}}: {{period.from}} {{to_label}}: {{period.to}}</span></div>
<div class="summary">
<div class="s-box"><div class="num">{{account.opening}}</div><div class="lbl">{{opening_balance_label}}</div></div>
<div class="s-box"><div class="num">{{account.total_debit}}</div><div class="lbl">{{total_debit_label}}</div></div>
<div class="s-box"><div class="num">{{account.total_credit}}</div><div class="lbl">{{total_credit_label}}</div></div>
<div class="s-box"><div class="num" style="color:#0f3460">{{account.closing}}</div><div class="lbl">{{closing_balance_label}}</div></div>
</div>
<table class="ledger" style="margin-top:14px"><thead><tr><th>#</th><th>{{date_label}}</th><th>{{entry_no_label}}</th><th>{{description_label}}</th><th>{{debit_label}}</th><th>{{credit_label}}</th><th>{{balance_label}}</th></tr></thead><tbody>{{ENTRIES_ROWS}}</tbody></table>
<div class="qr-box">{{QR_CODE}}</div>
<div style="margin-top:16px;text-align:center;font-size:9px;color:#999">{{printed_at_label}} {{system.date}} — {{company.name}}</div>
</div>');

-- 6.6 Journal Entry (قيد يومية)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr,
variables, template_css, template_html) VALUES
(NULL, 'journal_entry', 'receipt', 'قيد يومية', 'Journal Entry', true, true, 6, true,
'[{"key":"entry.number","label_ar":"رقم القيد","label_en":"Entry No","type":"text","group":"document"},
{"key":"entry.date","label_ar":"التاريخ","label_en":"Date","type":"date","group":"document"},
{"key":"entry.description","label_ar":"البيان","label_en":"Description","type":"text","group":"document"},
{"key":"entry.total_debit","label_ar":"مجموع المدين","label_en":"Total Debit","type":"number","group":"totals"},
{"key":"entry.total_credit","label_ar":"مجموع الدائن","label_en":"Total Credit","type":"number","group":"totals"},
{"key":"entry.lines","label_ar":"سطور القيد","label_en":"Lines","type":"table","group":"items"}]'::jsonb,
'body{font-family:{{font_family}};direction:{{direction}};font-size:12px}.page{width:190mm;margin:0 auto;padding:10mm}.header{border-bottom:3px solid #2c3e50;padding-bottom:10px;display:flex;justify-content:space-between}.header h1{color:#2c3e50;font-size:18px}.title{text-align:center;margin:16px 0}.title h2{color:#2c3e50;font-size:16px;border:2px solid #2c3e50;display:inline-block;padding:6px 28px;border-radius:6px}.je-meta{display:flex;justify-content:space-between;background:#f8f9fa;padding:10px;border-radius:6px;margin-bottom:14px}table.lines{width:100%;border-collapse:collapse}table.lines th{background:#2c3e50;color:#fff;padding:8px;font-size:11px}table.lines td{padding:6px 8px;border-bottom:1px solid #eee;font-size:11px}.je-totals{display:flex;justify-content:flex-end;margin-top:12px;gap:20px}.je-totals .t-box{background:#f8f9fa;padding:10px 20px;border-radius:6px;text-align:center}.je-totals .t-box .num{font-size:16px;font-weight:bold}.qr-box{text-align:center;margin-top:12px}.qr-box img{width:60px;height:60px}@media print{.page{width:100%;padding:0}}',
'<div class="page">
<div class="header"><div><h1>{{company.name}}</h1><p>{{company.address}}</p></div><div class="logo"><img src="{{company.logo}}" alt=""/></div></div>
<div class="title"><h2>{{doc_title}}</h2></div>
<div class="je-meta"><span>{{entry_no_label}}: <strong>{{entry.number}}</strong></span><span>{{date_label}}: <strong>{{entry.date}}</strong></span></div>
<div style="margin-bottom:10px"><strong>{{description_label}}:</strong> {{entry.description}}</div>
<table class="lines"><thead><tr><th>#</th><th>{{account_code_label}}</th><th>{{account_name_label}}</th><th>{{description_label}}</th><th>{{debit_label}}</th><th>{{credit_label}}</th></tr></thead><tbody>{{LINES_ROWS}}</tbody></table>
<div class="je-totals"><div class="t-box"><div class="num">{{entry.total_debit}}</div><div style="font-size:10px;color:#777">{{total_debit_label}}</div></div><div class="t-box"><div class="num">{{entry.total_credit}}</div><div style="font-size:10px;color:#777">{{total_credit_label}}</div></div></div>
<div class="qr-box">{{QR_CODE}}</div>
<div style="margin-top:30px;display:flex;justify-content:space-between"><div class="sig" style="text-align:center"><div style="border-top:1px solid #333;margin-top:40px;padding-top:4px;font-size:10px">{{accountant_label}}</div></div><div class="sig" style="text-align:center"><div style="border-top:1px solid #333;margin-top:40px;padding-top:4px;font-size:10px">{{cfo_label}}</div></div><div class="sig" style="text-align:center"><div style="border-top:1px solid #333;margin-top:40px;padding-top:4px;font-size:10px">{{ceo_label}}</div></div></div>
</div>');

-- 6.7 Price Quote (عرض سعر)
INSERT INTO print_templates (tenant_id, doc_type, category, name_ar, name_en, is_system, is_default, sort_order, include_qr,
variables, template_css, template_html) VALUES
(NULL, 'price_quote', 'invoice', 'عرض سعر احترافي', 'Professional Price Quote', true, true, 7, true,
'[{"key":"company.name","label_ar":"اسم الشركة","label_en":"Company Name","type":"text","group":"company"},
{"key":"customer.name","label_ar":"اسم العميل","label_en":"Customer Name","type":"text","group":"party"},
{"key":"customer.phone","label_ar":"هاتف العميل","label_en":"Customer Phone","type":"text","group":"party"},
{"key":"customer.address","label_ar":"عنوان العميل","label_en":"Customer Address","type":"text","group":"party"},
{"key":"quote.number","label_ar":"رقم العرض","label_en":"Quote No","type":"text","group":"document"},
{"key":"quote.date","label_ar":"التاريخ","label_en":"Date","type":"date","group":"document"},
{"key":"quote.valid_until","label_ar":"صالح حتى","label_en":"Valid Until","type":"date","group":"document"},
{"key":"quote.subtotal","label_ar":"المجموع الفرعي","label_en":"Subtotal","type":"number","group":"totals"},
{"key":"quote.tax_amount","label_ar":"الضريبة","label_en":"Tax","type":"number","group":"totals"},
{"key":"quote.total","label_ar":"الإجمالي","label_en":"Total","type":"number","group":"totals"},
{"key":"quote.currency","label_ar":"العملة","label_en":"Currency","type":"text","group":"document"},
{"key":"quote.notes","label_ar":"ملاحظات","label_en":"Notes","type":"text","group":"document"},
{"key":"quote.terms","label_ar":"الشروط","label_en":"Terms","type":"text","group":"document"},
{"key":"quote.items","label_ar":"البنود","label_en":"Items","type":"table","group":"items"}]'::jsonb,
'*{margin:0;padding:0;box-sizing:border-box}body{font-family:{{font_family}};direction:{{direction}};color:#1a1a2e;font-size:12px}.page{width:190mm;margin:0 auto;padding:10mm}.header{display:flex;justify-content:space-between;border-bottom:3px solid #6c5ce7;padding-bottom:12px;margin-bottom:16px}.header .co-info h1{font-size:20px;color:#6c5ce7}.header .co-info p{font-size:10px;color:#555}.title{text-align:center;margin:16px 0}.title h2{font-size:18px;color:#6c5ce7;border:2px solid #6c5ce7;display:inline-block;padding:6px 32px;border-radius:6px}.valid-bar{background:#f0edff;padding:8px 14px;border-radius:4px;margin-bottom:14px;font-size:11px;color:#6c5ce7}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}.box{background:#f8f7ff;border:1px solid #e0ddff;border-radius:6px;padding:10px 14px}.box h4{font-size:11px;color:#6c5ce7;margin-bottom:6px}table.items{width:100%;border-collapse:collapse;margin:16px 0}table.items th{background:#6c5ce7;color:#fff;padding:8px;font-size:11px}table.items td{padding:7px;border-bottom:1px solid #eee;font-size:11px;text-align:center}.totals-wrap table{width:260px}.totals-wrap td{padding:5px 12px}.totals-wrap tr.grand{background:#6c5ce7;color:#fff;font-weight:bold}.footer{margin-top:20px;border-top:2px solid #6c5ce7;padding-top:12px}.qr-box{text-align:center;margin-top:12px}.qr-box img{width:80px;height:80px}.terms-block{background:#f8f7ff;border-radius:6px;padding:10px;margin-top:12px;font-size:10px;color:#555}@media print{.page{width:100%;padding:0}}',
'<div class="page">
<div class="header"><div class="logo"><img src="{{company.logo}}" alt=""/></div><div class="co-info"><h1>{{company.name}}</h1><p>{{company.address}}</p><p>{{company.phone}} | {{company.email}}</p><p>{{tax_id_label}}: {{company.tax_id}}</p></div></div>
<div class="title"><h2>{{doc_title}}</h2></div>
<div class="valid-bar">⏳ {{valid_until_label}}: <strong>{{quote.valid_until}}</strong></div>
<div class="grid2">
<div class="box"><h4>{{party_section_title}}</h4><p><strong>{{customer.name}}</strong></p><p>{{customer.address}}</p><p>{{customer.phone}}</p></div>
<div class="box"><h4>{{doc_info_title}}</h4><p>{{quote_number_label}}: <strong>{{quote.number}}</strong></p><p>{{issue_date_label}}: <strong>{{quote.date}}</strong></p><p>{{currency_label}}: {{quote.currency}}</p></div>
</div>
<table class="items"><thead><tr><th>#</th><th>{{item_desc_label}}</th><th>{{qty_label}}</th><th>{{unit_label}}</th><th>{{price_label}}</th><th>{{discount_label}}</th><th>{{tax_label}} %</th><th>{{total_label}}</th></tr></thead><tbody>{{ITEMS_ROWS}}</tbody></table>
<div class="totals-wrap"><table><tr><td>{{subtotal_label}}</td><td>{{quote.subtotal}} {{quote.currency}}</td></tr><tr><td>{{tax_name}}</td><td>{{quote.tax_amount}} {{quote.currency}}</td></tr><tr class="grand"><td>{{grand_total_label}}</td><td>{{quote.total}} {{quote.currency}}</td></tr></table></div>
<div class="terms-block"><strong>{{notes_label}}:</strong> {{quote.notes}}<br/><strong>{{terms_label}}:</strong> {{quote.terms}}</div>
<div class="footer"><div class="qr-box">{{QR_CODE}}</div></div>
</div>');
