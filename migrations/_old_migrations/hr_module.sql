-- ══════════════════════════════════════════════════════════════════════════════
-- HR MODULE — Human Resources Management System
-- TexaCore ERP | Phase 1: Core Tables
-- Date: 2026-02-28
-- ══════════════════════════════════════════════════════════════════════════════
-- 
-- الجداول:
--   1. departments          — الأقسام
--   2. positions            — المسميات الوظيفية
--   3. employees            — الموظفين (مرتبط بـ user_profiles)
--   4. employee_contracts   — العقود
--   5. salary_components    — مكونات الراتب (بدلات/خصومات)
--   6. employee_salary      — راتب الموظف
--   7. leave_types          — أنواع الإجازات
--   8. leave_balances       — أرصدة الإجازات
--   9. leave_requests       — طلبات الإجازات
--  10. attendance           — الحضور والانصراف
--  11. payroll_periods      — فترات الرواتب
--  12. payroll_entries      — كشوف الرواتب
--  13. employee_documents   — مستندات الموظف
--  14. hr_settings          — إعدادات الموارد البشرية
-- ══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- 1. DEPARTMENTS — الأقسام
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(20),
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    name_uk VARCHAR(255),
    
    parent_id UUID REFERENCES departments(id),
    manager_id UUID, -- → employees.id (added after employees table)
    
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    
    cost_center_id UUID, -- ربط بمركز التكلفة
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_departments_tenant ON departments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_departments_company ON departments(company_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_tenant_access" ON departments
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 2. POSITIONS — المسميات الوظيفية
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(20),
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    name_uk VARCHAR(255),
    
    department_id UUID REFERENCES departments(id),
    
    description TEXT,
    min_salary NUMERIC(15,2),
    max_salary NUMERIC(15,2),
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_positions_tenant ON positions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_positions_department ON positions(department_id);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "positions_tenant_access" ON positions
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 3. EMPLOYEES — الموظفين
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    branch_id UUID,
    
    -- ربط مع النظام
    user_profile_id UUID REFERENCES user_profiles(id), -- ربط بحساب المستخدم
    
    -- البيانات الأساسية
    employee_number VARCHAR(20), -- رقم الموظف
    first_name_ar VARCHAR(100) NOT NULL,
    last_name_ar VARCHAR(100),
    first_name_en VARCHAR(100),
    last_name_en VARCHAR(100),
    full_name_ar VARCHAR(255) GENERATED ALWAYS AS (first_name_ar || ' ' || COALESCE(last_name_ar, '')) STORED,
    full_name_en VARCHAR(255) GENERATED ALWAYS AS (COALESCE(first_name_en, '') || ' ' || COALESCE(last_name_en, '')) STORED,
    
    -- الهوية
    national_id VARCHAR(30),
    passport_number VARCHAR(30),
    nationality VARCHAR(50),
    date_of_birth DATE,
    gender VARCHAR(10) CHECK (gender IN ('male', 'female')),
    marital_status VARCHAR(20) CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed')),
    
    -- التواصل
    email VARCHAR(255),
    phone VARCHAR(30),
    mobile VARCHAR(30),
    emergency_contact_name VARCHAR(200),
    emergency_contact_phone VARCHAR(30),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(50),
    
    -- الوظيفة
    department_id UUID REFERENCES departments(id),
    position_id UUID REFERENCES positions(id),
    reporting_to UUID REFERENCES employees(id), -- المدير المباشر
    
    -- التوظيف
    hire_date DATE,
    probation_end_date DATE,
    employment_type VARCHAR(20) DEFAULT 'full_time'
        CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'temporary', 'intern')),
    employment_status VARCHAR(20) DEFAULT 'active'
        CHECK (employment_status IN ('active', 'on_leave', 'suspended', 'terminated', 'resigned')),
    termination_date DATE,
    termination_reason TEXT,
    
    -- المالي
    bank_name VARCHAR(100),
    bank_account VARCHAR(50),
    iban VARCHAR(50),
    tax_id VARCHAR(30),
    social_insurance_number VARCHAR(30),
    
    -- إضافي
    avatar_url TEXT,
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    tags TEXT[],
    
    is_active BOOLEAN DEFAULT true,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_position ON employees(position_id);
