-- ════════════════════════════════════════════════════════════════
-- customer_phones — أرقام هواتف العملاء مع تتبع آخر استخدام
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone_number VARCHAR(50) NOT NULL,
  country VARCHAR(100),
  city VARCHAR(100),
  label VARCHAR(50) DEFAULT 'primary',  -- primary / alt / work
  last_used_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id, phone_number)
);

-- Fast lookup: customer → phones sorted by last used
CREATE INDEX IF NOT EXISTS idx_customer_phones_customer_last_used 
  ON customer_phones(customer_id, last_used_at DESC);

-- RLS
ALTER TABLE customer_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_phones_tenant_isolation" ON customer_phones
  USING (tenant_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid);

CREATE POLICY "customer_phones_insert" ON customer_phones
  FOR INSERT WITH CHECK (tenant_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid);

CREATE POLICY "customer_phones_update" ON customer_phones
  FOR UPDATE USING (tenant_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid);

CREATE POLICY "customer_phones_delete" ON customer_phones
  FOR DELETE USING (tenant_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid);

-- ════════════════════════════════════════════════════════════════
-- customer_compliance_docs — وثائق الامتثال KYC/AML
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_compliance_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,  -- id_card / passport / residence / license / commercial_register
  doc_number VARCHAR(100),
  issuing_country VARCHAR(100),
  issue_date DATE,
  expiry_date DATE,
  status VARCHAR(30) DEFAULT 'valid',  -- valid / expired / pending_review
  file_url TEXT,
  notes TEXT,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup: customer → compliance docs
CREATE INDEX IF NOT EXISTS idx_compliance_docs_customer 
  ON customer_compliance_docs(customer_id);

-- RLS
ALTER TABLE customer_compliance_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_docs_tenant_isolation" ON customer_compliance_docs
  USING (tenant_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid);

CREATE POLICY "compliance_docs_insert" ON customer_compliance_docs
  FOR INSERT WITH CHECK (tenant_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid);

CREATE POLICY "compliance_docs_update" ON customer_compliance_docs
  FOR UPDATE USING (tenant_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid);

CREATE POLICY "compliance_docs_delete" ON customer_compliance_docs
  FOR DELETE USING (tenant_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'tenant_id')::uuid);

-- ════════════════════════════════════════════════════════════════
-- Auto-expire: trigger to set status = 'expired' on select
-- (handled in frontend for simplicity — no trigger needed)
-- ════════════════════════════════════════════════════════════════
