-- ══════════════════════════════════════════════════════════════════
-- 📄 Entity Documents — نظام المستندات الديناميكي
-- ══════════════════════════════════════════════════════════════════
-- يدعم: مستندات هوية + جوازات + إقامات + إشعارات SWIFT + أي وثيقة
-- كل مستند = سطر مستقل مع مرفقات + تتبع تغييرات
-- ══════════════════════════════════════════════════════════════════

-- ═══ 1. إنشاء الجدول ═══
CREATE TABLE IF NOT EXISTS public.entity_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),

    -- ════ Polymorphic Reference ════
    -- يدعم ربط المستند بأي كيان (زبون، وكيل، شريك، حوالة)
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'customer',     -- زبون صرافة
        'agent',        -- وكيل
        'partner',      -- شريك
        'remittance',   -- حوالة (لربط إشعارات SWIFT)
        'transaction'   -- عملية صرف
    )),
    entity_id UUID NOT NULL,

    -- ════ Document Details ════
    document_type TEXT NOT NULL CHECK (document_type IN (
        -- هويات شخصية
        'national_id',        -- بطاقة هوية وطنية
        'passport',           -- جواز سفر
        'residence_permit',   -- تصريح إقامة
        'driving_license',    -- رخصة قيادة
        'military_id',        -- بطاقة عسكرية
        -- مستندات تجارية
        'trade_license',      -- رخصة تجارية
        'tax_certificate',    -- شهادة ضريبية
        'commercial_register',-- سجل تجاري
        -- مستندات بنكية
        'swift_notice',       -- إشعار سويفت
        'bank_statement',     -- كشف حساب بنكي
        'bank_guarantee',     -- ضمان بنكي
        'transfer_receipt',   -- إيصال تحويل
        -- عقود واتفاقيات
        'contract',           -- عقد
        'agreement',          -- اتفاقية
        'power_of_attorney',  -- وكالة
        -- أخرى
        'other'               -- أخرى
    )),
    document_number TEXT,           -- رقم الوثيقة
    issue_date DATE,                -- تاريخ الإصدار
    expiry_date DATE,               -- تاريخ الانتهاء
    issuing_authority TEXT,          -- جهة الإصدار

    -- ════ Person-specific (for KYC) ════
    nationality TEXT,               -- الجنسية (للمستندات الشخصية)
    date_of_birth DATE,             -- تاريخ الميلاد

    -- ════ Remittance Link (for SWIFT) ════
    remittance_id UUID,             -- ربط بحوالة محددة (اختياري)

    -- ════ Status ════
    status TEXT DEFAULT 'active' CHECK (status IN (
        'active', 'expired', 'revoked', 'pending_verification'
    )),
    is_primary BOOLEAN DEFAULT false,   -- المستند الأساسي
    is_verified BOOLEAN DEFAULT false,  -- تم التحقق

    -- ════ Notes ════
    notes TEXT,
    metadata JSONB DEFAULT '{}',        -- بيانات إضافية مرنة

    -- ════ Attachments ════
    -- مصفوفة مرفقات: [{url, name, type, size, uploaded_at}]
    attachments JSONB DEFAULT '[]',

    -- ════ Audit ════
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ 2. الفهارس ═══
CREATE INDEX IF NOT EXISTS idx_entity_docs_tenant ON public.entity_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_entity_docs_company ON public.entity_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_entity_docs_entity ON public.entity_documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_docs_type ON public.entity_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_entity_docs_expiry ON public.entity_documents(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_docs_remittance ON public.entity_documents(remittance_id) WHERE remittance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_docs_status ON public.entity_documents(status);

-- ═══ 3. تفعيل RLS ═══
ALTER TABLE public.entity_documents ENABLE ROW LEVEL SECURITY;

-- ═══ 4. سياسات RLS ═══
SELECT create_company_rls_policies('entity_documents', true, true);

-- ═══ 5. التريغرات ═══
SELECT apply_auto_tenant_trigger('entity_documents');
SELECT apply_auto_company_trigger('entity_documents');
SELECT apply_brand_isolation_trigger('entity_documents');

-- ═══ 6. تريغر auto-update timestamp ═══
CREATE OR REPLACE FUNCTION update_entity_documents_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entity_documents_updated ON public.entity_documents;
CREATE TRIGGER trg_entity_documents_updated
    BEFORE UPDATE ON public.entity_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_entity_documents_timestamp();

-- ═══ 7. تريغر auto-expire documents ═══
-- يحدّث حالة المستندات المنتهية تلقائياً
CREATE OR REPLACE FUNCTION check_document_expiry()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.expiry_date IS NOT NULL AND NEW.expiry_date < CURRENT_DATE AND NEW.status = 'active' THEN
        NEW.status = 'expired';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entity_docs_check_expiry ON public.entity_documents;
CREATE TRIGGER trg_entity_docs_check_expiry
    BEFORE INSERT OR UPDATE ON public.entity_documents
    FOR EACH ROW
    EXECUTE FUNCTION check_document_expiry();

-- ═══ 8. التحقق ═══
DO $$
BEGIN
    RAISE NOTICE '✅ entity_documents table created successfully';
    RAISE NOTICE '✅ 7 indexes created';
    RAISE NOTICE '✅ RLS enabled with company policies';
    RAISE NOTICE '✅ Auto triggers applied (tenant, company, brand isolation)';
    RAISE NOTICE '✅ Auto-expire trigger enabled';
END $$;
