-- ═══════════════════════════════════════════════════════════════════════════
-- حارس تفاوت الإجماليات: فاتورة الطلب الإلكتروني مقابل الطلب
-- ═══════════════════════════════════════════════════════════════════════════
-- الحالة المكتشفة: TXO-10001 — الطلب متسق داخلياً (570+50 شحن=620) وSO=570،
-- لكن بنود الفاتورة عُدّلت يدوياً بعد الإنشاء إلى 597.17 بلا أي أثر أو مزامنة.
--
-- التصميم (لا حظر أعمى — تعديلات التسليم مشروعة):
--   حارس 1 (حظر صلب): فاتورة مُرحَّلة دفترياً (is_posted/journal_entry_id)
--     تُمنع بنودها من أي إدراج/حذف، ومن تعديل الأعمدة المالية
--     (quantity/unit_price/discount_*/subtotal/total) — القيود لا تُكسر؛
--     التصحيح عبر مرتجع/إشعار دائن. أعمدة تتبّع التسليم
--     (delivered_qty/cost_price/updated_at...) تبقى مسموحة (مسار التسليم
--     الفعلي يحدّثها بعد الترحيل — SalesDeliveryDialog:830).
--   حارس 2 (توثيق إلزامي): أي تعديل بنود فاتورة INV-EC-% يعيد مقارنة
--     مجموع بنودها بـsubtotal الطلب، وأي تفاوت يُسجَّل تلقائياً في
--     سجل حالة الطلب (ecommerce_order_status_history) برقمَي الطرفين —
--     فلا انحراف صامتاً بعد اليوم.
--   + دالة فحص عند الطلب ecom_order_reconciliation(order_number).

BEGIN;

-- ── حارس 1: حماية الفواتير المرحّلة ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ecom_block_posted_invoice_financial_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_posted boolean;
  v_invoice text;