CREATE INDEX IF NOT EXISTS idx_employees_user_profile ON employees(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(employment_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_number ON employees(tenant_id, employee_number) WHERE employee_number IS NOT NULL;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employees_tenant_access" ON employees
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );

-- ربط manager_id في departments
ALTER TABLE departments ADD CONSTRAINT fk_departments_manager 
    FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL;


-- ═══════════════════════════════════════════════════════════════
-- 4. EMPLOYEE CONTRACTS — العقود
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    
    contract_number VARCHAR(30),
    contract_type VARCHAR(20) DEFAULT 'permanent'
        CHECK (contract_type IN ('permanent', 'fixed_term', 'probation', 'temporary', 'freelance')),
    
    start_date DATE NOT NULL,
    end_date DATE, -- NULL = دائم
    probation_months INTEGER DEFAULT 3,
    
    basic_salary NUMERIC(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'SAR',
    payment_frequency VARCHAR(20) DEFAULT 'monthly'
        CHECK (payment_frequency IN ('weekly', 'biweekly', 'monthly', 'annual')),
    
    working_hours_per_day NUMERIC(4,2) DEFAULT 8,
    working_days_per_week INTEGER DEFAULT 5,
    annual_leave_days INTEGER DEFAULT 21,
    
    notice_period_days INTEGER DEFAULT 30,
    
    terms TEXT, -- شروط إضافية
    attachment_url TEXT,
    
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'expired', 'terminated', 'renewed')),
    
    renewed_from UUID REFERENCES employee_contracts(id),
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_employee ON employee_contracts(employee_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON employee_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON employee_contracts(status);

ALTER TABLE employee_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contracts_tenant_access" ON employee_contracts
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 5. SALARY COMPONENTS — مكونات الراتب
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS salary_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(20) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    component_type VARCHAR(20) NOT NULL
        CHECK (component_type IN ('earning', 'deduction', 'employer_contribution')),
    -- earning: بدل سكن، بدل نقل، بدل أكل...
    -- deduction: تأمينات، ضرائب، سلف...
    -- employer_contribution: حصة صاحب العمل في التأمينات
    
    calculation_type VARCHAR(20) DEFAULT 'fixed'
        CHECK (calculation_type IN ('fixed', 'percentage', 'formula')),
    
    default_amount NUMERIC(15,2),
    percentage_of VARCHAR(50), -- 'basic_salary' or component code
    percentage_value NUMERIC(8,4),
    formula TEXT, -- للحسابات المعقدة
    
    is_taxable BOOLEAN DEFAULT true,
    is_social_insurance BOOLEAN DEFAULT false,
    is_variable BOOLEAN DEFAULT false, -- يتغير شهرياً (ساعات إضافية مثلاً)
    
    account_id UUID, -- ربط بالحساب المحاسبي
    
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_comp_tenant ON salary_components(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_comp_code ON salary_components(tenant_id, code);

ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salary_components_tenant_access" ON salary_components
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 6. EMPLOYEE SALARY — راتب الموظف
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_salary_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES salary_components(id),
    
    amount NUMERIC(15,2),
    percentage NUMERIC(8,4), -- إذا كان نسبة
    
    effective_from DATE NOT NULL,
    effective_to DATE, -- NULL = ساري
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_salary_employee ON employee_salary_details(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_salary_component ON employee_salary_details(component_id);

ALTER TABLE employee_salary_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_salary_tenant_access" ON employee_salary_details
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 7. LEAVE TYPES — أنواع الإجازات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    code VARCHAR(20) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    
    leave_category VARCHAR(20) DEFAULT 'annual'
        CHECK (leave_category IN ('annual', 'sick', 'unpaid', 'maternity', 'paternity', 'emergency', 'study', 'hajj', 'other')),
    
    max_days_per_year INTEGER,
    max_consecutive_days INTEGER,
    requires_attachment BOOLEAN DEFAULT false,
    requires_approval BOOLEAN DEFAULT true,
    is_paid BOOLEAN DEFAULT true,
    can_carry_forward BOOLEAN DEFAULT false,
    max_carry_forward_days INTEGER DEFAULT 0,
    
    color VARCHAR(7) DEFAULT '#3B82F6',
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_types_tenant ON leave_types(tenant_id);

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_types_tenant_access" ON leave_types
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 8. LEAVE BALANCES — أرصدة الإجازات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    
    year INTEGER NOT NULL,
    
    allocated_days NUMERIC(5,1) DEFAULT 0, -- أيام مخصصة
    used_days NUMERIC(5,1) DEFAULT 0,       -- أيام مستخدمة
    carried_days NUMERIC(5,1) DEFAULT 0,    -- أيام مرحّلة
    pending_days NUMERIC(5,1) DEFAULT 0,    -- أيام قيد الموافقة
    
    remaining_days NUMERIC(5,1) GENERATED ALWAYS AS (allocated_days + carried_days - used_days - pending_days) STORED,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_balance_unique 
    ON leave_balances(employee_id, leave_type_id, year);
CREATE INDEX IF NOT EXISTS idx_leave_balances_tenant ON leave_balances(tenant_id);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_balances_tenant_access" ON leave_balances
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 9. LEAVE REQUESTS — طلبات الإجازات
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days NUMERIC(5,1) NOT NULL,
    
    is_half_day BOOLEAN DEFAULT false,
    half_day_type VARCHAR(10) CHECK (half_day_type IN ('first_half', 'second_half')),
    
    reason TEXT,
    attachment_url TEXT,
    
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
    
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    substitute_employee_id UUID REFERENCES employees(id), -- البديل
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_req_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_req_tenant ON leave_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leave_req_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_req_dates ON leave_requests(start_date, end_date);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_requests_tenant_access" ON leave_requests
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 10. ATTENDANCE — الحضور والانصراف
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    
    attendance_date DATE NOT NULL,
    
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    
    worked_hours NUMERIC(5,2), -- يُحسب تلقائياً
    overtime_hours NUMERIC(5,2) DEFAULT 0,
    
    status VARCHAR(20) DEFAULT 'present'
        CHECK (status IN ('present', 'absent', 'late', 'half_day', 'on_leave', 'holiday', 'weekend')),
    
    late_minutes INTEGER DEFAULT 0,
    early_leave_minutes INTEGER DEFAULT 0,
    
    check_in_method VARCHAR(20) DEFAULT 'manual'
        CHECK (check_in_method IN ('manual', 'biometric', 'qr_code', 'gps', 'mobile', 'system')),
    
    check_in_location JSONB, -- {lat, lng, address}
    check_out_location JSONB,
    
    leave_request_id UUID REFERENCES leave_requests(id),
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique 
    ON attendance(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant ON attendance(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_tenant_access" ON attendance
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 11. PAYROLL PERIODS — فترات الرواتب
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payroll_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    period_name VARCHAR(50) NOT NULL, -- "فبراير 2026"
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    payment_date DATE,
    
    total_gross NUMERIC(15,2) DEFAULT 0,
    total_deductions NUMERIC(15,2) DEFAULT 0,
    total_net NUMERIC(15,2) DEFAULT 0,
    total_employer_cost NUMERIC(15,2) DEFAULT 0,
    employee_count INTEGER DEFAULT 0,
    
    status VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'processing', 'calculated', 'approved', 'paid', 'cancelled')),
    
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    
    journal_entry_id UUID, -- ربط بالقيد المحاسبي
    
    notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_period_unique 
    ON payroll_periods(tenant_id, company_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_tenant ON payroll_periods(tenant_id);

ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_periods_tenant_access" ON payroll_periods
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 12. PAYROLL ENTRIES — كشوف الرواتب (لكل موظف)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payroll_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id),
    
    -- الراتب الأساسي
    basic_salary NUMERIC(15,2) NOT NULL,
    
    -- الملخص
    total_earnings NUMERIC(15,2) DEFAULT 0,
    total_deductions NUMERIC(15,2) DEFAULT 0,
    total_employer_contributions NUMERIC(15,2) DEFAULT 0,
    net_salary NUMERIC(15,2) DEFAULT 0,
    
    -- التفاصيل (كل مكون على حدة)
    components JSONB DEFAULT '[]',
    -- مثال: [
    --   {"component_id": "...", "code": "housing", "name": "بدل سكن", "type": "earning", "amount": 2500},
    --   {"component_id": "...", "code": "gosi", "name": "تأمينات", "type": "deduction", "amount": -450}
    -- ]
    
    -- الحضور
    working_days INTEGER,
    actual_working_days INTEGER,
    absent_days INTEGER DEFAULT 0,
    overtime_hours NUMERIC(6,2) DEFAULT 0,
    overtime_amount NUMERIC(15,2) DEFAULT 0,
    
    -- الحسابات
    leave_deduction NUMERIC(15,2) DEFAULT 0,
    loan_deduction NUMERIC(15,2) DEFAULT 0,
    other_deductions NUMERIC(15,2) DEFAULT 0,
    bonus_amount NUMERIC(15,2) DEFAULT 0,
    commission_amount NUMERIC(15,2) DEFAULT 0,
    
    currency VARCHAR(3) DEFAULT 'SAR',
    
    payment_method VARCHAR(20) DEFAULT 'bank_transfer'
        CHECK (payment_method IN ('bank_transfer', 'cash', 'check', 'digital_wallet')),
    payment_reference VARCHAR(100),
    paid_at TIMESTAMPTZ,
    
    status VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'calculated', 'approved', 'paid')),
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_entry_unique 
    ON payroll_entries(payroll_period_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_tenant ON payroll_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_employee ON payroll_entries(employee_id);

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_entries_tenant_access" ON payroll_entries
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 13. EMPLOYEE DOCUMENTS — مستندات الموظف
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    
    document_type VARCHAR(30) NOT NULL
        CHECK (document_type IN (
            'id_card', 'passport', 'visa', 'work_permit', 'driving_license',
            'degree', 'certificate', 'contract', 'resignation', 'termination',
            'warning_letter', 'appreciation', 'medical', 'insurance', 'other'
        )),
    
    title VARCHAR(200) NOT NULL,
    description TEXT,
    
    file_url TEXT NOT NULL,
    file_name VARCHAR(255),
    file_size INTEGER,
    file_type VARCHAR(50),
    
    issue_date DATE,
    expiry_date DATE,
    
    document_number VARCHAR(50),
    issuing_authority VARCHAR(200),
    
    is_verified BOOLEAN DEFAULT false,
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_docs_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_docs_tenant ON employee_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_emp_docs_expiry ON employee_documents(expiry_date) WHERE expiry_date IS NOT NULL;

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_documents_tenant_access" ON employee_documents
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- 14. HR SETTINGS — إعدادات الموارد البشرية
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    
    -- ساعات العمل الافتراضية
    default_working_hours NUMERIC(4,2) DEFAULT 8,
    default_working_days INTEGER DEFAULT 5,
    weekend_days INTEGER[] DEFAULT ARRAY[5, 6], -- الجمعة والسبت
    
    -- الحضور
    grace_period_minutes INTEGER DEFAULT 15,
    overtime_multiplier NUMERIC(4,2) DEFAULT 1.5,
    
    -- الرواتب
    payroll_day INTEGER DEFAULT 25, -- يوم صرف الراتب
    default_currency VARCHAR(3) DEFAULT 'SAR',
    
    -- التأمينات (GOSI - السعودية)
    employer_social_insurance_pct NUMERIC(5,2) DEFAULT 12.0,
    employee_social_insurance_pct NUMERIC(5,2) DEFAULT 10.0,
    
    -- الإجازات
    default_annual_leave_days INTEGER DEFAULT 21,
    probation_leave_allowed BOOLEAN DEFAULT false,
    
    -- أرقام تلقائية
    employee_number_prefix VARCHAR(10) DEFAULT 'EMP',
    employee_number_counter INTEGER DEFAULT 1,
    
    -- إعدادات إضافية
    settings JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_settings_unique 
    ON hr_settings(tenant_id, company_id);

ALTER TABLE hr_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_settings_tenant_access" ON hr_settings
    FOR ALL USING (
        is_platform_admin() OR tenant_id = get_user_tenant_id()
    );


-- ═══════════════════════════════════════════════════════════════
-- TRIGGERS — تحديث updated_at تلقائياً
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'departments', 'positions', 'employees', 'employee_contracts',
        'salary_components', 'employee_salary_details', 'leave_types',
        'leave_balances', 'leave_requests', 'attendance',
        'payroll_periods', 'payroll_entries', 'employee_documents', 'hr_settings'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER set_%s_updated_at 
             BEFORE UPDATE ON %I 
             FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()',
            tbl, tbl
        );
        RAISE NOTICE 'Created trigger for %', tbl;
    END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- FUNCTIONS — دوال مساعدة
-- ═══════════════════════════════════════════════════════════════

-- دالة: توليد رقم موظف تلقائي
CREATE OR REPLACE FUNCTION generate_employee_number(p_tenant_id UUID, p_company_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
    v_prefix TEXT;
    v_counter INTEGER;
    v_number TEXT;
BEGIN
    SELECT employee_number_prefix, employee_number_counter
    INTO v_prefix, v_counter
    FROM hr_settings
    WHERE tenant_id = p_tenant_id 
    AND (company_id = p_company_id OR (company_id IS NULL AND p_company_id IS NULL))
    LIMIT 1;
    
    v_prefix := COALESCE(v_prefix, 'EMP');
    v_counter := COALESCE(v_counter, 1);
    
    v_number := v_prefix || '-' || LPAD(v_counter::TEXT, 4, '0');
    
    -- تحديث العداد
    UPDATE hr_settings SET employee_number_counter = v_counter + 1
    WHERE tenant_id = p_tenant_id 
    AND (company_id = p_company_id OR (company_id IS NULL AND p_company_id IS NULL));
    
    -- إذا لم يوجد سجل إعدادات، أنشئه
    IF NOT FOUND THEN
        INSERT INTO hr_settings (tenant_id, company_id, employee_number_counter)
        VALUES (p_tenant_id, p_company_id, 2);
    END IF;
    
    RETURN v_number;
END;
$func$;

-- دالة: حساب ساعات العمل
CREATE OR REPLACE FUNCTION calculate_worked_hours()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
    IF NEW.check_in IS NOT NULL AND NEW.check_out IS NOT NULL THEN
        NEW.worked_hours := ROUND(EXTRACT(EPOCH FROM (NEW.check_out - NEW.check_in)) / 3600.0, 2);
    END IF;
    RETURN NEW;
END;
$func$;

CREATE TRIGGER trg_calculate_worked_hours
    BEFORE INSERT OR UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION calculate_worked_hours();

-- دالة: تحديث رصيد الإجازات عند الموافقة
CREATE OR REPLACE FUNCTION update_leave_balance_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
    -- عند الموافقة: نقل من pending إلى used
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
        UPDATE leave_balances
        SET used_days = used_days + NEW.total_days,
            pending_days = pending_days - NEW.total_days
        WHERE employee_id = NEW.employee_id
        AND leave_type_id = NEW.leave_type_id
        AND year = EXTRACT(YEAR FROM NEW.start_date);
    
    -- عند الرفض أو الإلغاء: إرجاع الأيام المعلقة
    ELSIF NEW.status IN ('rejected', 'cancelled') AND OLD.status = 'pending' THEN
        UPDATE leave_balances
        SET pending_days = pending_days - NEW.total_days
        WHERE employee_id = NEW.employee_id
        AND leave_type_id = NEW.leave_type_id
        AND year = EXTRACT(YEAR FROM NEW.start_date);
    
    -- عند تقديم الطلب: إضافة للمعلق
    ELSIF NEW.status = 'pending' AND (OLD.status IS NULL OR OLD.status = 'draft') THEN
        UPDATE leave_balances
        SET pending_days = pending_days + NEW.total_days
        WHERE employee_id = NEW.employee_id
        AND leave_type_id = NEW.leave_type_id
        AND year = EXTRACT(YEAR FROM NEW.start_date);
    END IF;
    
    RETURN NEW;
END;
$func$;

CREATE TRIGGER trg_leave_balance_update
    AFTER UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION update_leave_balance_on_approval();

-- نفس الشيء عند Insert
CREATE OR REPLACE FUNCTION add_pending_leave_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
    IF NEW.status = 'pending' THEN
        UPDATE leave_balances
        SET pending_days = pending_days + NEW.total_days
        WHERE employee_id = NEW.employee_id
        AND leave_type_id = NEW.leave_type_id
        AND year = EXTRACT(YEAR FROM NEW.start_date);
    END IF;
    RETURN NEW;
END;
$func$;

CREATE TRIGGER trg_leave_pending_on_insert
    AFTER INSERT ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION add_pending_leave_on_insert();


-- ═══════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════';
    RAISE NOTICE '✅ HR MODULE — 14 Tables Created Successfully';
    RAISE NOTICE '   departments, positions, employees,';
    RAISE NOTICE '   employee_contracts, salary_components,';
    RAISE NOTICE '   employee_salary_details, leave_types,';
    RAISE NOTICE '   leave_balances, leave_requests, attendance,';
    RAISE NOTICE '   payroll_periods, payroll_entries,';
    RAISE NOTICE '   employee_documents, hr_settings';
    RAISE NOTICE '══════════════════════════════════════════════════';
END $$;
