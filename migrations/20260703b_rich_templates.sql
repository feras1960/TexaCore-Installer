-- 20260703b_rich_templates.sql
-- ترقية قوالب رسائل أتمتة الطلبات (template_ar) إلى نسخ غنية بالمعلومات.
-- تعديل جراحي على template_ar للمهمة الأولى بكل مرحلة عامة (store_id IS NULL, doc_type='ecom_order')
-- مع الحفاظ على بقية المفاتيح (requires_confirmation/advance_to/reject_to/timeout_minutes/escalate/…) كما هي.
-- idempotent: يعيد الكتابة بالقيمة الغنية دائماً (jsonb_set على المسار الثابت tasks->0->template_ar).

-- pending (admin) — طلب جديد: بنود + دفع + عنوان + كاش باك
UPDATE ecommerce_workflow_stages
SET automation_config = jsonb_set(
  automation_config, '{tasks,0,template_ar}', to_jsonb(
    E'🛒 طلب جديد {order_number}\n' ||
    E'👤 {customer_name} — {customer_phone}\n' ||
    E'📋 البنود ({items_count}):\n{items}\n' ||
    E'💰 الإجمالي: {total} {currency}\n' ||
    E'💳 الدفع: {payment_method} ({payment_status})\n' ||
    E'📍 الشحن: {shipping_address}\n' ||
    E'🎁 كاش باك: {cashback}\n\n' ||
    E'أكّد الطلب أو ألغه:'
  ), false)
WHERE store_id IS NULL AND doc_type = 'ecom_order' AND code = 'pending'
  AND jsonb_array_length(COALESCE(automation_config->'tasks','[]'::jsonb)) > 0;

-- awaiting_payment (admin) — بنود + إجمالي + طريقة الدفع
UPDATE ecommerce_workflow_stages
SET automation_config = jsonb_set(
  automation_config, '{tasks,0,template_ar}', to_jsonb(
    E'⏳ الطلب {order_number} بانتظار الدفعة\n' ||
    E'👤 {customer_name} — {customer_phone}\n' ||
    E'📋 البنود ({items_count}):\n{items}\n' ||
    E'💰 المبلغ: {total} {currency}\n' ||
    E'💳 طريقة الدفع: {payment_method}'
  ), false)
WHERE store_id IS NULL AND doc_type = 'ecom_order' AND code = 'awaiting_payment'
  AND jsonb_array_length(COALESCE(automation_config->'tasks','[]'::jsonb)) > 0;

-- confirmed (admin, تواصل مع الزبون) — بنود + إجمالي ليقرأها المتصل
UPDATE ecommerce_workflow_stages
SET automation_config = jsonb_set(
  automation_config, '{tasks,0,template_ar}', to_jsonb(
    E'☎️ تأكيد مع الزبون — {order_number}\n' ||
    E'👤 {customer_name} — {customer_phone}\n' ||
    E'📋 البنود ({items_count}):\n{items}\n' ||
    E'💰 الإجمالي: {total} {currency}\n' ||
    E'📍 الشحن: {shipping_address}\n\n' ||
    E'تواصل مع الزبون لتأكيد التفاصيل ثم اضغط تم:'
  ), false)
WHERE store_id IS NULL AND doc_type = 'ecom_order' AND code = 'confirmed'
  AND jsonb_array_length(COALESCE(automation_config->'tasks','[]'::jsonb)) > 0;

-- supplier_preparing (supplier) — حجز جديد: كميات + قيمة فاتورة المورد + بنود
UPDATE ecommerce_workflow_stages
SET automation_config = jsonb_set(
  automation_config, '{tasks,0,template_ar}', to_jsonb(
    E'📦 حجز جديد {order_number}\n' ||
    E'🏭 المورد: {supplier_name}\n' ||
    E'🔢 الكمية المطلوبة: {supplier_qty}\n' ||
    E'🧾 قيمة فاتورتك: {supplier_total} {currency}\n' ||
    E'📋 البنود:\n{items}\n\n' ||
    E'اضغط «تأكيد» لتأكيد توفّر الكمية كاملةً،\n' ||
    E'أو «✏️ الكمية المحمّلة» لإدخال الكمية الفعلية المتوفّرة (تُحتسب الفوترة عليها).'
  ), false)
WHERE store_id IS NULL AND doc_type = 'ecom_order' AND code = 'supplier_preparing'
  AND jsonb_array_length(COALESCE(automation_config->'tasks','[]'::jsonb)) > 0;

-- shipped (admin) — + رقم التتبع
UPDATE ecommerce_workflow_stages
SET automation_config = jsonb_set(
  automation_config, '{tasks,0,template_ar}', to_jsonb(
    E'🚚 شُحن الطلب {order_number} — {customer_name}\n' ||
    E'📍 {shipping_address}\n' ||
    E'🔖 رقم التتبع: {tracking_number}'
  ), false)
WHERE store_id IS NULL AND doc_type = 'ecom_order' AND code = 'shipped'
  AND jsonb_array_length(COALESCE(automation_config->'tasks','[]'::jsonb)) > 0;
