# TexaCore RSF Import — Technical Documentation
# توثيق عملية استيراد ملفات الرشيد — المرجع الرسمي
#
# ⚠️ هام: هذا الملف هو التوثيق الرسمي لعملية الاستيراد.
# لا يجب تعديل أي من الملفات المذكورة أدناه بدون الرجوع لهذا التوثيق.
# آخر تحديث: 2026-05-11
# ═══════════════════════════════════════════════════════════════════

## ملفات الاستيراد (Source of Truth)

### 1. api-server-standalone.js
**الموقع:** `texacore-installer/src/api-server-standalone.js`
**الدور:** خادم API + محاذاة الـ Schema + تسوية المستخدمين

#### أ. Schema Alignment (محاذاة الهيكل)
يتم تشغيله **قبل الاستيراد** لضمان وجود جميع الأعمدة:

```sql
-- purchase_invoices
ALTER TABLE purchase_invoices ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS receipt_mode text DEFAULT 'direct';
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS receipt_status text DEFAULT 'pending';
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS document_stage text DEFAULT 'invoice';
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS container_id uuid;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS warehouse_id uuid;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS shipment_id uuid;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS confirmation_status text DEFAULT 'pending';
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS expenses_total numeric DEFAULT 0;

-- sales_invoices
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'pending';

-- chart_of_accounts
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_party_account boolean DEFAULT false;

-- user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_support_account boolean DEFAULT false;

-- mfa_user_settings
ALTER TABLE mfa_user_settings ADD COLUMN IF NOT EXISTS totp_verified boolean DEFAULT false;
ALTER TABLE mfa_user_settings ADD COLUMN IF NOT EXISTS preferred_method text DEFAULT 'totp';

-- document_activity (aliases for frontend compatibility)
ALTER TABLE document_activity ADD COLUMN IF NOT EXISTS entity_type text GENERATED ALWAYS AS (document_type) STORED;
ALTER TABLE document_activity ADD COLUMN IF NOT EXISTS entity_id uuid GENERATED ALWAYS AS (document_id) STORED;

-- inventory_movements
ALTER TABLE inventory_movements ALTER COLUMN created_by DROP NOT NULL;
```

#### ب. Admin Provisioning (تسوية المستخدمين)
يتم **بعد الاستيراد** في نفس الـ transaction:

1. **TexaCore Support** (`feras1960@gmail.com`):
   - الدور: `super_admin`
   - `is_support_account = true` → مخفي من الواجهة
   - لا يُشمل في orphan user linking

2. **إنشاء الأدوار الأساسية** (8 أدوار):
   - `company_owner`, `company_admin`, `tenant_owner`
   - `accountant`, `warehouse_manager`, `sales_manager`, `purchase_manager`
   - `viewer`
   - `ON CONFLICT DO NOTHING` — آمنة للتكرار

3. **ربط المستخدمين اليتامى:**
   - كل مستخدم auth بدون profile → ينشأ له profile
   - كل مستخدم بدون دور → يأخذ `company_owner`
   - حساب الدعم **مستثنى** من كل القواعد أعلاه

---

### 2. rsf-mapper.js
**الموقع:** `texacore-installer/src/rsf-mapper.js`
**الدور:** تحويل بيانات RSF إلى SQL

#### أ. فواتير المشتريات (_insertPurchaseInvoices)
```sql
INSERT INTO purchase_invoices
  (..., receipt_status)
VALUES (..., 'received')
```
**لماذا `received`:** الفواتير المستوردة من برنامج محاسبي = البضاعة مستلمة بالكامل.
**الأثر:** لا تظهر في أذون الاستلام (useReceiptSources يفلتر `receipt_status != 'received'`).

#### ب. فواتير المبيعات (_insertSalesInvoices)
```sql
INSERT INTO sales_invoices
  (..., delivery_status)
VALUES (..., 'delivered')
```
**لماذا `delivered`:** البضاعة مسلّمة بالكامل.
**الأثر:** لا تظهر في أذون التسليم.

#### ج. مزامنة purchase_transactions
```sql
CASE
  WHEN pi.receipt_status = 'received' THEN 'paid'  -- ← هذا السطر حرج!
  WHEN pi.status IN ('posted','completed') THEN 'posted'
  ...
END
```
**لماذا `paid` وليس `received`:** check constraint على `purchase_transactions.stage` لا يسمح بـ `received`.
القيم المسموحة: `draft, quotation, order, approved, receipt, invoice, posted, partial_paid, paid, cancelled`

---

### 3. Frontend Changes
**الملفات المتأثرة:**

| الملف | التغيير | السبب |
|-------|---------|-------|
| `src/features/settings/components/UsersManagementTab.tsx` | فلتر `is_support_account` + `SUPPORT_HIDDEN_EMAILS` | إخفاء حساب الدعم |
| `src/features/purchases/pages/PaymentsList.tsx` | إزالة `container:containers(...)` join | جدول `containers` غير موجود |
| `src/features/accounting/AccountingSettings.tsx` | إضافة `tenant_id` في auto-persist upsert | منع NOT NULL violation |

---

## قواعد الأمان

### لا تُعدّل:
1. **لا تُضف `received` لـ check constraint** الخاص بـ `purchase_transactions.stage` — استخدم `paid` بدلاً منه
2. **لا تُزل `is_support_account`** من user_profiles — سيظهر حساب الدعم للمستخدمين
3. **لا تُغيّر `receipt_status = 'received'`** في rsf-mapper — ستظهر الفواتير في أذون الاستلام
4. **لا تُعدّل `SUPPORT_HIDDEN_EMAILS`** بدون التنسيق — الإيميل الوحيد المعتمد: `feras1960@gmail.com`

### عند إضافة أعمدة جديدة:
1. أضف `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` في **schema alignment** بـ `api-server-standalone.js`
2. تأكد أن العمود **nullable** أو له **DEFAULT** حتى لا يفشل الاستيراد القديم

---

## اختبار الاستيراد — قائمة التحقق

بعد أي تعديل على ملفات الاستيراد:

- [ ] شجرة الحسابات: ~370 حساب مستورد
- [ ] القيود المحاسبية: ~4,300 قيد متوازن
- [ ] العملاء: 51 عميل
- [ ] الموردين: 48 مورد
- [ ] فواتير المشتريات: `receipt_status = 'received'`
- [ ] فواتير المبيعات: `delivery_status = 'delivered'`
- [ ] purchase_transactions: `stage = 'paid'` (لفواتير RSF)
- [ ] أذون الاستلام/التسليم: **فارغة** (لا تظهر فواتير RSF)
- [ ] المستخدم Admin: دور `company_owner`
- [ ] حساب TexaCore Support: مخفي من إدارة المستخدمين
- [ ] لا أخطاء 400 في الكونسول
