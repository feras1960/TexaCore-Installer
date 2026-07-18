-- ════════════════════════════════════════════════════════════════════════
-- إصلاح FK استلام المشتريات: purchase_receipts.invoice_id → purchase_transactions
-- ════════════════════════════════════════════════════════════════════════
-- اكتشاف من حملة التحقق الشامل بالواجهة (2026-07-15): إتمام إذن الاستلام (GRN)
-- المرتبط بفاتورة شراء كان يفشل دائماً بـ:
--   «violates foreign key constraint purchase_receipts_invoice_id_fkey»
-- لأن القيد يشير لجدول purchase_invoices القديم الميت، بينما الفواتير الحيّة في
-- purchase_transactions (نفس فئة علّة sales_returns.invoice_id → sales_invoices
-- الموثقة في UNIFICATION_PLAN). جدول purchase_receipts كان فارغاً تماماً (0 صفوف)
-- على الحيّة — أي أن استلام GRN بالفواتير لم يكتمل قط.
--
-- الإصلاح: إعادة توجيه القيد إلى purchase_transactions(id) مع ON DELETE SET NULL
-- (الإذن يبقى أثراً مخزنياً حتى لو حُذفت الفاتورة/عُكست).
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.purchase_receipts
    DROP CONSTRAINT IF EXISTS purchase_receipts_invoice_id_fkey;

ALTER TABLE public.purchase_receipts
    ADD CONSTRAINT purchase_receipts_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.purchase_transactions(id)
    ON DELETE SET NULL;

COMMENT ON CONSTRAINT purchase_receipts_invoice_id_fkey ON public.purchase_receipts IS
    'أُعيد توجيهه من purchase_invoices الميت إلى purchase_transactions (20260714d) — كان يمنع إتمام أذون الاستلام كلياً';
