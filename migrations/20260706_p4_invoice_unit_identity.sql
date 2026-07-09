-- ════════════════════════════════════════════════════════════════
-- م4 — هوية الوحدة في جداول بنود الفواتير (Invoice Unit Identity)
-- ════════════════════════════════════════════════════════════════
-- الهدف: تزويد بنود فواتير البيع/الشراء بأعمدة هوية الوحدة اللازمة
-- لتفعيل التحويل في أثر المخزون (المرحلة 4). الجدولان اليوم يحملان
-- عمود `unit` النصّي فقط بلا هوية uuid ولا توثيق للكمية الأساس/وحدة
-- المستند البديلة.
--
-- الأعمدة المُضافة (كلها nullable — لا تكسر أي إدراج قائم):
--   • unit_id            uuid → units_of_measure(id)   هوية وحدة المستند
--   • base_quantity      numeric                        الكمية بوحدة الأساس
--   • secondary_quantity numeric                        كمية وحدة المستند البديلة (توثيق)
--   • secondary_unit_id  uuid → units_of_measure(id)   وحدة المستند البديلة (توثيق)
--
-- idempotent: معاملة واحدة، كل عمود بـADD COLUMN IF NOT EXISTS، وكل قيد
-- FK يُضاف فقط إن لم يكن موجوداً (فحص pg_constraint). إعادة التشغيل بلا أثر.
-- ⚠️ pg_catalog فقط — لا information_schema.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ─── sales_transaction_items ───
ALTER TABLE public.sales_transaction_items
  ADD COLUMN IF NOT EXISTS unit_id            uuid,
  ADD COLUMN IF NOT EXISTS base_quantity      numeric,
  ADD COLUMN IF NOT EXISTS secondary_quantity numeric,
  ADD COLUMN IF NOT EXISTS secondary_unit_id  uuid;

-- ─── purchase_transaction_items ───
ALTER TABLE public.purchase_transaction_items
  ADD COLUMN IF NOT EXISTS unit_id            uuid,
  ADD COLUMN IF NOT EXISTS base_quantity      numeric,
  ADD COLUMN IF NOT EXISTS secondary_quantity numeric,
  ADD COLUMN IF NOT EXISTS secondary_unit_id  uuid;

-- ─── قيود FK (تُضاف مرة واحدة فقط؛ فحص pg_constraint بالاسم) ───
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      ('sales_transaction_items',    'stx_items_unit_id_fkey',           'unit_id'),
      ('sales_transaction_items',    'stx_items_secondary_unit_id_fkey', 'secondary_unit_id'),
      ('purchase_transaction_items', 'ptx_items_unit_id_fkey',           'unit_id'),
      ('purchase_transaction_items', 'ptx_items_secondary_unit_id_fkey', 'secondary_unit_id')
    ) AS v(tbl, conname, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
      WHERE ns.nspname = 'public'
        AND t.relname = r.tbl
        AND c.conname = r.conname
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
        || 'REFERENCES public.units_of_measure(id) ON DELETE SET NULL',
        r.tbl, r.conname, r.col
      );
      RAISE NOTICE 'أُضيف قيد FK: %.% (%)', r.tbl, r.conname, r.col;
    ELSE
      RAISE NOTICE 'قيد FK موجود مسبقاً — تُخطّي: %.%', r.tbl, r.conname;
    END IF;
  END LOOP;
END $$;

-- ─── فحص ذاتي: تأكيد وجود الأعمدة الأربعة في كلا الجدولين ───
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t.relname || '.' || col.attname, ', ')
    INTO v_missing
  FROM (VALUES ('unit_id'), ('base_quantity'), ('secondary_quantity'), ('secondary_unit_id')) AS want(attname)
  CROSS JOIN (VALUES ('sales_transaction_items'), ('purchase_transaction_items')) AS tb(relname)
  LEFT JOIN pg_class t ON t.relname = tb.relname
  LEFT JOIN pg_namespace ns ON ns.oid = t.relnamespace AND ns.nspname = 'public'
  LEFT JOIN pg_attribute col ON col.attrelid = t.oid AND col.attname = want.attname
       AND col.attnum > 0 AND NOT col.attisdropped
  WHERE col.attname IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'أعمدة ناقصة بعد الترحيل: %', v_missing;
  END IF;
  RAISE NOTICE '✅ كل الأعمدة الأربعة موجودة في الجدولين.';
END $$;

COMMIT;
