-- ============================================================================
-- م1-قاعدة: backfill هوية الوحدة (Unit Identity Backfill)
-- ============================================================================
-- الهدف: جعل fabric_materials.base_unit_id (uuid) مصدر حقيقة وحدة المادة.
--   - نص fabric_materials.unit لا يُمَسّ إطلاقاً (الفواتير تعرضه).
--   - تعميم طقم الوحدات المرجعي (المستأجر 681aa0e4) على كل مستأجر لديه مواد
--     في fabric_materials وينقصه الطقم.
--   - ربط base_unit_id داخل units_of_measure (غير-الأساس -> أساس نفس tenant+category).
--   - backfill fabric_materials.base_unit_id عبر خريطة نص->كود.
--
-- idempotent: معاملة واحدة، قابلة لإعادة التشغيل بلا أثر جانبي.
--   قسم أ: INSERT..SELECT WHERE NOT EXISTS على (tenant, code).
--   قسم أ (ربط): UPDATE مشروط بـ base_unit_id IS NULL.
--   قسم ب: UPDATE مشروط بـ base_unit_id IS NULL.
-- ============================================================================

BEGIN;

-- المستأجر المرجعي صاحب طقم الوحدات النظيف (36 وحدة مصنّفة).
-- نعرّفه كـ CTE ثابت لتفادي إعادة كتابة الـUUID.

-- ----------------------------------------------------------------------------
-- قسم أ (1/2): تعميم طقم الوحدات المصنّفة على كل مستأجر لديه مواد وينقصه الطقم.
--   ننسخ صفوف المرجع (category IS NOT NULL) إلى كل tenant آخر له مواد،
--   بـ uuid جديدة، فقط حين لا يملك كوداً مطابقاً (WHERE NOT EXISTS).
--   لا ننسخ base_unit_id هنا (uuid المرجع لا معنى له لدى المستأجر الآخر) —
--   يُضبط في الخطوة (2/2) عبر تطابق category داخل طقم كل مستأجر.
-- ----------------------------------------------------------------------------
INSERT INTO public.units_of_measure
  (tenant_id, code, name_ar, name_en, type, conversion_factor,
   is_active, symbol, category, is_base_unit, allows_decimal)
SELECT
  t.tenant_id,
  ref.code, ref.name_ar, ref.name_en, ref.type, ref.conversion_factor,
  ref.is_active, ref.symbol, ref.category, ref.is_base_unit, ref.allows_decimal
FROM (
  -- كل مستأجر لديه مواد في fabric_materials، عدا المرجع نفسه
  SELECT DISTINCT fm.tenant_id
  FROM public.fabric_materials fm
  WHERE fm.tenant_id <> '681aa0e4-7692-4337-a3e8-2c127f80e573'::uuid
) t
CROSS JOIN (
  SELECT code, name_ar, name_en, type, conversion_factor,
         is_active, symbol, category, is_base_unit, allows_decimal
  FROM public.units_of_measure
  WHERE tenant_id = '681aa0e4-7692-4337-a3e8-2c127f80e573'::uuid
    AND category IS NOT NULL
) ref
WHERE NOT EXISTS (
  SELECT 1 FROM public.units_of_measure u
  WHERE u.tenant_id = t.tenant_id
    AND u.code = ref.code
);

-- ----------------------------------------------------------------------------
-- قسم أ (2/2): ربط base_unit_id داخل طقم كل مستأجر.
--   لكل وحدة مصنّفة ليست أساساً وينقصها الرابط: اربطها بوحدة الأساس
--   (is_base_unit) من نفس (tenant, category). يشمل المرجع نفسه (كان به 18
--   وحدة غير مربوطة) لجعل الحقل متسقاً عبر كل المستأجرين.
--   مشروط بـ base_unit_id IS NULL => idempotent.
-- ----------------------------------------------------------------------------
UPDATE public.units_of_measure u
SET base_unit_id = b.id
FROM public.units_of_measure b
WHERE u.category IS NOT NULL
  AND u.is_base_unit = false
  AND u.base_unit_id IS NULL
  AND b.tenant_id = u.tenant_id
  AND b.category = u.category
  AND b.is_base_unit = true;