BEGIN
  SELECT (COALESCE(is_posted, false) OR journal_entry_id IS NOT NULL), invoice_no
    INTO v_posted, v_invoice
  FROM public.sales_transactions
  WHERE id = COALESCE(NEW.transaction_id, OLD.transaction_id);

  IF NOT COALESCE(v_posted, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('INSERT', 'DELETE') THEN
    RAISE EXCEPTION
      'الفاتورة % مُرحَّلة دفترياً — لا يمكن إضافة/حذف بنود. صحّح عبر مرتجع مبيعات أو إشعار دائن.',
      COALESCE(v_invoice, '?') USING ERRCODE = 'P0001';
  END IF;

  IF NEW.quantity        IS DISTINCT FROM OLD.quantity
  OR NEW.unit_price      IS DISTINCT FROM OLD.unit_price
  OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
  OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent
  OR NEW.subtotal        IS DISTINCT FROM OLD.subtotal
  OR NEW.total           IS DISTINCT FROM OLD.total THEN
    RAISE EXCEPTION
      'الفاتورة % مُرحَّلة دفترياً — تعديل القيم المالية للبنود ممنوع (المسموح: تتبّع التسليم فقط). صحّح عبر مرتجع/إشعار دائن.',
      COALESCE(v_invoice, '?') USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_block_posted_invoice_edits ON public.sales_transaction_items;
CREATE TRIGGER trg_zz_block_posted_invoice_edits
  BEFORE INSERT OR UPDATE OR DELETE ON public.sales_transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION public.ecom_block_posted_invoice_financial_edits();

-- ── حارس 2: توثيق تفاوت فاتورة الطلب الإلكتروني في سجل الطلب ──────────────
CREATE OR REPLACE FUNCTION public.ecom_log_invoice_divergence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice text;
  v_order record;
  v_goods numeric;
  v_note text;
  v_last text;
BEGIN
  SELECT invoice_no INTO v_invoice
  FROM public.sales_transactions
  WHERE id = COALESCE(NEW.transaction_id, OLD.transaction_id);

  IF v_invoice IS NULL OR v_invoice NOT LIKE 'INV-EC-%' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT o.id, o.tenant_id, o.status, o.subtotal INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.order_number = substring(v_invoice FROM 8);
  IF v_order.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(SUM(total), 0) INTO v_goods
  FROM public.sales_transaction_items
  WHERE transaction_id = COALESCE(NEW.transaction_id, OLD.transaction_id);

  IF abs(v_goods - COALESCE(v_order.subtotal, 0)) < 0.01 THEN
    RETURN COALESCE(NEW, OLD); -- متطابقان — لا شيء يُسجَّل
  END IF;

  v_note := format('حارس المطابقة: بنود الفاتورة %s = %s بينما إجمالي بضاعة الطلب = %s (فرق %s)',
                   v_invoice, v_goods, COALESCE(v_order.subtotal, 0),
                   v_goods - COALESCE(v_order.subtotal, 0));

  SELECT notes INTO v_last
  FROM public.ecommerce_order_status_history
  WHERE order_id = v_order.id AND event_type = 'invoice_divergence'
  ORDER BY created_at DESC LIMIT 1;
  IF v_last = v_note THEN RETURN COALESCE(NEW, OLD); END IF; -- لا تكرار

  INSERT INTO public.ecommerce_order_status_history
    (tenant_id, order_id, from_status, to_status, change_source, event_type, notes)
  VALUES
    (v_order.tenant_id, v_order.id, v_order.status, v_order.status,
     'system', 'invoice_divergence', v_note);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_log_invoice_divergence ON public.sales_transaction_items;
CREATE TRIGGER trg_zz_log_invoice_divergence
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION public.ecom_log_invoice_divergence();

-- ── دالة فحص عند الطلب ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ecom_order_reconciliation(p_order_number text)
RETURNS TABLE(
  order_total numeric, order_subtotal numeric, order_shipping numeric,
  order_paid numeric, so_total numeric, invoice_no text,
  invoice_items_total numeric, invoice_posted boolean, diagnosis text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_o record; v_so numeric; v_inv record; v_goods numeric;
BEGIN
  SELECT o.total_amount, o.subtotal, COALESCE(o.shipping_amount,0) AS ship, o.paid_amount
    INTO v_o FROM public.ecommerce_orders o WHERE o.order_number = p_order_number;
  IF v_o IS NULL THEN
    RETURN QUERY SELECT NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,
      NULL::numeric,NULL::text,NULL::numeric,NULL::boolean,'الطلب غير موجود'::text;
    RETURN;
  END IF;
  SELECT so.total_amount INTO v_so FROM public.sales_orders so
   WHERE so.order_number = 'SO-EC-' || p_order_number;
  SELECT st.id, st.invoice_no, (COALESCE(st.is_posted,false) OR st.journal_entry_id IS NOT NULL) AS posted
    INTO v_inv FROM public.sales_transactions st
   WHERE st.invoice_no = 'INV-EC-' || p_order_number;
  IF v_inv.id IS NOT NULL THEN
    SELECT COALESCE(SUM(i.total),0) INTO v_goods
    FROM public.sales_transaction_items i WHERE i.transaction_id = v_inv.id;
  END IF;
  RETURN QUERY SELECT
    v_o.total_amount, v_o.subtotal, v_o.ship, v_o.paid_amount, v_so,
    v_inv.invoice_no, v_goods, v_inv.posted,
    CASE
      WHEN v_inv.id IS NULL THEN 'لا فاتورة بعد'
      WHEN abs(COALESCE(v_goods,0) - COALESCE(v_o.subtotal,0)) < 0.01 THEN '✅ متطابق'
      ELSE format('⚠️ بنود الفاتورة %s ≠ بضاعة الطلب %s (فرق %s)',
                  v_goods, v_o.subtotal, v_goods - v_o.subtotal)
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ecom_order_reconciliation(text) TO authenticated, service_role;

-- ── توثيق التفاوت التاريخي القائم لمرة واحدة (TXO-10001) ─────────────────
DO $$
DECLARE v_r record;
BEGIN
  FOR v_r IN
    SELECT o.id, o.tenant_id, o.status, o.subtotal, st.invoice_no,
           (SELECT COALESCE(SUM(i.total),0) FROM public.sales_transaction_items i
             WHERE i.transaction_id = st.id) AS goods
    FROM public.ecommerce_orders o
    JOIN public.sales_transactions st ON st.invoice_no = 'INV-EC-' || o.order_number
  LOOP
    IF abs(v_r.goods - COALESCE(v_r.subtotal,0)) >= 0.01
       AND NOT EXISTS (SELECT 1 FROM public.ecommerce_order_status_history h
                        WHERE h.order_id = v_r.id AND h.event_type = 'invoice_divergence') THEN
      INSERT INTO public.ecommerce_order_status_history
        (tenant_id, order_id, from_status, to_status, change_source, event_type, notes)
      VALUES (v_r.tenant_id, v_r.id, v_r.status, v_r.status, 'system',
              'invoice_divergence',
              format('حارس المطابقة (توثيق تاريخي): بنود الفاتورة %s = %s بينما إجمالي بضاعة الطلب = %s (فرق %s)',
                     v_r.invoice_no, v_r.goods, COALESCE(v_r.subtotal,0),
                     v_r.goods - COALESCE(v_r.subtotal,0)));
      RAISE NOTICE 'وُثّق تفاوت تاريخي: % (بنود=% مقابل %)', v_r.invoice_no, v_r.goods, v_r.subtotal;
    END IF;
  END LOOP;
END $$;

COMMIT;
