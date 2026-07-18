-- تكافؤ مخطط: قيد FK بين payment_vouchers.purchase_invoice_id و purchase_invoices
-- موجود سحابياً وغائب بالنسخة المحلية ⇒ embed PostgREST
-- (invoice:purchase_invoices!purchase_invoice_id) يفشل PGRST200 وقائمة المدفوعات
-- ترجع 400 فتظهر فارغة. دفاعي: يتخطى إن وُجد القيد، ويصفّر المراجع اليتيمة أولاً.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.payment_vouchers'::regclass
          AND contype = 'f'
          AND conname = 'payment_vouchers_purchase_invoice_id_fkey'
    ) THEN
        -- تنظيف أي مراجع يتيمة كي لا يفشل إنشاء القيد
        UPDATE public.payment_vouchers pv
        SET purchase_invoice_id = NULL
        WHERE purchase_invoice_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.purchase_invoices pi WHERE pi.id = pv.purchase_invoice_id);

        ALTER TABLE public.payment_vouchers
            ADD CONSTRAINT payment_vouchers_purchase_invoice_id_fkey
            FOREIGN KEY (purchase_invoice_id) REFERENCES public.purchase_invoices(id);
    END IF;
END $$;

-- إشعار PostgREST بإعادة تحميل مخططه (يلتقط الـFK للembed فوراً)
NOTIFY pgrst, 'reload schema';
