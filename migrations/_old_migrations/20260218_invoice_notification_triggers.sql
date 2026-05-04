-- ═══════════════════════════════════════════════════════════════
-- 🧾 INVOICE STATUS NOTIFICATION TRIGGERS
-- Feb 18, 2026
-- ✅ EXECUTED SUCCESSFULLY
--
-- Notifies invoice creator when status changes
-- Covers: purchase_invoices + sales_invoices
-- ═══════════════════════════════════════════════════════════════

-- ─── Purchase Invoice Trigger ──────────────────────────────
CREATE OR REPLACE FUNCTION fn_purchase_invoice_notification()
RETURNS TRIGGER AS $$
DECLARE
    status_ar TEXT; status_en TEXT; notif_type TEXT; v_invoice_num TEXT;
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
    IF NEW.created_by IS NULL THEN RETURN NEW; END IF;
    v_invoice_num := COALESCE(NEW.invoice_number, 'N/A');
    
    status_ar := CASE NEW.status
        WHEN 'draft' THEN 'مسودة' WHEN 'pending' THEN 'بانتظار الموافقة'
        WHEN 'approved' THEN 'تمت الموافقة' WHEN 'confirmed' THEN 'مؤكدة'
        WHEN 'posted' THEN 'مرحّلة' WHEN 'paid' THEN 'مدفوعة'
        WHEN 'partial_paid' THEN 'مدفوعة جزئياً' WHEN 'cancelled' THEN 'ملغاة'
        WHEN 'rejected' THEN 'مرفوضة' ELSE NEW.status END;
    
    status_en := CASE NEW.status
        WHEN 'draft' THEN 'Draft' WHEN 'pending' THEN 'Pending Approval'
        WHEN 'approved' THEN 'Approved' WHEN 'confirmed' THEN 'Confirmed'
        WHEN 'posted' THEN 'Posted' WHEN 'paid' THEN 'Paid'
        WHEN 'partial_paid' THEN 'Partially Paid' WHEN 'cancelled' THEN 'Cancelled'
        WHEN 'rejected' THEN 'Rejected' ELSE NEW.status END;
    
    notif_type := CASE 
        WHEN NEW.status IN ('approved','posted','paid') THEN 'success'
        WHEN NEW.status IN ('cancelled','rejected') THEN 'error'
        WHEN NEW.status = 'pending' THEN 'warning' ELSE 'info' END;
    
    INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
    VALUES (
        NEW.company_id, NEW.created_by,
        'فاتورة مشتريات ' || v_invoice_num || ' — ' || status_ar || ' | Purchase Invoice ' || v_invoice_num || ' — ' || status_en,
        'حالة فاتورة المشتريات تغيرت إلى: ' || status_ar || ' | Purchase invoice status changed to: ' || status_en,
        notif_type, 'purchase_invoice', NEW.id,
        jsonb_build_object('invoice_number', v_invoice_num, 'old_status', OLD.status, 'new_status', NEW.status, 'status_label_ar', status_ar, 'status_label_en', status_en)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_purchase_invoice_notification ON purchase_invoices;
CREATE TRIGGER trg_purchase_invoice_notification
    AFTER UPDATE OF status ON purchase_invoices
    FOR EACH ROW EXECUTE FUNCTION fn_purchase_invoice_notification();

-- ─── Sales Invoice Trigger ──────────────────────────────
CREATE OR REPLACE FUNCTION fn_sales_invoice_notification()
RETURNS TRIGGER AS $$
DECLARE
    status_ar TEXT; status_en TEXT; notif_type TEXT; v_invoice_num TEXT;
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
    IF NEW.created_by IS NULL THEN RETURN NEW; END IF;
    v_invoice_num := COALESCE(NEW.invoice_number, 'N/A');
    
    status_ar := CASE NEW.status
        WHEN 'draft' THEN 'مسودة' WHEN 'pending' THEN 'بانتظار الموافقة'
        WHEN 'approved' THEN 'تمت الموافقة' WHEN 'confirmed' THEN 'مؤكدة'
        WHEN 'posted' THEN 'مرحّلة' WHEN 'paid' THEN 'مدفوعة'
        WHEN 'partial_paid' THEN 'مدفوعة جزئياً' WHEN 'cancelled' THEN 'ملغاة'
        WHEN 'rejected' THEN 'مرفوضة' WHEN 'delivered' THEN 'تم التسليم'
        ELSE NEW.status END;
    
    status_en := CASE NEW.status
        WHEN 'draft' THEN 'Draft' WHEN 'pending' THEN 'Pending Approval'
        WHEN 'approved' THEN 'Approved' WHEN 'confirmed' THEN 'Confirmed'
        WHEN 'posted' THEN 'Posted' WHEN 'paid' THEN 'Paid'
        WHEN 'partial_paid' THEN 'Partially Paid' WHEN 'cancelled' THEN 'Cancelled'
        WHEN 'rejected' THEN 'Rejected' WHEN 'delivered' THEN 'Delivered'
        ELSE NEW.status END;
    
    notif_type := CASE 
        WHEN NEW.status IN ('approved','posted','paid','delivered') THEN 'success'
        WHEN NEW.status IN ('cancelled','rejected') THEN 'error'
        WHEN NEW.status = 'pending' THEN 'warning' ELSE 'info' END;
    
    INSERT INTO notifications (tenant_id, user_id, title, body, type, source_type, source_id, metadata)
    VALUES (
        NEW.company_id, NEW.created_by,
        'فاتورة مبيعات ' || v_invoice_num || ' — ' || status_ar || ' | Sales Invoice ' || v_invoice_num || ' — ' || status_en,
        'حالة فاتورة المبيعات تغيرت إلى: ' || status_ar || ' | Sales invoice status changed to: ' || status_en,
        notif_type, 'sales_invoice', NEW.id,
        jsonb_build_object('invoice_number', v_invoice_num, 'old_status', OLD.status, 'new_status', NEW.status, 'status_label_ar', status_ar, 'status_label_en', status_en)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sales_invoice_notification ON sales_invoices;
CREATE TRIGGER trg_sales_invoice_notification
    AFTER UPDATE OF status ON sales_invoices
    FOR EACH ROW EXECUTE FUNCTION fn_sales_invoice_notification();
