-- ════════════════════════════════════════════════════════════════════════
-- البيع المباشر الذرّي — الإصدار ٣ (صلاحية + إنفاذ واعٍ بالمخزون + قصّ جزئي للرول)
-- ════════════════════════════════════════════════════════════════════════
-- يستبدل direct_post_sale(uuid, jsonb) من 20260624d ويُسقط توقيع (uuid) القديم،
-- ليبقى توقيع واحد رسمي: direct_post_sale(p_invoice_id uuid, p_rolls jsonb DEFAULT NULL).
--
-- العلل المُصلَحة (مقابل 20260624b/d):
--   ١) لا فحص صلاحية: كان يكتفي بـ assert_can_access_company. الآن يُشترط أن
--      يجتاز المنادي (auth.uid()) صلاحية 'can_direct_sale' عبر check_special_permission
--      (تتجاوز super_admin / tenant_owner / company_owner تماماً كواجهة rbacService).
--   ٢) تسرّب الرولونات: القسم B القديم كان يخصم أي مادة غير مشتقّة من الرولونات
--      المختارة فقط — فمخزونٌ قائم كرولونات يُخصم «سائباً» بصمت وتبقى رولوناته متاحة.
--   ٣) نقص الخصم عند التغطية الجزئية: رولونات تغطي أقل من كمية البند كانت تُخصم في A
--      ويُتخطّى البند كلياً في B — فيبقى الباقي غير مخصوم بصمت.
--
-- شكل p_rolls (مُحدَّث): مصفوفة JSON عناصرها {"id": "<uuid>", "cut_length": <رقم اختياري>}.
--   دلالات القصّ:
--   • cut_length غائب/NULL أو ضمن 0.01 من current_length ⇒ بيع الرول كاملاً كما كان:
--     حركة 'sale' بكمية current_length + status→'sold'.
--   • cut_length موجود و < current_length − 0.01 ⇒ قصّ جزئي: يُتحقَّق أن
--     cut_length > 0 وأن cut_length ≤ (current_length − COALESCE(reserved_length,0)) + 0.01
--     وإلا استثناء عربي برقم الرول والأرقام؛ حركة 'sale' بكمية cut_length
--     (unit_cost = cost_per_meter كما كان) ثم current_length −= cut_length
--     مع بقاء status='available' — البقية تبقى على الرفّ.
--   • cut_length > current_length + 0.01 ⇒ استثناء (يلتقطه فحص غير المحجوز نفسه).
--   • معرّف رول مُكرَّر في p_rolls ⇒ استثناء (قصّتان لرولٍ واحد التباس).
--   الطول الفعّال لكل رول مختار (المُعتمَد في R وفي توزيع التغطية بالقسم B) =
--   cut_length عند القصّ الجزئي، وإلا current_length كاملاً.
--
-- قاعدة الإنفاذ (واعية بالمخزون — تطابق ثابتة مسار الوورك فلو autoRollService:
--   loose_stock = current_stock − Σ fabric_rolls.current_length):
--   القماش قد يوجد سائباً بحقّ، والسائب يُباع سائباً. الرولونات إلزامية فقط بقدر
--   ما يوجد المخزون فعلياً كرولونات. لكل (مادة، مستودع) على الفاتورة:
--     Q = Σ كميات بنود المادة؛ R = Σ الطول الفعّال لرولوناتها «المختارة»؛ L = Q − R.
--     • R > Q + 0.01 ⇒ استثناء (الرولونات المختارة تتجاوز المطلوب، بالأرقام).
--     • qoh = inventory_stock.quantity_on_hand للمادة/المستودع؛
--       avail_rolls = Σ current_length «الكامل» لرولونات المادة/المستودع status='available'
--       (شاملةً المختارة — الفحص يسبق قسم الخصم A).
--     • حارس السائب: L > (qoh − avail_rolls) + 0.01 ⇒ استثناء عربي واضح بالأرقام
--       (المطلوب سائباً، المتاح سائباً، الموجود كرولونات — يجب اختيار رولونات).
--       الثابتة محفوظة مع القصّ الجزئي: بعد البيع تنخفض avail_rolls بمقدار R بالضبط
--       (رول كامل يُسقط current_length كلّه بخروجه من المتاح؛ والقصّ يُنقص current_length
--       بمقدار cut_length مع بقاء الرول متاحاً) ⇒ qoh′ = qoh − Q ≥ avail_rolls − R
--       = أطوال الرولونات المتبقية بعد البيع.
--     • لا رولونات مختارة ولا رولونات موجودة ⇒ L = Q ≤ qoh (بيع سائب حر؛ حارس
--       السالب في التريغر يسند ذلك). كل المخزون رولونات بلا اختيار ⇒ استثناء. مختلط ⇒ مسموح.
--   (fabric_materials.is_roll_tracked لم يعد مفتاح الإنفاذ — المرجع هو واقع المخزون.)
--
-- الخصم:
--   • القسم A: كل رول مختار ⇒ حركة 'sale' بطوله الفعّال؛ الكامل status→'sold'،
--     والمقصوص current_length −= cut_length ويبقى 'available'.
--   • القسم B: يخصم «المتبقّي السائب» لكل البنود: تُوزَّع تغطية الرولونات R (بالأطوال
--     الفعّالة) على بنود المادة نفسها جشعاً (البند الأول يستهلك التغطية أولاً)،
--     وتُنشأ حركة 'sales_delivery' لكل بند بمتبقّيه الموجب فقط، بكلفة البند (cost_price).
--     بند مُغطّى كلياً بالرولونات ⇒ بلا حركة سائب.
--
-- تحقّق الرولونات المُمرَّرة (بلا تخطٍّ صامت): موجودة + غير مُكرَّرة + status='available'
--   + تتبع شركة الفاتورة + مادتها على الفاتورة + صلاحية cut_length إن وُجد.
--   (رول متاح مختار يُباع/يُقصّ دائماً بغضّ النظر عن is_roll_tracked.)
--
-- نموذج المخزون (كما 20260624d): حركة inventory_movements (OUT) تُشغّل
--   update_inventory_stock (خصم quantity_on_hand + حارس السالب) ثم
--   sync_material_current_stock. 'sale' و 'sales_delivery' كلاهما نوعا OUT في التريغر.
--
-- الذرّية: لا مُعالِج WHEN OTHERS يبتلع الأخطاء — أي RAISE (صلاحية/تحقّق/حارس مخزون/
--   فشل الترحيل) يُجهض المعاملة كاملةً ويصعد للمنادي برسالته. المسار الناجح فقط يُرجع JSON.
-- ════════════════════════════════════════════════════════════════════════

