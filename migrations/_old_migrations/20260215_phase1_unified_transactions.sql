-- ═══════════════════════════════════════════════════════════════════════════
-- 🏗️ المرحلة 1: إنشاء النظام الموحد للمعاملات
-- ═══════════════════════════════════════════════════════════════════════════
-- التاريخ: 2026-02-15
-- الوصف: إنشاء الجداول والـ Functions للنظام الجديد
-- الفلسفة: لا حذف — لا تعديل على القديم — إنشاء بالتوازي
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  1. purchase_transactions — دورة المشتريات الموحدة                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS purchase_transactions (
    -- ═══ المفاتيح الأساسية ═══
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    company_id      UUID NOT NULL REFERENCES companies(id),
    branch_id       UUID REFERENCES branches(id),

    -- ═══ المرحلة الحالية ═══
    stage           TEXT NOT NULL DEFAULT 'draft'
                    CHECK (stage IN (
                        'draft',           -- مسودة (AutoSave)
                        'quotation',       -- عرض سعر شراء
                        'order',           -- أمر شراء
                        'approved',        -- أمر شراء معتمد
                        'receipt',         -- تم الاستلام
                        'invoice',         -- فاتورة مشتريات
                        'posted',          -- مرحّلة
                        'partial_paid',    -- مدفوعة جزئياً
                        'paid',            -- مدفوعة بالكامل
                        'cancelled'        -- ملغاة
                    )),

    -- ═══ أرقام المستند (رقم جديد لكل مرحلة) ═══
    draft_no        TEXT,
    quotation_no    TEXT,
    order_no        TEXT,
    receipt_no      TEXT,
    invoice_no      TEXT,

    -- ═══ الطرف المقابل ═══
    supplier_id     UUID REFERENCES suppliers(id),
    supplier_name   TEXT,

    -- ═══ التواريخ ═══
    doc_date        DATE DEFAULT CURRENT_DATE,
    quotation_date  DATE,
    order_date      DATE,
    approval_date   DATE,
    receipt_date    DATE,
    invoice_date    DATE,
    due_date        DATE,

    -- ═══ الشحن والمستودع ═══
    warehouse_id    UUID REFERENCES warehouses(id),
    shipment_id     UUID,
    receipt_mode    TEXT DEFAULT 'direct' CHECK (receipt_mode IN ('direct', 'international')),

    -- ═══ المالية ═══
    currency        TEXT DEFAULT 'SAR',
    exchange_rate   DECIMAL(18,6) DEFAULT 1,
    subtotal        DECIMAL(18,2) DEFAULT 0,
    discount_amount DECIMAL(18,2) DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_amount      DECIMAL(18,2) DEFAULT 0,
    expenses_total  DECIMAL(18,2) DEFAULT 0,
    total_amount    DECIMAL(18,2) DEFAULT 0,

    -- ═══ الدفعات ═══
    paid_amount     DECIMAL(18,2) DEFAULT 0,
    balance         DECIMAL(18,2) DEFAULT 0,
    payment_terms_days INTEGER DEFAULT 30,

    -- ═══ بيانات المورد الخارجية ═══
    supplier_invoice_number TEXT,
    supplier_invoice_date   DATE,

    -- ═══ المحاسبة ═══
    journal_entry_id UUID REFERENCES journal_entries(id),
    is_posted       BOOLEAN DEFAULT false,

    -- ═══ 👤 تتبع المستخدمين لكل مرحلة ═══
    created_by      UUID REFERENCES auth.users(id),
    created_by_name TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    quoted_by       UUID REFERENCES auth.users(id),
    quoted_by_name  TEXT,
    quoted_at       TIMESTAMPTZ,

    ordered_by      UUID REFERENCES auth.users(id),
    ordered_by_name TEXT,
    ordered_at      TIMESTAMPTZ,

    approved_by     UUID REFERENCES auth.users(id),
    approved_by_name TEXT,
    approved_at     TIMESTAMPTZ,
    approval_notes  TEXT,

    received_by     UUID REFERENCES auth.users(id),
    received_by_name TEXT,
    received_at     TIMESTAMPTZ,

    invoiced_by     UUID REFERENCES auth.users(id),
    invoiced_by_name TEXT,
    invoiced_at     TIMESTAMPTZ,

    posted_by       UUID REFERENCES auth.users(id),
    posted_by_name  TEXT,
    posted_at       TIMESTAMPTZ,

    cancelled_by    UUID REFERENCES auth.users(id),
    cancelled_by_name TEXT,
    cancelled_at    TIMESTAMPTZ,
    cancellation_reason TEXT,

    updated_by      UUID REFERENCES auth.users(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    -- ═══ بيانات إضافية ═══
    notes           TEXT,
    supplier_notes  TEXT,
    internal_notes  TEXT,
    expenses        JSONB DEFAULT '[]',
    attachments     JSONB DEFAULT '[]',
    tags            TEXT[],

    -- ═══ حالات مساعدة ═══
    confirmation_status TEXT DEFAULT 'pending' CHECK (confirmation_status IN ('pending', 'confirmed', 'rejected')),
    is_active       BOOLEAN DEFAULT true,
    is_locked       BOOLEAN DEFAULT false,

    -- ═══ 🔒 Optimistic Locking ═══
    version         INTEGER DEFAULT 1,

    -- ═══ 🖨️ تتبع الطباعة ═══
    printed_count    INTEGER DEFAULT 0,
    last_printed_at  TIMESTAMPTZ,
    last_printed_by  UUID REFERENCES auth.users(id),

    -- ═══ ⏰ تتبع التذكيرات ═══
    reminder_count        INTEGER DEFAULT 0,
    last_reminder_sent_at TIMESTAMPTZ,

    -- ═══ 🔄 المرتجعات ═══
    original_transaction_id UUID REFERENCES purchase_transactions(id),
    is_return       BOOLEAN DEFAULT false,

    -- ═══ المصدر ═══
    source_type     TEXT,
    source_id       UUID
);

CREATE INDEX IF NOT EXISTS idx_pt_tenant_company ON purchase_transactions(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_pt_stage ON purchase_transactions(company_id, stage);
CREATE INDEX IF NOT EXISTS idx_pt_supplier ON purchase_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pt_dates ON purchase_transactions(doc_date, invoice_date);
CREATE INDEX IF NOT EXISTS idx_pt_invoice_no ON purchase_transactions(invoice_no) WHERE invoice_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pt_order_no ON purchase_transactions(order_no) WHERE order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pt_journal ON purchase_transactions(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pt_created_by ON purchase_transactions(created_by);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  2. purchase_transaction_items — بنود المشتريات                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS purchase_transaction_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES purchase_transactions(id) ON DELETE CASCADE,

    line_number      INTEGER NOT NULL DEFAULT 1,

    product_id       UUID,
    material_id      UUID,
    item_code        TEXT,
    description      TEXT,
    description_ar   TEXT,

    quantity         DECIMAL(18,4) NOT NULL DEFAULT 0,
    received_qty     DECIMAL(18,4) DEFAULT 0,
    returned_qty     DECIMAL(18,4) DEFAULT 0,
    unit             TEXT DEFAULT 'piece',

    unit_price       DECIMAL(18,4) NOT NULL DEFAULT 0,
    discount_amount  DECIMAL(18,2) DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_rate         DECIMAL(5,2) DEFAULT 0,
    tax_amount       DECIMAL(18,2) DEFAULT 0,
    subtotal         DECIMAL(18,2) DEFAULT 0,
    total            DECIMAL(18,2) DEFAULT 0,

    color_id         UUID,
    color_name       TEXT,
    roll_id          UUID,
    roll_code        TEXT,
    rolls_count      INTEGER,

    warehouse_id     UUID,

    cost_price       DECIMAL(18,4),
    landed_cost      DECIMAL(18,4),

    notes            TEXT,

    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pti_transaction ON purchase_transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_pti_product ON purchase_transaction_items(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pti_material ON purchase_transaction_items(material_id) WHERE material_id IS NOT NULL;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  3. sales_transactions — دورة المبيعات الموحدة                        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS sales_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    company_id      UUID NOT NULL REFERENCES companies(id),
    branch_id       UUID REFERENCES branches(id),

    stage           TEXT NOT NULL DEFAULT 'draft'
                    CHECK (stage IN (
                        'draft',
                        'quotation',
                        'reservation',
                        'order',
                        'delivery',
                        'invoice',
                        'posted',
                        'partial_paid',
                        'paid',
                        'cancelled'
                    )),

    draft_no        TEXT,
    quotation_no    TEXT,
    reservation_no  TEXT,
    order_no        TEXT,
    delivery_no     TEXT,
    invoice_no      TEXT,

    customer_id     UUID REFERENCES customers(id),
    customer_name   TEXT,

    salesperson_id  UUID REFERENCES auth.users(id),
    salesperson_name TEXT,

    doc_date        DATE DEFAULT CURRENT_DATE,
    quotation_date  DATE,
    quotation_valid_until DATE,
    reservation_date DATE,
    order_date      DATE,
    delivery_date   DATE,
    invoice_date    DATE,
    due_date        DATE,

    warehouse_id    UUID REFERENCES warehouses(id),
    shipping_method TEXT,
    shipping_address TEXT,
    tracking_number TEXT,

    currency        TEXT DEFAULT 'SAR',
    exchange_rate   DECIMAL(18,6) DEFAULT 1,
    subtotal        DECIMAL(18,2) DEFAULT 0,
    discount_amount DECIMAL(18,2) DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_amount      DECIMAL(18,2) DEFAULT 0,
    total_amount    DECIMAL(18,2) DEFAULT 0,

    paid_amount     DECIMAL(18,2) DEFAULT 0,
    balance         DECIMAL(18,2) DEFAULT 0,
    payment_terms_days INTEGER DEFAULT 30,

    is_pos          BOOLEAN DEFAULT false,
    pos_session_id  UUID,

    journal_entry_id UUID REFERENCES journal_entries(id),
    cost_entry_id   UUID REFERENCES journal_entries(id),
    is_posted       BOOLEAN DEFAULT false,

    -- ═══ 👤 تتبع المستخدمين لكل مرحلة ═══
    created_by      UUID REFERENCES auth.users(id),
    created_by_name TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    quoted_by       UUID REFERENCES auth.users(id),
    quoted_by_name  TEXT,
    quoted_at       TIMESTAMPTZ,

    reserved_by     UUID REFERENCES auth.users(id),
    reserved_by_name TEXT,
    reserved_at     TIMESTAMPTZ,

    ordered_by      UUID REFERENCES auth.users(id),
    ordered_by_name TEXT,
    ordered_at      TIMESTAMPTZ,

    delivered_by    UUID REFERENCES auth.users(id),
    delivered_by_name TEXT,
    delivered_at    TIMESTAMPTZ,

    invoiced_by     UUID REFERENCES auth.users(id),
    invoiced_by_name TEXT,
    invoiced_at     TIMESTAMPTZ,

    posted_by       UUID REFERENCES auth.users(id),
    posted_by_name  TEXT,
    posted_at       TIMESTAMPTZ,

    cancelled_by    UUID REFERENCES auth.users(id),
    cancelled_by_name TEXT,
    cancelled_at    TIMESTAMPTZ,
    cancellation_reason TEXT,

    updated_by      UUID REFERENCES auth.users(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    notes           TEXT,
    internal_notes  TEXT,
    attachments     JSONB DEFAULT '[]',
    tags            TEXT[],

    confirmation_status TEXT DEFAULT 'pending',
    is_active       BOOLEAN DEFAULT true,
    is_locked       BOOLEAN DEFAULT false,

    -- ═══ 🔒 Optimistic Locking ═══
    version         INTEGER DEFAULT 1,

    -- ═══ 🖨️ تتبع الطباعة ═══
    printed_count    INTEGER DEFAULT 0,
    last_printed_at  TIMESTAMPTZ,
    last_printed_by  UUID REFERENCES auth.users(id),

    -- ═══ ⏰ تتبع التذكيرات ═══
    reminder_count        INTEGER DEFAULT 0,
    last_reminder_sent_at TIMESTAMPTZ,

    -- ═══ 🔄 المرتجعات ═══
    original_transaction_id UUID REFERENCES sales_transactions(id),
    is_return       BOOLEAN DEFAULT false,

    source_type     TEXT,
    source_id       UUID
);

CREATE INDEX IF NOT EXISTS idx_st_tenant_company ON sales_transactions(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_st_stage ON sales_transactions(company_id, stage);
CREATE INDEX IF NOT EXISTS idx_st_customer ON sales_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_st_salesperson ON sales_transactions(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_st_dates ON sales_transactions(doc_date, invoice_date);
CREATE INDEX IF NOT EXISTS idx_st_invoice_no ON sales_transactions(invoice_no) WHERE invoice_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_st_order_no ON sales_transactions(order_no) WHERE order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_st_pos ON sales_transactions(is_pos) WHERE is_pos = true;
CREATE INDEX IF NOT EXISTS idx_st_created_by ON sales_transactions(created_by);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  4. sales_transaction_items — بنود المبيعات                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS sales_transaction_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,

    line_number      INTEGER NOT NULL DEFAULT 1,

    product_id       UUID,
    material_id      UUID,
    item_code        TEXT,
    description      TEXT,
    description_ar   TEXT,

    quantity         DECIMAL(18,4) NOT NULL DEFAULT 0,
    delivered_qty    DECIMAL(18,4) DEFAULT 0,
    returned_qty     DECIMAL(18,4) DEFAULT 0,
    unit             TEXT DEFAULT 'piece',

    unit_price       DECIMAL(18,4) NOT NULL DEFAULT 0,
    discount_amount  DECIMAL(18,2) DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    tax_rate         DECIMAL(5,2) DEFAULT 0,
    tax_amount       DECIMAL(18,2) DEFAULT 0,
    subtotal         DECIMAL(18,2) DEFAULT 0,
    total            DECIMAL(18,2) DEFAULT 0,

    color_id         UUID,
    color_name       TEXT,
    roll_id          UUID,
    roll_code        TEXT,
    rolls_count      INTEGER,

    warehouse_id     UUID,

    cost_price       DECIMAL(18,4),

    notes            TEXT,

    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sti_transaction ON sales_transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_sti_product ON sales_transaction_items(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sti_material ON sales_transaction_items(material_id) WHERE material_id IS NOT NULL;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  5. transaction_stage_log — سجل المراحل                               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS transaction_stage_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'sale')),
    transaction_id  UUID NOT NULL,

    from_stage      TEXT NOT NULL,
    to_stage        TEXT NOT NULL,

    generated_number TEXT,

    notes           TEXT,
    metadata        JSONB DEFAULT '{}',

    performed_by      UUID REFERENCES auth.users(id),
    performed_by_name TEXT,
    performed_at      TIMESTAMPTZ DEFAULT NOW(),
    ip_address        TEXT,
    user_agent        TEXT
);

CREATE INDEX IF NOT EXISTS idx_tsl_transaction ON transaction_stage_log(transaction_type, transaction_id);
CREATE INDEX IF NOT EXISTS idx_tsl_user ON transaction_stage_log(performed_by);
CREATE INDEX IF NOT EXISTS idx_tsl_date ON transaction_stage_log(performed_at);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  6. document_sequences — تسلسل الترقيم                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS document_sequences (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    company_id      UUID NOT NULL REFERENCES companies(id),

    doc_type        TEXT NOT NULL,
    stage           TEXT NOT NULL,
    year            INTEGER NOT NULL,

    prefix          TEXT NOT NULL,
    next_number     INTEGER DEFAULT 1,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_doc_sequence UNIQUE (tenant_id, company_id, doc_type, stage, year)
);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  7. Functions — الدوال المساعدة                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 7.1 التحقق من صلاحية التحويل
CREATE OR REPLACE FUNCTION is_valid_stage_transition(
    p_type TEXT,
    p_from TEXT,
    p_to TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    IF p_type = 'purchase' THEN
        RETURN (p_from, p_to) IN (
            ('draft', 'quotation'),
            ('draft', 'order'),
            ('draft', 'invoice'),
            ('quotation', 'order'),
            ('quotation', 'invoice'),
            ('order', 'approved'),
            ('approved', 'receipt'),
            ('approved', 'invoice'),
            ('receipt', 'invoice'),
            ('invoice', 'posted'),
            ('posted', 'partial_paid'),
            ('posted', 'paid'),
            ('partial_paid', 'paid'),
            ('draft', 'cancelled'),
            ('quotation', 'cancelled'),
            ('order', 'cancelled'),
            ('approved', 'cancelled'),
            ('receipt', 'cancelled'),
            ('invoice', 'cancelled'),
            ('cancelled', 'draft')
        );
    END IF;

    IF p_type = 'sale' THEN
        RETURN (p_from, p_to) IN (
            ('draft', 'quotation'),
            ('draft', 'order'),
            ('draft', 'invoice'),
            ('quotation', 'reservation'),
            ('quotation', 'order'),
            ('reservation', 'order'),
            ('order', 'delivery'),
            ('order', 'invoice'),
            ('delivery', 'invoice'),
            ('invoice', 'posted'),
            ('posted', 'partial_paid'),
            ('posted', 'paid'),
            ('partial_paid', 'paid'),
            ('draft', 'cancelled'),
            ('quotation', 'cancelled'),
            ('reservation', 'cancelled'),
            ('order', 'cancelled'),
            ('delivery', 'cancelled'),
            ('invoice', 'cancelled'),
            ('cancelled', 'draft')
        );
    END IF;

    RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- 7.2 توليد رقم المرحلة
CREATE OR REPLACE FUNCTION generate_stage_number(
    p_tenant_id UUID,
    p_company_id UUID,
    p_doc_type TEXT,
    p_stage TEXT
) RETURNS TEXT AS $$
DECLARE
    v_prefix TEXT;
    v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE);
    v_next INTEGER;
BEGIN
    v_prefix := CASE
        WHEN p_doc_type = 'purchase' AND p_stage = 'quotation' THEN 'PQ'
        WHEN p_doc_type = 'purchase' AND p_stage = 'order' THEN 'PO'
        WHEN p_doc_type = 'purchase' AND p_stage = 'receipt' THEN 'PR'
        WHEN p_doc_type = 'purchase' AND p_stage = 'invoice' THEN 'PI'
        WHEN p_doc_type = 'sale' AND p_stage = 'quotation' THEN 'SQ'
        WHEN p_doc_type = 'sale' AND p_stage = 'reservation' THEN 'SR'
        WHEN p_doc_type = 'sale' AND p_stage = 'order' THEN 'SO'
        WHEN p_doc_type = 'sale' AND p_stage = 'delivery' THEN 'SD'
        WHEN p_doc_type = 'sale' AND p_stage = 'invoice' THEN 'SI'
        ELSE 'DOC'
    END;

    INSERT INTO document_sequences (tenant_id, company_id, doc_type, stage, year, prefix, next_number)
    VALUES (p_tenant_id, p_company_id, p_doc_type, p_stage, v_year, v_prefix, 1)
    ON CONFLICT (tenant_id, company_id, doc_type, stage, year) DO NOTHING;

    UPDATE document_sequences
    SET next_number = next_number + 1, updated_at = NOW()
    WHERE tenant_id = p_tenant_id
      AND company_id = p_company_id
      AND doc_type = p_doc_type
      AND stage = p_stage
      AND year = v_year
    RETURNING prefix, next_number - 1 INTO v_prefix, v_next;

    RETURN v_prefix || '-' || v_year || '-' || LPAD(v_next::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;


-- 7.3 تحويل المرحلة (الـ Function الرئيسية)
CREATE OR REPLACE FUNCTION advance_transaction_stage(
    p_type          TEXT,
    p_transaction_id UUID,
    p_new_stage     TEXT,
    p_user_id       UUID,
    p_user_name     TEXT DEFAULT NULL,
    p_notes         TEXT DEFAULT NULL,
    p_cancellation_reason TEXT DEFAULT NULL,
    p_ip_address    TEXT DEFAULT NULL,
    p_user_agent    TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_current_stage TEXT;
    v_company_id UUID;
    v_tenant_id UUID;
    v_generated_no TEXT;
    v_number_field TEXT;
    v_date_field TEXT;
    v_user_field TEXT;
    v_user_name_field TEXT;
    v_at_field TEXT;
    v_sql TEXT;
BEGIN
    -- 1. قفل السجل وقراءة المرحلة الحالية
    IF p_type = 'purchase' THEN
        SELECT stage, company_id, tenant_id
        INTO v_current_stage, v_company_id, v_tenant_id
        FROM purchase_transactions
        WHERE id = p_transaction_id
        FOR UPDATE;
    ELSE
        SELECT stage, company_id, tenant_id
        INTO v_current_stage, v_company_id, v_tenant_id
        FROM sales_transactions
        WHERE id = p_transaction_id
        FOR UPDATE;
    END IF;

    IF v_current_stage IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'المعاملة غير موجودة');
    END IF;

    -- 2. التحقق من صلاحية التحويل
    IF NOT is_valid_stage_transition(p_type, v_current_stage, p_new_stage) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('تحويل غير مسموح: %s → %s', v_current_stage, p_new_stage)
        );
    END IF;

    -- 3. تحديد حقول المستخدم لهذه المرحلة
    v_user_field := CASE p_new_stage
        WHEN 'quotation' THEN 'quoted_by'
        WHEN 'reservation' THEN 'reserved_by'
        WHEN 'order' THEN 'ordered_by'
        WHEN 'approved' THEN 'approved_by'
        WHEN 'receipt' THEN 'received_by'
        WHEN 'delivery' THEN 'delivered_by'
        WHEN 'invoice' THEN 'invoiced_by'
        WHEN 'posted' THEN 'posted_by'
        WHEN 'cancelled' THEN 'cancelled_by'
        ELSE NULL
    END;

    v_user_name_field := CASE WHEN v_user_field IS NOT NULL THEN v_user_field || '_name' ELSE NULL END;

    v_at_field := CASE p_new_stage
        WHEN 'quotation' THEN 'quoted_at'
        WHEN 'reservation' THEN 'reserved_at'
        WHEN 'order' THEN 'ordered_at'
        WHEN 'approved' THEN 'approved_at'
        WHEN 'receipt' THEN 'received_at'
        WHEN 'delivery' THEN 'delivered_at'
        WHEN 'invoice' THEN 'invoiced_at'
        WHEN 'posted' THEN 'posted_at'
        WHEN 'cancelled' THEN 'cancelled_at'
        ELSE NULL
    END;

    -- 4. توليد رقم
    IF p_new_stage IN ('quotation', 'reservation', 'order', 'receipt', 'delivery', 'invoice') THEN
        v_generated_no := generate_stage_number(v_tenant_id, v_company_id, p_type, p_new_stage);
        v_number_field := p_new_stage || '_no';
        v_date_field := p_new_stage || '_date';
    END IF;

    -- 5. تحديث السجل
    IF p_type = 'purchase' THEN
        v_sql := 'UPDATE purchase_transactions SET stage = $1, updated_at = NOW(), updated_by = $2';
    ELSE
        v_sql := 'UPDATE sales_transactions SET stage = $1, updated_at = NOW(), updated_by = $2';
    END IF;

    IF v_number_field IS NOT NULL AND v_generated_no IS NOT NULL THEN
        v_sql := v_sql || format(', %I = %L', v_number_field, v_generated_no);
        v_sql := v_sql || format(', %I = CURRENT_DATE', v_date_field);
    END IF;

    IF v_user_field IS NOT NULL THEN
        v_sql := v_sql || format(', %I = %L', v_user_field, p_user_id);
        IF p_user_name IS NOT NULL AND v_user_name_field IS NOT NULL THEN
            v_sql := v_sql || format(', %I = %L', v_user_name_field, p_user_name);
        END IF;
        IF v_at_field IS NOT NULL THEN
            v_sql := v_sql || format(', %I = NOW()', v_at_field);
        END IF;
    END IF;

    IF p_new_stage = 'posted' THEN
        v_sql := v_sql || ', is_posted = true';
    END IF;

    IF p_new_stage = 'cancelled' AND p_cancellation_reason IS NOT NULL THEN
        v_sql := v_sql || format(', cancellation_reason = %L', p_cancellation_reason);
    END IF;

    IF p_new_stage = 'approved' AND p_notes IS NOT NULL THEN
        v_sql := v_sql || format(', approval_notes = %L', p_notes);
    END IF;

    v_sql := v_sql || ' WHERE id = $3';

    EXECUTE v_sql USING p_new_stage, p_user_id, p_transaction_id;

    -- 6. تسجيل في سجل المراحل
    INSERT INTO transaction_stage_log (
        transaction_type, transaction_id,
        from_stage, to_stage,
        generated_number, notes,
        performed_by, performed_by_name, ip_address, user_agent
    ) VALUES (
        p_type, p_transaction_id,
        v_current_stage, p_new_stage,
        v_generated_no, COALESCE(p_notes, p_cancellation_reason),
        p_user_id, p_user_name, p_ip_address, p_user_agent
    );

    -- 7. النتيجة
    RETURN jsonb_build_object(
        'success', true,
        'from_stage', v_current_stage,
        'to_stage', p_new_stage,
        'generated_number', v_generated_no,
        'performed_by', p_user_id,
        'performed_by_name', p_user_name
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  8. Triggers — التشغيلات التلقائية                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- حساب الرصيد تلقائياً
CREATE OR REPLACE FUNCTION calc_transaction_balance()
RETURNS TRIGGER AS $$
BEGIN
    NEW.balance := COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0);
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_calc_balance ON purchase_transactions;
CREATE TRIGGER trg_purchase_calc_balance
    BEFORE INSERT OR UPDATE ON purchase_transactions
    FOR EACH ROW EXECUTE FUNCTION calc_transaction_balance();

DROP TRIGGER IF EXISTS trg_sales_calc_balance ON sales_transactions;
CREATE TRIGGER trg_sales_calc_balance
    BEFORE INSERT OR UPDATE ON sales_transactions
    FOR EACH ROW EXECUTE FUNCTION calc_transaction_balance();

-- تحديث updated_at للبنود
CREATE OR REPLACE FUNCTION update_item_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pti_updated_at ON purchase_transaction_items;
CREATE TRIGGER trg_pti_updated_at
    BEFORE UPDATE ON purchase_transaction_items
    FOR EACH ROW EXECUTE FUNCTION update_item_timestamp();

DROP TRIGGER IF EXISTS trg_sti_updated_at ON sales_transaction_items;
CREATE TRIGGER trg_sti_updated_at
    BEFORE UPDATE ON sales_transaction_items
    FOR EACH ROW EXECUTE FUNCTION update_item_timestamp();

-- زيادة version تلقائياً عند كل UPDATE (Optimistic Locking)
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pt_increment_version ON purchase_transactions;
CREATE TRIGGER trg_pt_increment_version
    BEFORE UPDATE ON purchase_transactions
    FOR EACH ROW EXECUTE FUNCTION increment_version();

DROP TRIGGER IF EXISTS trg_st_increment_version ON sales_transactions;
CREATE TRIGGER trg_st_increment_version
    BEFORE UPDATE ON sales_transactions
    FOR EACH ROW EXECUTE FUNCTION increment_version();

-- فهارس إضافية للمرتجعات
CREATE INDEX IF NOT EXISTS idx_pt_original ON purchase_transactions(original_transaction_id) WHERE original_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_st_original ON sales_transactions(original_transaction_id) WHERE original_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pt_returns ON purchase_transactions(is_return) WHERE is_return = true;
CREATE INDEX IF NOT EXISTS idx_st_returns ON sales_transactions(is_return) WHERE is_return = true;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  9. RLS — سياسات أمان الصفوف (نفس نمط المشروع)                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

ALTER TABLE purchase_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_stage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;

-- ─── purchase_transactions ─────────────────────────────────────────────

CREATE POLICY "pt_tenant_isolation_select" ON purchase_transactions
    FOR SELECT TO public
    USING (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

CREATE POLICY "pt_tenant_isolation_insert" ON purchase_transactions
    FOR INSERT TO public
    WITH CHECK (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

CREATE POLICY "pt_tenant_isolation_update" ON purchase_transactions
    FOR UPDATE TO public
    USING (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())))
    WITH CHECK (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

CREATE POLICY "pt_tenant_isolation_delete" ON purchase_transactions
    FOR DELETE TO public
    USING (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

-- ─── purchase_transaction_items ────────────────────────────────────────

CREATE POLICY "pti_tenant_isolation_select" ON purchase_transaction_items
    FOR SELECT TO public
    USING ((transaction_id IN (SELECT id FROM purchase_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid()));

CREATE POLICY "pti_tenant_isolation_insert" ON purchase_transaction_items
    FOR INSERT TO public
    WITH CHECK ((transaction_id IN (SELECT id FROM purchase_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid()));

CREATE POLICY "pti_tenant_isolation_update" ON purchase_transaction_items
    FOR UPDATE TO public
    USING ((transaction_id IN (SELECT id FROM purchase_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid()));

CREATE POLICY "pti_tenant_isolation_delete" ON purchase_transaction_items
    FOR DELETE TO public
    USING ((transaction_id IN (SELECT id FROM purchase_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid()));

-- ─── sales_transactions ───────────────────────────────────────────────

CREATE POLICY "st_tenant_isolation_select" ON sales_transactions
    FOR SELECT TO public
    USING (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

CREATE POLICY "st_tenant_isolation_insert" ON sales_transactions
    FOR INSERT TO public
    WITH CHECK (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

CREATE POLICY "st_tenant_isolation_update" ON sales_transactions
    FOR UPDATE TO public
    USING (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())))
    WITH CHECK (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

CREATE POLICY "st_tenant_isolation_delete" ON sales_transactions
    FOR DELETE TO public
    USING (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

-- ─── sales_transaction_items ──────────────────────────────────────────

CREATE POLICY "sti_tenant_isolation_select" ON sales_transaction_items
    FOR SELECT TO public
    USING ((transaction_id IN (SELECT id FROM sales_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid()));

CREATE POLICY "sti_tenant_isolation_insert" ON sales_transaction_items
    FOR INSERT TO public
    WITH CHECK ((transaction_id IN (SELECT id FROM sales_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid()));

CREATE POLICY "sti_tenant_isolation_update" ON sales_transaction_items
    FOR UPDATE TO public
    USING ((transaction_id IN (SELECT id FROM sales_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid()));

CREATE POLICY "sti_tenant_isolation_delete" ON sales_transaction_items
    FOR DELETE TO public
    USING ((transaction_id IN (SELECT id FROM sales_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid()));

-- ─── transaction_stage_log ────────────────────────────────────────────

CREATE POLICY "tsl_tenant_isolation_select" ON transaction_stage_log
    FOR SELECT TO public
    USING (
        (transaction_id IN (SELECT id FROM purchase_transactions WHERE tenant_id = get_current_tenant_id()))
        OR
        (transaction_id IN (SELECT id FROM sales_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid())
    );

CREATE POLICY "tsl_tenant_isolation_insert" ON transaction_stage_log
    FOR INSERT TO public
    WITH CHECK (
        (transaction_id IN (SELECT id FROM purchase_transactions WHERE tenant_id = get_current_tenant_id()))
        OR
        (transaction_id IN (SELECT id FROM sales_transactions WHERE tenant_id = get_current_tenant_id()))
        OR is_super_admin(auth.uid())
    );

-- ─── document_sequences ──────────────────────────────────────────────

CREATE POLICY "ds_tenant_isolation_select" ON document_sequences
    FOR SELECT TO public
    USING (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

CREATE POLICY "ds_tenant_isolation_insert" ON document_sequences
    FOR INSERT TO public
    WITH CHECK (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));

CREATE POLICY "ds_tenant_isolation_update" ON document_sequences
    FOR UPDATE TO public
    USING (((tenant_id = get_current_tenant_id()) OR is_super_admin(auth.uid())));


COMMIT;

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  ✅ المرحلة 1 مكتملة!                                                ║
-- ║                                                                       ║
-- ║  الجداول: 6   (purchase_transactions, purchase_transaction_items,     ║
-- ║                 sales_transactions, sales_transaction_items,           ║
-- ║                 transaction_stage_log, document_sequences)             ║
-- ║  الدوال:  3   (is_valid_stage_transition, generate_stage_number,      ║
-- ║                 advance_transaction_stage)                             ║
-- ║  التريغرات: 4  (balance calc × 2, updated_at × 2)                    ║
-- ║  RLS:     18  (tenant isolation لكل الجداول بنمط المشروع)              ║
-- ║  الفهارس: 20+ (أداء عالي)                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
