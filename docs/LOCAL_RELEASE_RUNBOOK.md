# مسار الإصدار المحلي الشامل (Local Release Runbook)

الغرض: بناء نسخة `.dmg` محلية واحدة تجمع **كل** تحديثات الواجهة + هجرات قاعدة البيانات الجديدة، بحيث تُطبَّق الهجرات تلقائياً وبأمان عند أول تشغيل على جهاز فيه نسخة سابقة (**مسار الترقية**). هذا ليس مجرد `electron-builder --mac` — الجزء الحرج هو **تجميع الهجرات + فحص idempotency + تكييف السحابية للمحلي + إثبات مسار الترقية**.

## المسارات الثابتة (لا تُشتق من جديد)
- **ERP dev copy** (مصدر الحقيقة للفرونت إند، ليس git): `/Users/firas/Desktop/TexaCore_Dev_Core/erpsystem-supabase`
- **مصدر الهجرات**: `<dev>/supabase/migrations/*.sql`
- **الـinstaller** (سيملنك): `<dev>/texacore-installer` → `.../scratchpad/installer` (ريبو git: `feras1960/TexaCore-Installer`)
- **المانيفست**: `<installer>/migrations/migrations.json` + ملفات `<installer>/migrations/*.sql`
- **psql المضمّن**: `/Applications/TexaCore ERP.app/Contents/Resources/bin/pg/bin/psql`
- **القاعدة المحلية**: `-p 54322 -h localhost -U postgres -d postgres`
- **القاعدة السحابية**: `DATABASE_URL` من `<dev>/.env.local` (للمقارنة فقط — لا تُطبَّق هجرات محلية على السحابة)
- **مخرج الـdmg**: `<installer>/dist/TexaCore-ERP-<version>-arm64.dmg`

---

## المرحلة 0 — التزامن قبل البدء
1. تأكد أن **كل الفرونت إند مدفوع سحابياً** ومتطابق (ERP repo = origin/main). النسخة المحلية تُبنى من نفس نسخة العمل، فأي تحديث واجهة غير مدفوع يجب أن يُدفع أولاً (أو على الأقل يكون في نسخة العمل التي ستُبنى منها).
2. `cd <dev> && npx tsc --noEmit 2>&1 | grep -c "error TS"` — يجب أن يكون على خط الأساس المعروف (حالياً 0). لا تبنِ فوق أخطاء نوع.

## المرحلة 1 — تجميع الهجرات الجديدة (الجزء الحرج)
### 1أ. اكتشف المفقود
قارن ملفات المصدر بالمانيفست:
```
python3 -c "
import json,os
m=json.load(open('<installer>/migrations/migrations.json')); migs=m if isinstance(m,list) else m['migrations']
key='file' if 'file' in migs[0] else 'name'
names={x[key] for x in migs}
dev={f for f in os.listdir('<dev>/supabase/migrations') if f.endswith('.sql')}
print('last order:', max(x.get('order',0) for x in migs))
[print(x) for x in sorted(dev-names)]
"
```
### 1ب. اختر ما يُشحن (حكم مطلوب — لا تجمّع الكل أعمى)
الـinstaller **يشحن مجموعة ERP منتقاة فقط**، لا كل هجرات السحابة. **استبعد** هجرات: `nexa*`, `pbx*`, `ptt*`, `eq_*`, `ecom*`, `olena*`, `eurofix*`, `cashback*`, `widget*`, `call*`/`ivr*`/`trunk*`, `agent*`/`bot*`, `chat_*`, `conv_*`, `*_conversation*`, `platform_number*`, `website*`, `github_backup*` — هذه ميزات سحابية بحتة (نيكسا لايف/PBX/المتجر/الاتصالات) لا تعمل ولا تلزم محلياً.
**اشحن**: `*manufacturing*`, `*_p0/p1/p2/p3/p4_*`, `free_plan*`, `wizard_fiscal*`, `roll_movements_rls`, `direct_post_*`, `module_registry*`, `plans_canonicalize*`, `notify_version*`, وأي ERP نواة (محاسبة/مخزون/مشتريات/مبيعات).
### 1ج. انسخ + أضِف للمانيفست
انسخ ملفات .sql المختارة إلى `<installer>/migrations/`، وأضف مدخلاً لكل واحدة بنفس شكل المدخلات الموجودة (افحصها: عادةً `{order, file, name}`) بترتيب **order تصاعدي زمني** يلي آخر order.
### 1د. ⚠️ Idempotency + تكييف المحلي (الدرس المكلف)
اقرأ كل ملف. القاعدة: **الرانر يعيد تنفيذ أي هجرة غير مسجلة بـ`_texacore_migrations`** — وكثير من هجرات جهاز فراس مطبَّقة يدوياً وغير مسجلة، فستُعاد. لذا كل هجرة تُشحن **يجب أن تكون idempotent**:
- `CREATE OR REPLACE` / `ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS` ثم `CREATE POLICY` / `CREATE TABLE IF NOT EXISTS` / `DROP … IF EXISTS` قبل `ADD CONSTRAINT`.
- إن وُجدت جملة غير idempotent، **كيّف نسخة الـinstaller فقط** (لا تلمس ملف المصدر في `supabase/migrations`) بلفّها في حارس.
- **تكييف السحابي للمحلي**: هجرات تفترض سكيما سحابية (مثل `licensing.*ROWTYPE`، `auth.*`, `supabase_functions`, `cron`) تفشل محلياً. لفّها في `DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='licensing') THEN … ELSE RAISE NOTICE 'skip on local'; END IF; END $guard$;` — تتخطى محلياً وتعمل سحابياً.
- هجرة تُرقّع دالة غير مشحونة محلياً (مثل `direct_post_sale` نسخة v3) → **حارس تخطٍّ آمن** بدل `RAISE EXCEPTION` حين تغيب العلامات.
### 1ه. الاختبار الإلزامي — dry-run مرتين على القاعدة الحية (صفر أثر)
```
PSQL="/Applications/TexaCore ERP.app/Contents/Resources/bin/pg/bin/psql"
$PSQL -p 54322 -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
BEGIN;
\i <installer>/migrations/<mig1>.sql
\i <installer>/migrations/<mig2>.sql
-- ... كل الجديدة
-- ثم كررها مرة ثانية بنفس المعاملة لإثبات idempotency:
\i <installer>/migrations/<mig1>.sql
\i ...
ROLLBACK;
SQL
```
يجب أن تكمل **بصفر أخطاء عبر الجولتين**. أصلِح وكرّر حتى تنظف. الـROLLBACK يضمن عدم تلويث قاعدة فراس.

