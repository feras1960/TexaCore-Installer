-- تكملة لنظام الحذف الناعم 20260714100000: فرع القيود في «النشاط الأخير» يستثني
-- القيود المحذوفة (is_deleted) — وإلا ظهر القيد المحذوف وعكسه التلقائي باللوحة.
-- الجسم نسخة مطابقة لـ20260714001000 + شرط واحد.
-- ═══════════════════════════════════════════════════════════════════
-- النشاط الأخير: أسماء الأطراف الفارغة ("") كانت تمرّ عبر COALESCE
-- (ليست NULL) فتظهر «—» — أبرزها إشعارات التسليم المستوردة عبر RSF
-- التي تحمل customer_id صحيحاً لكن customer_name="".
-- الإصلاح: NULLIF(...,'') في كل الفروع + سقوط على اسم الطرف من جدوله
-- (customers/suppliers) عبر المعرّف عند غياب الاسم النصي المخزّن.
-- تكافؤ سحابة↔محلي: تُطبَّق على الاثنين وتُضمَّن بحزمة الـinstaller.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_dashboard_recent_activity(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH all_activity AS (
    -- 1. فواتير المبيعات
    SELECT
      si.id::text,
      'sale' as type,
      'فاتورة مبيعات' as type_label,
      si.invoice_number as doc_number,
      COALESCE(NULLIF(si.customer_name,''), NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''), 'عميل') as party_name,
      si.total_amount as amount,
      si.currency,
      si.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      si.created_at
    FROM sales_invoices si
    LEFT JOIN customers c ON c.id = si.customer_id
    LEFT JOIN user_profiles u ON u.id = si.created_by
    WHERE si.company_id = p_company_id

    UNION ALL

    -- 2. فواتير المشتريات
    SELECT
      pi.id::text,
      'purchase' as type,
      'فاتورة مشتريات' as type_label,
      pi.invoice_number as doc_number,
      COALESCE(NULLIF(pi.supplier_name,''), NULLIF(s.name_ar,''), NULLIF(s.company_name,''), NULLIF(s.name_en,''), 'مورد') as party_name,
      pi.total_amount as amount,
      pi.currency,
      pi.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      pi.created_at
    FROM purchase_invoices pi
    LEFT JOIN suppliers s ON s.id = pi.supplier_id
    LEFT JOIN user_profiles u ON u.id = pi.created_by
    WHERE pi.company_id = p_company_id

    UNION ALL

    -- 3. سندات الدفع / القبض (الطرف: مورد للدفع، عميل للقبض)
    SELECT
      pv.id::text,
      CASE WHEN pv.type = 'payment' THEN 'payment' ELSE 'receipt' END as type,
      CASE WHEN pv.type = 'payment' THEN 'سند دفع' ELSE 'سند قبض' END as type_label,
      pv.voucher_number as doc_number,
      COALESCE(
        NULLIF(pv.supplier_name,''),
        NULLIF(s.name_ar,''), NULLIF(s.company_name,''), NULLIF(s.name_en,''),
        NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''),
        ''
      ) as party_name,
      pv.amount,
      pv.currency,
      pv.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      pv.created_at
    FROM payment_vouchers pv
    LEFT JOIN suppliers s ON s.id = pv.supplier_id
    LEFT JOIN customers c ON c.id = pv.customer_id
    LEFT JOIN user_profiles u ON u.id = pv.created_by
    WHERE pv.company_id = p_company_id

    UNION ALL

    -- 4. أوامر الشراء
    SELECT
      po.id::text,
      'purchase_order' as type,
      'أمر شراء' as type_label,
      po.order_number as doc_number,
      COALESCE(NULLIF(po.supplier_name,''), NULLIF(s.name_ar,''), NULLIF(s.company_name,''), NULLIF(s.name_en,''), 'مورد') as party_name,
      po.total_amount as amount,
      po.currency,
      po.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      po.created_at
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN user_profiles u ON u.id = po.created_by
    WHERE po.company_id = p_company_id

    UNION ALL

    -- 5. أوامر البيع
    SELECT
      so.id::text,
      'sales_order' as type,
      'أمر بيع' as type_label,
      so.order_number as doc_number,
      COALESCE(NULLIF(so.customer_name,''), NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''), 'عميل') as party_name,
      so.total_amount as amount,
      so.currency,
      so.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      so.created_at
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    LEFT JOIN user_profiles u ON u.id = so.created_by
    WHERE so.company_id = p_company_id

    UNION ALL

    -- 6. إشعارات التسليم (الحالة المُبلَّغة: customer_id موجود والاسم النصي "")
    SELECT
      dn.id::text,
      'delivery' as type,
      'إذن تسليم' as type_label,
      dn.note_number as doc_number,
      COALESCE(NULLIF(dn.customer_name,''), NULLIF(c.name_ar,''), NULLIF(c.company_name,''), NULLIF(c.name_en,''), 'عميل') as party_name,
      NULL::numeric as amount,
      NULL as currency,
      dn.status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      dn.created_at
    FROM delivery_notes dn
    LEFT JOIN customers c ON c.id = dn.customer_id
    LEFT JOIN user_profiles u ON u.id = dn.created_by
    WHERE dn.company_id = p_company_id

    UNION ALL

    -- 7. القيود المحاسبية اليدوية فقط
    SELECT
      je.id::text,
      'journal' as type,
      'قيد محاسبي' as type_label,
      COALESCE(je.reference_number, je.entry_number::text) as doc_number,
      COALESCE(je.description, '') as party_name,
      je.total_debit as amount,
      je.currency,
      CASE WHEN je.is_posted THEN 'posted' ELSE 'draft' END as status,
      COALESCE(u.full_name, 'النظام') as actor_name,
      je.created_at
    FROM journal_entries je
    LEFT JOIN user_profiles u ON u.id = je.created_by
    WHERE je.company_id = p_company_id
      AND je.reference_type IS NULL
      AND COALESCE(je.is_deleted, false) = false
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'type', a.type,
      'typeLabel', a.type_label,
      'docNumber', COALESCE(a.doc_number, ''),
      'partyName', a.party_name,
      'amount', a.amount,
      'currency', a.currency,
      'status', a.status,
      'actorName', a.actor_name,
      'timestamp', to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) ORDER BY a.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM all_activity ORDER BY created_at DESC LIMIT 15
  ) a;

  RETURN v_result;
END;
$function$;