-- إسقاط توقيع (uuid) القديم إن بقي (20260624d أسقطه؛ نُكرّر بأمان لضمان توقيع واحد).
DROP FUNCTION IF EXISTS public.direct_post_sale(uuid);

CREATE OR REPLACE FUNCTION public.direct_post_sale(p_invoice_id uuid, p_rolls jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_trx          sales_transactions%ROWTYPE;
    v_item         RECORD;
    v_mat          RECORD;
    v_roll         RECORD;
    v_wh           uuid;
    v_post         jsonb;
    v_idx          int := 0;
    v_movement_ids uuid[] := '{}';
    v_mv_id        uuid;
    v_roll_ids     uuid[] := '{}';           -- '{}' لا NULL: يجعل ANY(...) آمناً
    v_cut_lens     numeric[] := '{}';        -- بمحاذاة v_roll_ids (NULL = رول كامل)
    v_full_ids     uuid[] := '{}';           -- الرولونات المُباعة كاملةً (status→sold)
    v_selected     numeric;                  -- R: مجموع الأطوال الفعّالة للرولونات المختارة
    v_loose        numeric;                  -- L: المتبقّي السائب المطلوب للمجموعة
    v_qoh          numeric;                  -- الرصيد الفعلي (مادة/مستودع)
    v_avail_rolls  numeric;                  -- مجموع أطوال الرولونات المتاحة (مادة/مستودع)
    v_bad          RECORD;
    v_prev_mat     uuid;                     -- للتوزيع الجشع في القسم B
    v_prev_wh      uuid;
    v_cover_left   numeric := 0;
    v_use          numeric;
    v_loose_line   numeric;
BEGIN
    -- ═══ 0) الصلاحية أولاً ═══
    -- check_special_permission تُرجع true لـ super_admin/tenant_owner/company_owner
    -- تلقائياً (فرع r.code IN)، وإلا تفحص special_permissions->>'can_direct_sale'.
    -- (نفس منطق التجاوز في src/services/rbacService.ts hasSpecialPermission.)
    IF auth.uid() IS NULL
       OR NOT public.check_special_permission(auth.uid(), 'can_direct_sale') THEN
        RAISE EXCEPTION 'ليس لديك صلاحية البيع المباشر';
    END IF;

    -- ═══ 1) قفل الفاتورة + الفحوص ═══
    SELECT * INTO v_trx FROM sales_transactions WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الفاتورة غير موجودة';
    END IF;

    PERFORM assert_can_access_company(v_trx.company_id);

    IF v_trx.is_posted = true THEN
        RAISE EXCEPTION 'الفاتورة مُرحَّلة مسبقاً';
    END IF;

    -- ═══ 2) استخراج الرولونات المختارة: {id, cut_length اختياري} (تجاهُل المفاتيح الزائدة) ═══
    IF p_rolls IS NOT NULL AND jsonb_typeof(p_rolls) = 'array' AND jsonb_array_length(p_rolls) > 0 THEN
        SELECT COALESCE(array_agg((e->>'id')::uuid), '{}'),
               COALESCE(array_agg((e->>'cut_length')::numeric), '{}')
          INTO v_roll_ids, v_cut_lens
          FROM jsonb_array_elements(p_rolls) e
         WHERE (e->>'id') IS NOT NULL;
    END IF;

    -- ═══ 3) التحقّق من صلاحية الرولونات المُمرَّرة (لا تخطٍّ صامت) ═══
    -- كل رول مُمرَّر يجب: أن يوجد، غير مُكرَّر، status='available'، يتبع شركة الفاتورة،
    -- مادته على الفاتورة، وقصّته (إن وُجدت) صالحة. أول مخالفة ⇒ استثناء برسالة مُحدَّدة.
    -- (رول متاح مختار يُباع/يُقصّ دائماً — لا اشتراط على is_roll_tracked.)
    IF array_length(v_roll_ids, 1) IS NOT NULL AND array_length(v_roll_ids, 1) > 0 THEN
        -- رولونات مطلوبة لكنها غير موجودة أصلاً
        FOR v_bad IN
            SELECT x.rid
            FROM unnest(v_roll_ids) AS x(rid)
            LEFT JOIN fabric_rolls fr ON fr.id = x.rid
            WHERE fr.id IS NULL
            LIMIT 1
        LOOP
            RAISE EXCEPTION 'رول غير موجود: %', v_bad.rid;
        END LOOP;

        -- معرّف رول مُكرَّر (قصّتان لرول واحد = التباس ⇒ رفض)
        FOR v_bad IN
            SELECT x.rid
            FROM unnest(v_roll_ids) AS x(rid)
            GROUP BY x.rid
            HAVING count(*) > 1
            LIMIT 1
        LOOP
            RAISE EXCEPTION 'الرول % مُكرَّر في القائمة المُمرَّرة', v_bad.rid;
        END LOOP;

        -- رول لا يتبع شركة الفاتورة
        FOR v_bad IN
            SELECT fr.id AS rid
            FROM fabric_rolls fr
            WHERE fr.id = ANY(v_roll_ids)
              AND fr.company_id IS DISTINCT FROM v_trx.company_id
            LIMIT 1
        LOOP
            RAISE EXCEPTION 'الرول % لا يتبع شركة الفاتورة', v_bad.rid;
        END LOOP;

        -- رول غير متاح (مُباع/مُسلَّم/محجوز…)
        FOR v_bad IN
            SELECT fr.id AS rid, COALESCE(fr.status, '') AS st
            FROM fabric_rolls fr
            WHERE fr.id = ANY(v_roll_ids)
              AND COALESCE(fr.status, '') <> 'available'
            LIMIT 1
        LOOP
            RAISE EXCEPTION 'الرول % غير متاح (الحالة: %)', v_bad.rid, v_bad.st;
        END LOOP;

        -- رول مادته ليست على الفاتورة
        FOR v_bad IN
            SELECT fr.id AS rid
            FROM fabric_rolls fr
            WHERE fr.id = ANY(v_roll_ids)
              AND NOT EXISTS (
                  SELECT 1 FROM sales_transaction_items sti
                  WHERE sti.transaction_id = p_invoice_id
                    AND sti.material_id = fr.material_id
              )
            LIMIT 1
        LOOP
            RAISE EXCEPTION 'الرول % لمادة غير موجودة على الفاتورة', v_bad.rid;
        END LOOP;

        -- صلاحية القصّ: cut_length (غير الكامل) يجب أن يكون > 0
        -- و ≤ (current_length − reserved_length) + 0.01 — يلتقط أيضاً تجاوز الطول كلّه.
        FOR v_bad IN
            SELECT fr.roll_number AS rno,
                   COALESCE(fr.current_length, 0)  AS cur,
                   COALESCE(fr.reserved_length, 0) AS rsv,
                   s.cut_len
            FROM unnest(v_roll_ids, v_cut_lens) AS s(rid, cut_len)
            JOIN fabric_rolls fr ON fr.id = s.rid
            WHERE s.cut_len IS NOT NULL
              AND abs(s.cut_len - COALESCE(fr.current_length, 0)) > 0.01   -- ليس بيعاً كاملاً
              AND (s.cut_len <= 0
                   OR s.cut_len > (COALESCE(fr.current_length, 0) - COALESCE(fr.reserved_length, 0)) + 0.01)
            LIMIT 1
        LOOP
            RAISE EXCEPTION 'طول القصّة % من الرول % غير صالح: الطول الحالي %، المحجوز %، المتاح للقصّ %',
                v_bad.cut_len, v_bad.rno, v_bad.cur, v_bad.rsv, (v_bad.cur - v_bad.rsv);
        END LOOP;
    END IF;

    -- ═══ 4) الإنفاذ الواعي بالمخزون لكل (مادة، مستودع) على الفاتورة ═══
    -- المرجع واقع المخزون لا is_roll_tracked:
    --   Q = مجموع كميات البنود، R = مجموع «الأطوال الفعّالة» للرولونات المختارة
    --   (cut_length عند القصّ، وإلا current_length)، L = Q − R.
    --   • R > Q + 0.01 ⇒ تجاوز.
    --   • L > (qoh − avail_rolls) + 0.01 ⇒ السائب غير كافٍ (يجب اختيار رولونات).
    -- الفحص يسبق أي خصم، فـ avail_rolls تشمل الرولونات المختارة (ما زالت 'available'
    -- وأطوالها كاملة). الثابتة بعد البيع: avail_rolls تنخفض بمقدار R بالضبط
    -- (كامل ⇒ يخرج بطوله كلّه؛ مقصوص ⇒ ينقص طوله بمقدار cut_length ويبقى متاحاً)
    -- ⇒ qoh′ = qoh − Q ≥ avail_rolls − R = أطوال الرولونات المتبقية.
    FOR v_mat IN
        SELECT sti.material_id AS mid,
               COALESCE(sti.warehouse_id, v_trx.stock_warehouse_id, v_trx.warehouse_id) AS wh,
               COALESCE(NULLIF(fm.name_ar, ''), NULLIF(fm.name_en, ''), fm.code,
                        sti.material_id::text) AS mat_name,
               SUM(COALESCE(sti.quantity, 0)) AS req_qty
        FROM sales_transaction_items sti
        LEFT JOIN fabric_materials fm ON fm.id = sti.material_id
        WHERE sti.transaction_id = p_invoice_id
          AND sti.material_id IS NOT NULL
          AND COALESCE(sti.quantity, 0) > 0
        GROUP BY sti.material_id,
                 COALESCE(sti.warehouse_id, v_trx.stock_warehouse_id, v_trx.warehouse_id),
                 fm.name_ar, fm.name_en, fm.code
    LOOP
        IF v_mat.wh IS NULL THEN
            RAISE EXCEPTION 'لا يوجد مستودع للبند (مادة %)', v_mat.mid;
        END IF;

        -- R: الأطوال الفعّالة للرولونات المختارة لهذه المادة في هذا المستودع
        SELECT COALESCE(SUM(
                 CASE WHEN s.cut_len IS NULL
                           OR abs(s.cut_len - COALESCE(fr.current_length, 0)) <= 0.01
                      THEN COALESCE(fr.current_length, 0)
                      ELSE s.cut_len END), 0)
          INTO v_selected
          FROM unnest(v_roll_ids, v_cut_lens) AS s(rid, cut_len)
          JOIN fabric_rolls fr ON fr.id = s.rid
         WHERE fr.material_id = v_mat.mid
           AND COALESCE(fr.warehouse_id, v_mat.wh) = v_mat.wh;

        -- تجاوز: الرولونات المختارة أكثر من المطلوب
        IF v_selected > v_mat.req_qty + 0.01 THEN
            RAISE EXCEPTION 'الرولونات المختارة للمادة «%» تتجاوز الكمية المطلوبة: مجموع الرولونات % > المطلوب %',
                v_mat.mat_name, v_selected, v_mat.req_qty;
        END IF;

        v_loose := v_mat.req_qty - v_selected;   -- L: ما سيُخصم سائباً

        -- الرصيد الفعلي والرولونات المتاحة (شاملةً المختارة، بأطوالها الكاملة)
        SELECT COALESCE(SUM(quantity_on_hand), 0) INTO v_qoh
          FROM inventory_stock
         WHERE material_id = v_mat.mid AND warehouse_id = v_mat.wh;

        SELECT COALESCE(SUM(COALESCE(current_length, 0)), 0) INTO v_avail_rolls
          FROM fabric_rolls
         WHERE material_id = v_mat.mid
           AND warehouse_id = v_mat.wh
           AND COALESCE(status, '') = 'available';

        -- حارس السائب: L ≤ qoh − avail_rolls (سماحية 0.01)
        IF v_loose > (v_qoh - v_avail_rolls) + 0.01 THEN
            RAISE EXCEPTION 'المخزون السائب غير كافٍ للمادة «%»: المطلوب سائباً %، المتاح سائباً %، الموجود كرولونات % — يجب اختيار رولونات لتغطية الفارق',
                v_mat.mat_name, v_loose, (v_qoh - v_avail_rolls), v_avail_rolls;
        END IF;
    END LOOP;

    -- ═══ A) خصم الرولونات المختارة (حركة 'sale' بالطول الفعّال لكل رول) ═══
    -- كامل ⇒ status→'sold'؛ قصّ جزئي ⇒ current_length −= cut_length ويبقى 'available'.
    IF array_length(v_roll_ids, 1) IS NOT NULL AND array_length(v_roll_ids, 1) > 0 THEN
        FOR v_roll IN
            SELECT fr.id, fr.material_id, fr.warehouse_id,
                   COALESCE(fr.cost_per_meter, 0) AS cpm,
                   s.cut_len,
                   (s.cut_len IS NOT NULL
                        AND s.cut_len < COALESCE(fr.current_length, 0) - 0.01) AS is_partial,
                   CASE WHEN s.cut_len IS NULL
                             OR abs(s.cut_len - COALESCE(fr.current_length, 0)) <= 0.01
                        THEN COALESCE(fr.current_length, 0)
                        ELSE s.cut_len END AS eff
            FROM unnest(v_roll_ids, v_cut_lens) AS s(rid, cut_len)
            JOIN fabric_rolls fr ON fr.id = s.rid
            ORDER BY fr.id
        LOOP
            v_idx := v_idx + 1;
            v_wh := COALESCE(v_roll.warehouse_id, v_trx.stock_warehouse_id, v_trx.warehouse_id);
            IF v_wh IS NULL THEN
                RAISE EXCEPTION 'لا يوجد مستودع للرول %', v_roll.id;
            END IF;

            INSERT INTO inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                material_id, roll_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by
            ) VALUES (
                v_trx.tenant_id, v_trx.company_id,
                'SOUT-' || LEFT(p_invoice_id::text, 8) || '-R' || v_idx,
                CURRENT_DATE, 'sale',
                v_roll.material_id, v_roll.id, v_wh, v_roll.eff, v_roll.cpm, v_roll.cpm * v_roll.eff,
                'sale_invoice', p_invoice_id, COALESCE(v_trx.invoice_no, v_trx.draft_no),
                CASE WHEN v_roll.is_partial THEN 'بيع مباشر — قصّ جزئي من رول'
                     ELSE 'بيع مباشر — إخراج رول كامل' END,
                auth.uid()
            ) RETURNING id INTO v_mv_id;
            v_movement_ids := array_append(v_movement_ids, v_mv_id);

            IF v_roll.is_partial THEN
                -- البقية تبقى على الرفّ متاحةً
                UPDATE fabric_rolls
                   SET current_length = current_length - v_roll.cut_len,
                       updated_at = NOW()
                 WHERE id = v_roll.id;
            ELSE
                v_full_ids := array_append(v_full_ids, v_roll.id);
            END IF;
        END LOOP;

        -- إخراج الرولونات الكاملة من المتاح
        IF array_length(v_full_ids, 1) IS NOT NULL AND array_length(v_full_ids, 1) > 0 THEN
            UPDATE fabric_rolls
               SET status = 'sold', updated_at = NOW()
             WHERE id = ANY(v_full_ids);
        END IF;
    END IF;

    -- ═══ B) خصم «المتبقّي السائب» لكل البنود (حركة 'sales_delivery') ═══
    -- تُوزَّع تغطية الرولونات R (بالأطوال الفعّالة) على بنود المادة نفسها (لكل مادة/مستودع)
    -- جشعاً: البند الأول يستهلك التغطية أولاً؛ حركة سائب فقط للمتبقّي الموجب لكل بند،
    -- بكلفة البند. بند مُغطّى كلياً ⇒ بلا حركة.
    -- ملاحظة صحّة بعد القسم A: القصّ الجزئي خفّض current_length فعلاً، لكن تعبير CASE
    -- أدناه يبقى صحيحاً — عند القصّ يُرجِع cut_len مباشرةً (وفرع «الكامل» يُرجع القيمة
    -- ذاتها عندما يتصادف تساوي cut_len مع الطول المتبقي)، وعند البيع الكامل
    -- current_length لم يتغيّر أصلاً (تغيّر status فقط).
    v_prev_mat := NULL;
    v_prev_wh  := NULL;
    FOR v_item IN
        SELECT sti.id, sti.material_id, sti.quantity,
               COALESCE(sti.cost_price, 0) AS cost_price,
               COALESCE(sti.warehouse_id, v_trx.stock_warehouse_id, v_trx.warehouse_id) AS wh,
               sti.line_number
        FROM sales_transaction_items sti
        WHERE sti.transaction_id = p_invoice_id
          AND sti.material_id IS NOT NULL
          AND COALESCE(sti.quantity, 0) > 0
        ORDER BY sti.material_id,
                 COALESCE(sti.warehouse_id, v_trx.stock_warehouse_id, v_trx.warehouse_id),
                 sti.line_number, sti.id
    LOOP
        IF v_item.wh IS NULL THEN
            RAISE EXCEPTION 'لا يوجد مستودع للبند (مادة %)', v_item.material_id;
        END IF;

        -- تغطية جديدة عند تبدّل (المادة، المستودع)
        IF v_prev_mat IS DISTINCT FROM v_item.material_id
           OR v_prev_wh IS DISTINCT FROM v_item.wh THEN
            SELECT COALESCE(SUM(
                     CASE WHEN s.cut_len IS NULL
                               OR abs(s.cut_len - COALESCE(fr.current_length, 0)) <= 0.01
                          THEN COALESCE(fr.current_length, 0)
                          ELSE s.cut_len END), 0)
              INTO v_cover_left
              FROM unnest(v_roll_ids, v_cut_lens) AS s(rid, cut_len)
              JOIN fabric_rolls fr ON fr.id = s.rid
             WHERE fr.material_id = v_item.material_id
               AND COALESCE(fr.warehouse_id, v_item.wh) = v_item.wh;
            v_prev_mat := v_item.material_id;
            v_prev_wh  := v_item.wh;
        END IF;

        v_use        := LEAST(v_cover_left, v_item.quantity);
        v_cover_left := v_cover_left - v_use;
        v_loose_line := v_item.quantity - v_use;

        CONTINUE WHEN v_loose_line <= 0.01;    -- مُغطّى كلياً بالرولونات

        v_idx := v_idx + 1;
        INSERT INTO inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            material_id, from_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by
        ) VALUES (
            v_trx.tenant_id, v_trx.company_id,
            'SOUT-' || LEFT(p_invoice_id::text, 8) || '-' || v_idx,
            CURRENT_DATE, 'sales_delivery',
            v_item.material_id, v_item.wh, v_loose_line, v_item.cost_price,
            v_item.cost_price * v_loose_line,
            'sale_invoice', p_invoice_id, COALESCE(v_trx.invoice_no, v_trx.draft_no),
            'بيع مباشر — خصم سائب', auth.uid()
        ) RETURNING id INTO v_mv_id;
        v_movement_ids := array_append(v_movement_ids, v_mv_id);
    END LOOP;

    -- ═══ C) الترحيل المحاسبي (إيراد + ضريبة + COGS + ذمم) — ذرّي ═══
    v_post := post_sales_invoice(p_invoice_id);
    IF NOT COALESCE((v_post->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'فشل الترحيل المحاسبي: %', COALESCE(v_post->>'error', 'غير معروف');
    END IF;

    -- ═══ D) وسم التسليم + ربط الحركة ═══
    UPDATE sales_transactions
       SET delivered_at = NOW(),
           delivery_confirmed_at = NOW(),
           delivery_confirmed_by = auth.uid(),
           stock_movement_id = COALESCE(v_movement_ids[1], stock_movement_id)
     WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'movement_ids', to_jsonb(v_movement_ids),
        'rolls_sold', COALESCE(array_length(v_full_ids, 1), 0),
        'rolls_cut', COALESCE(array_length(v_roll_ids, 1), 0) - COALESCE(array_length(v_full_ids, 1), 0),
        'posting', v_post
    );
END;
$function$;

COMMENT ON FUNCTION public.direct_post_sale(uuid, jsonb) IS
    'بيع مباشر ذرّي (v3): صلاحية can_direct_sale + إنفاذ واعٍ بالمخزون (الرولونات إلزامية بقدر وجود المخزون كرولونات؛ السائب يُباع سائباً) + قصّ جزئي للرول (cut_length) + توزيع جشع للتغطية على البنود + post_sales_invoice في معاملة واحدة';

GRANT EXECUTE ON FUNCTION public.direct_post_sale(uuid, jsonb) TO authenticated, service_role;