## المرحلة 2 — بناء الفرونت إند
```
cd <dev> && npm run build:installer
```
(= `vite build` ثم `rsync dist/ → texacore-installer/frontend/`). يجب أن يخرج 0. بصمات على `<installer>/frontend/` تُثبت وصول التحديثات للحزمة (مثال: `grep -rl "معالج الإعداد\|--header-height\|erp-density" <installer>/frontend/assets/`).

## المرحلة 3 — النسخة + سجل التغييرات
- `<installer>/package.json` → ارفع `version` (المعلَم القادم؛ الحالي 1.6.5).
- أضف مدخلاً لـ`<installer>/CHANGELOG.md` (عربي، بنمط الموجود) يلخّص كل ما جُمّع.

## المرحلة 4 — بناء الـdmg + التنصيب + إثبات الترقية
```
cd <installer> && npm run build:mac   # electron-builder --mac ؛ بلا notarize
```
- المخرج: `<installer>/dist/TexaCore-ERP-<version>-arm64.dmg`.
- **التنصيب فوق القائم** (بيانات القاعدة تبقى — `~/.../texacore-data` منفصلة عن الحزمة):
```
osascript -e 'quit app "TexaCore ERP"'; sleep 3
rm -rf "/Applications/TexaCore ERP.app"
# من الـdmg المفكوك أو من dist/mac-arm64:
ditto "<installer>/dist/mac-arm64/TexaCore ERP.app" "/Applications/TexaCore ERP.app"
```
- **التشغيل + التقاط لوغ الرانر** (لا لوغ دائم — التقطه من stdout بتشغيل الباينري مباشرة، لا `open -a`):
```
"/Applications/TexaCore ERP.app/Contents/MacOS/TexaCore ERP"  &  ثم انتظر ~40s
```
- **التحقق من مسار الترقية**:
```
$PSQL -p 54322 ... -c "SELECT count(*) FROM _texacore_migrations"   # يجب أن يزيد بعدد الهجرات الجديدة بالضبط
$PSQL ... -c "SELECT * FROM _texacore_migrations WHERE name LIKE '%__FAILED%' AND ..."  # صفر فشل جديد
```
- **فحوص وظيفية** بحسب ما جُمّع (مثال تصنيع: تحقق أن جداول/دوال التصنيع موجودة). ملاحظة: الرانر يسجّل النجاح باسم نظيف والفشل بلاحقة `__FAILED`؛ توجد ~31 هجرة قديمة تفشل كل إقلاع (طبيعية بنسخة فراس المتشعبة — تجاهلها، فقط تأكد أن هجراتك الجديدة ليست بينها).
- **RLS محلياً**: `service-manager setupDatabaseRoles` يعطّل RLS على كل جداول public (auth.uid() غير موثوق مع GoTrue المحلي). هذا مقصود؛ هجرات RLS تُنشئ السياسات للتكافؤ السحابي فقط.

## المرحلة 5 — الدفع
- ادفع ريبو الـinstaller (`feras1960/TexaCore-Installer`) بعد نجاح التحقق: `cd <installer> && git add -A && git commit && git push`.
- الـdmg نفسه لا يُرفع لـgit (كبير) — يُوزَّع من `dist/`.

---
## أكثر 5 أخطاء تُفشِل الإصدار (من تجارب سابقة)
1. شحن هجرة غير idempotent → الرانر يعيدها ويفشل على جهاز فيه نسخة سابقة.
2. شحن هجرة سحابية بلا حارس → `schema "licensing"/"auth" does not exist` محلياً.
3. تخطي dry-run المزدوج → اكتشاف الفشل بعد التنصيب على جهاز فراس.
4. نسيان `npm run build:installer` → dmg بفرونت إند قديم رغم كود جديد.
5. البناء بلا رفع order المانيفست → الرانر لا يرى الهجرات الجديدة أصلاً.