-- ----------------------------------------------------------------------------
-- قسم ب: backfill fabric_materials.base_unit_id عبر خريطة نص->كود.
--   القيم الفعلية اليوم: 'متر'(75) و 'meter'(6) -> MTR.
--   نضيف مرادفات شائعة احتياطاً (تظل الخريطة idempotent وآمنة لأن الربط
--   يتطلب وجود الكود لدى نفس المستأجر؛ نص لا يُحلّ يبقى NULL).
--   لا نلمس نص unit إطلاقاً.
-- ----------------------------------------------------------------------------
WITH unit_map(unit_text, code) AS (
  VALUES
    -- طول (length)
    ('متر','MTR'), ('meter','MTR'), ('metre','MTR'), ('م','MTR'), ('m','MTR'),
    ('سنتيمتر','CM'), ('سم','CM'), ('cm','CM'),
    ('مليمتر','MM'), ('مم','MM'), ('mm','MM'),
    ('ياردة','YRD'), ('yard','YRD'), ('yrd','YRD'), ('yd','YRD'),
    ('قدم','FT'), ('foot','FT'), ('feet','FT'), ('ft','FT'),
    ('بوصة','INCH'), ('inch','INCH'), ('in','INCH'),
    -- وزن (weight)
    ('كيلوغرام','KG'), ('كيلوجرام','KG'), ('كيلو','KG'), ('كغ','KG'),
    ('كجم','KG'), ('kg','KG'), ('kilogram','KG'),
    ('غرام','GRM'), ('جرام','GRM'), ('غ','GRM'), ('g','GRM'), ('gram','GRM'),
    ('طن','TON'), ('ton','TON'),
    -- عدّ (count)
    ('قطعة','PC'), ('piece','PC'), ('pcs','PC'), ('pc','PC'),
    ('رول','ROLL'), ('رولون','ROLL'), ('roll','ROLL'),
    ('كرتونة','CTN'), ('كرتون','CTN'), ('carton','CTN'), ('ctn','CTN'),
    ('صندوق','BOX'), ('box','BOX'),
    ('زوج','PAIR'), ('pair','PAIR'),
    ('دزينة','DZN'), ('dozen','DZN'), ('dzn','DZN'),
    ('طقم','SET'), ('set','SET'),
    ('كيس','BAG'), ('bag','BAG'),
    -- حجم (volume)
    ('لتر','LTR'), ('liter','LTR'), ('litre','LTR'), ('ل','LTR'), ('l','LTR'),
    ('ميلي لتر','ML'), ('ملي لتر','ML'), ('مل','ML'), ('ml','ML')
)
UPDATE public.fabric_materials fm
SET base_unit_id = u.id
FROM unit_map m
JOIN public.units_of_measure u
  ON u.code = m.code
WHERE fm.base_unit_id IS NULL
  AND u.tenant_id = fm.tenant_id
  AND lower(btrim(fm.unit)) = lower(btrim(m.unit_text));

-- ----------------------------------------------------------------------------
-- قسم ج: فحوص ذاتية (RAISE NOTICE).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_total        int;
  v_linked       int;
  v_null         int;
  r              record;
BEGIN
  SELECT count(*), count(base_unit_id)
    INTO v_total, v_linked
    FROM public.fabric_materials;
  v_null := v_total - v_linked;

  RAISE NOTICE '[قسم ب] fabric_materials: إجمالي=%، مربوطة=%، متبقّية NULL=%',
    v_total, v_linked, v_null;

  -- الإبلاغ عن كل قيمة نصية لم تُحلّ (لم تُخمَّن).
  FOR r IN
    SELECT fm.tenant_id, fm.unit, count(*) AS n
    FROM public.fabric_materials fm
    WHERE fm.base_unit_id IS NULL
    GROUP BY fm.tenant_id, fm.unit
    ORDER BY n DESC
  LOOP
    RAISE NOTICE '[غير محلولة] tenant=% unit=% count=%', r.tenant_id, r.unit, r.n;
  END LOOP;

  -- عدد الوحدات لكل مستأجر لديه مواد.
  FOR r IN
    SELECT fm.tenant_id,
           (SELECT count(*) FROM public.units_of_measure u
             WHERE u.tenant_id = fm.tenant_id) AS unit_count,
           (SELECT count(*) FROM public.units_of_measure u
             WHERE u.tenant_id = fm.tenant_id AND u.category IS NOT NULL) AS categorized
    FROM (SELECT DISTINCT tenant_id FROM public.fabric_materials) fm
    ORDER BY fm.tenant_id
  LOOP
    RAISE NOTICE '[طقم] tenant=% وحدات=% (مصنّفة=%)',
      r.tenant_id, r.unit_count, r.categorized;
  END LOOP;
END $$;

COMMIT;
