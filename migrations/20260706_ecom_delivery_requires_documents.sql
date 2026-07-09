-- ═══════════════════════════════════════════════════════════════════════════
-- حزام أمان قاعدي: لا shipped/delivered لطلب متجر بلا مستند ERP مرتبط
-- ═══════════════════════════════════════════════════════════════════════════
-- تدقيق الحسابات كشف طلبات «مُسلَّمة ومدفوعة» بصفر فاتورة/قيد (TEST-AUTO-002)
-- لأن إنشاء المستندات معلّق على انتقال React UI فقط. أصلحنا محرك الواجهة
-- (orderWorkflowEngine يحجب التقدّم عند فشل المستندات)، وهذا التريغر هو الضمان
-- على مستوى القاعدة لأي مسار يتجاوز الواجهة (API/بذر/تعديل مباشر):
-- الانتقال إلى shipped أو delivered يتطلب فاتورة مبيعات مرتبطة
-- (invoice_no = 'INV-EC-'||order_number — نمط createSalesInvoiceFromEcom
-- المؤكَّد على القاعدة) أو أمر شراء مصدره هذا الطلب (تدفّق مورّد).
-- أثر جانبي مقصود: الكاش باك (يترحّل عند delivered) يصبح مضموناً فوق بيع مُقيَّد.

CREATE OR REPLACE FUNCTION public.ecom_order_delivery_requires_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status IN ('shipped','delivered')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
         SELECT 1 FROM public.sales_transactions st
         WHERE st.invoice_no = 'INV-EC-' || NEW.order_number
       )
       AND NOT EXISTS (
         -- تدفق المورّد: createPurchaseOrderFromEcom يرقّم PO-EC-<order_number>-<supplier>
         SELECT 1 FROM public.purchase_orders po
         WHERE po.order_number LIKE 'PO-EC-' || NEW.order_number || '-%'
       )
    THEN
      RAISE EXCEPTION
        'لا يمكن نقل الطلب % إلى «%» بلا فاتورة مبيعات مرتبطة (INV-EC-%) أو أمر شراء مصدره الطلب — نفّذ تحويل الطلب لمستندات ERP أولاً.',
        NEW.order_number, NEW.status, NEW.order_number
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecom_delivery_requires_documents ON public.ecommerce_orders;
CREATE TRIGGER trg_ecom_delivery_requires_documents
  BEFORE UPDATE OF status ON public.ecommerce_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.ecom_order_delivery_requires_documents();
