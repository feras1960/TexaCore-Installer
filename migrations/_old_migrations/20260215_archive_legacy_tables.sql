-- ═══════════════════════════════════════════════════════════════
-- 🗄️ أرشفة الجداول القديمة — Legacy Tables Archive
-- ═══════════════════════════════════════════════════════════════
-- التاريخ: 2026-02-15
-- الغرض: تعليم الجداول القديمة كمُؤرشفة (DEPRECATED)
--         لمنع الاستخدام الخاطئ في التطوير المستقبلي
-- ═══════════════════════════════════════════════════════════════

-- ╔══════════════════════════════════════════════════╗
-- ║ تعليقات DEPRECATED على جداول المشتريات القديمة  ║
-- ╚══════════════════════════════════════════════════╝

DO $$ 
DECLARE
    t_name TEXT;
    t_comment TEXT;
    tables_to_comment JSON := '{
        "purchase_requests": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transactions (stage=draft). لا تستخدم في الكود الجديد.",
        "purchase_request_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transaction_items. لا تستخدم في الكود الجديد.",
        "purchase_quotations": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transactions (stage=quotation). لا تستخدم في الكود الجديد.",
        "purchase_quotation_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transaction_items. لا تستخدم في الكود الجديد.",
        "purchase_orders": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transactions (stage=order/approved). لا تستخدم في الكود الجديد.",
        "purchase_order_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transaction_items. لا تستخدم في الكود الجديد.",
        "purchase_invoices": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transactions (stage=invoice/posted/paid). لا تستخدم في الكود الجديد.",
        "purchase_invoice_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transaction_items. لا تستخدم في الكود الجديد.",
        "purchase_receipts": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transactions (stage=receipt). لا تستخدم في الكود الجديد.",
        "purchase_receipt_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: purchase_transaction_items. لا تستخدم في الكود الجديد.",
        "sales_quotations": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: sales_transactions (stage=quotation). لا تستخدم في الكود الجديد.",
        "sales_quotation_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: sales_transaction_items. لا تستخدم في الكود الجديد.",
        "sales_orders": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: sales_transactions (stage=order). لا تستخدم في الكود الجديد.",
        "sales_order_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: sales_transaction_items. لا تستخدم في الكود الجديد.",
        "sales_invoices": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: sales_transactions (stage=invoice/posted/paid). لا تستخدم في الكود الجديد.",
        "sales_invoice_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: sales_transaction_items. لا تستخدم في الكود الجديد.",
        "sales_delivery_notes": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: sales_transactions (stage=delivery). لا تستخدم في الكود الجديد.",
        "sales_delivery_note_items": "⛔ DEPRECATED [2026-02-15] — مُؤرشف. البديل: sales_transaction_items. لا تستخدم في الكود الجديد.",
        "purchase_transactions": "✅ ACTIVE [2026-02-15] — جدول المشتريات الموحد. سجل واحد يتنقل بين المراحل: draft → quotation → order → approved → receipt → invoice → posted → paid. يحل محل: purchase_requests, purchase_quotations, purchase_orders, purchase_invoices, purchase_receipts.",
        "purchase_transaction_items": "✅ ACTIVE [2026-02-15] — بنود المشتريات الموحدة. مرتبطة بـ purchase_transactions. يحل محل كل جداول البنود القديمة.",
        "sales_transactions": "✅ ACTIVE [2026-02-15] — جدول المبيعات الموحد. سجل واحد يتنقل بين المراحل: draft → quotation → reservation → order → delivery → invoice → posted → paid. يحل محل: sales_quotations, sales_orders, sales_invoices, sales_delivery_notes.",
        "sales_transaction_items": "✅ ACTIVE [2026-02-15] — بنود المبيعات الموحدة. مرتبطة بـ sales_transactions. يحل محل كل جداول البنود القديمة.",
        "transaction_stage_log": "✅ ACTIVE [2026-02-15] — سجل تتبع تحويلات المراحل. يسجل كل تغيير مرحلة مع التاريخ والمستخدم والملاحظات.",
        "document_sequences": "✅ ACTIVE [2026-02-15] — تسلسل ترقيم المستندات. يولّد أرقام فريدة لكل نوع مستند وشركة وسنة."
    }';
BEGIN
    FOR t_name, t_comment IN SELECT key, value FROM json_each_text(tables_to_comment) LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t_name) THEN
            EXECUTE 'COMMENT ON TABLE ' || t_name || ' IS ''' || t_comment || '''';
        END IF;
    END LOOP;
END $$;


-- ╔══════════════════════════════════════════════════╗
-- ║ التحقق من نجاح التعليقات                        ║
-- ╚══════════════════════════════════════════════════╝

SELECT 
    schemaname,
    tablename,
    CASE 
        WHEN obj_description((schemaname || '.' || tablename)::regclass) LIKE '%DEPRECATED%' THEN '⛔ ARCHIVED'
        WHEN obj_description((schemaname || '.' || tablename)::regclass) LIKE '%ACTIVE%' THEN '✅ ACTIVE'
        ELSE '❓ NO COMMENT'
    END AS status,
    LEFT(obj_description((schemaname || '.' || tablename)::regclass), 80) AS comment_preview
FROM pg_tables
WHERE schemaname = 'public'
AND (
    tablename LIKE 'purchase_%'
    OR tablename LIKE 'sales_%'
    OR tablename IN ('transaction_stage_log', 'document_sequences')
)
ORDER BY 
    CASE 
        WHEN obj_description((schemaname || '.' || tablename)::regclass) LIKE '%DEPRECATED%' THEN 2
        WHEN obj_description((schemaname || '.' || tablename)::regclass) LIKE '%ACTIVE%' THEN 1
        ELSE 3
    END,
    tablename;
