-- ═══════════════════════════════════════════════════════════════════════════
-- سلامة المدفوعات: paid_amount مشتق دائماً من ecommerce_payments — لا فجوات
-- ═══════════════════════════════════════════════════════════════════════════
-- الفجوة المكتشفة: TXO-10001 حمل paid_amount=375 بينما المدفوعات الموثقة
-- (ecommerce_payments + سند قبض + قيد) = 155 فقط — 220$ «شبح» كُتبت يدوياً
-- على حقل الطلب بلا أي سجل. الحقل كان قابلاً للكتابة من عدة مسارات UI.
--
-- التصميم الجديد (يمنع الفجوة بنيوياً):
--   paid_amount = SUM(amount - refund_amount) للمدفوعات status='success'
--   payment_status مشتق: 0→pending(أو refunded إن وُجدت استردادات/failed يُحترم)
--                        < total→partial · ≥ total→paid
--   • BEFORE INSERT/UPDATE على ecommerce_orders: يفرض القيمة المشتقة
--     (أي كتابة يدوية تُصحَّح ذاتياً — لا استثناء يكسر المسارات الشرعية،
--     لأن registerPayment يُدرج الدفعة أولاً فتتطابق القيمة المشتقة).
--   • AFTER I/U/D على ecommerce_payments: يعيد حساب الطلب الأب.
-- المسار الشرعي الوحيد لزيادة المدفوع: إدراج دفعة (registerPayment ينشئ
-- معها سند القبض والقيد) — فكل دولار على الطلب موثّق خزينةً ودفتراً.

BEGIN;

CREATE OR REPLACE FUNCTION public.ecom_derive_order_paid(p_order_id uuid)
RETURNS TABLE(paid numeric, refunds numeric)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    COALESCE(SUM(amount - COALESCE(refund_amount, 0)) FILTER (WHERE status = 'success'), 0),
    COALESCE(SUM(COALESCE(refund_amount, 0)) FILTER (WHERE status = 'success'), 0)
  FROM public.ecommerce_payments
  WHERE order_id = p_order_id;
$$;

-- حارس الطلب: يفرض الاشتقاق على أي إدراج/تعديل
CREATE OR REPLACE FUNCTION public.ecom_enforce_derived_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_paid numeric;
  v_refunds numeric;
BEGIN
  SELECT paid, refunds INTO v_paid, v_refunds FROM public.ecom_derive_order_paid(NEW.id);
  NEW.paid_amount := v_paid;
  IF v_paid >= COALESCE(NEW.total_amount, 0) AND v_paid > 0 THEN
    NEW.payment_status := 'paid';
  ELSIF v_paid > 0 THEN
    NEW.payment_status := 'partial';
  ELSIF v_refunds > 0 THEN
    NEW.payment_status := 'refunded';
  ELSIF NEW.payment_status = 'failed' THEN
    NULL; -- فشل بوابة دفع بلا مدفوعات — يُحترم
  ELSE
    NEW.payment_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_ecom_enforce_derived_paid ON public.ecommerce_orders;
CREATE TRIGGER trg_zz_ecom_enforce_derived_paid
  BEFORE INSERT OR UPDATE ON public.ecommerce_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.ecom_enforce_derived_paid();

-- مزامنة الأب عند أي حركة دفع
CREATE OR REPLACE FUNCTION public.ecom_resync_order_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order uuid := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  IF v_order IS NOT NULL THEN
    -- تحديث فارغ يكفي: حارس الطلب يعيد الاشتقاق
    UPDATE public.ecommerce_orders SET updated_at = now() WHERE id = v_order;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ecom_resync_order_on_payment ON public.ecommerce_payments;
CREATE TRIGGER trg_ecom_resync_order_on_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.ecommerce_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.ecom_resync_order_on_payment();

-- تصحيح لمرة واحدة: إعادة اشتقاق كل الطلبات القائمة (يُصحّح شبح TXO-10001)
UPDATE public.ecommerce_orders SET updated_at = now();

COMMIT;
