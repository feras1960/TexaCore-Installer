# توقيع تطبيق الماك بهوية مستقرة (من 2.0.4)

## لماذا
التطبيق في 2.0.0–2.0.3 موقَّع **ad-hoc**: لا شهادة، فمتطلَّبه التصميمي (designated requirement) هو بصمة الشيفرة نفسها `cdhash H"…"` وتتغيّر مع كل بناء. macOS يربط **أذونات الخصوصية** (الملفات والمجلدات: سطح المكتب/المستندات/التنزيلات…) و**وصول سلسلة المفاتيح** بهذا المتطلَّب، فيعامل كل تحديث على أنه تطبيق جديد ويسأل من جديد. الدليل في سجلّ النظام (tccd) على ماك المالك:
`Failed to match existing code requirement for subject com.texacore.installer and service kTCCServiceSystemPolicyDesktopFolder`.

هوية مستقرة (شهادة) تجعل المتطلَّب `identifier "com.texacore.installer" and certificate leaf = H"…"` — ثابتاً عبر الإصدارات، فيبقى الإذن.

## ما يفعله المستودع (جاهز، لا يُنشئ شهادة ولا يلمس سلسلة مفاتيح)
- `scripts/lib/mac-sign.js` + `scripts/afterPack.cjs`: إن وُجد `TEXACORE_MAC_SIGN_IDENTITY` (أو `CSC_NAME`) يوقَّع التطبيق بتلك الهوية بدل ad-hoc، ويُفشَل البناء إن خرجت الحزمة ad-hoc أو بغير الهوية المطلوبة. `build.mac.identity = null` في `package.json` يمنع electron-builder من توقيع ثانٍ.
- `src/mac-updater.js`: سكربت التثبيت بعد التحديث **يُبقي** التوقيع إن كان صالحاً وليس ad-hoc، ويوقّع ad-hoc فقط احتياطاً لحزمة بلا توقيع/تالفة/ad-hoc.
- `scripts/verify-mac-build.js` البند M7: يطبع نوع التوقيع ويقول إن كان المتطلَّب مستقراً؛ `TEXACORE_REQUIRE_STABLE_SIGNATURE=1` يجعل ad-hoc فشلاً.
- الأسرار والترخيص غير مرتبطين بالتوقيع (اختبار `test/mac-sign.test.js`: ad-hoc ← ذاتي ← Developer ID ← رجوع بلا فقد ولا إعادة توليد).

## ⚠️ حدّ مهم: أول تحديث
سكربت التثبيت يكتبه التطبيق **الجاري** وقت الإغلاق. فالتحديث من 2.0.3 (أو أقدم) إلى 2.0.4 ينتهي **دائماً** بتوقيع ad-hoc (سكربت 2.0.3 يعيد التوقيع ad-hoc مهما كانت الحزمة). لذلك:
- التثبيت الجديد من **الـdmg** ببناء موقَّع يأخذ الهوية المستقرة فوراً.
- التحديثات **بعد** 2.0.4 (من نسخة 2.0.4 المثبَّتة بالـdmg الموقَّع) تُبقي الهوية.
- من يحدّث من 2.0.3 هوائياً سيسأله macOS مرة أخرى عند أول مرة ثم يستقر إن ثبّت من الـdmg لاحقاً. (خطوة الإذن الظاهرة في الصفحة تعالج هذا السؤال بلا ضياع.)

## الطريق أ — شهادة ذاتية التوقيع (الأبسط، يقرّره المالك)
تُنشأ **مرة واحدة** على جهاز البناء (لا على ماك المستخدمين):
1. Keychain Access ← القائمة: Certificate Assistant ← **Create a Certificate…**
2. Name: `TexaCore Local Signing` — Identity Type: **Self Signed Root** — Certificate Type: **Code Signing** — اترك Let me override defaults غير مفعّل ← Create.
3. تأكّد: `security find-identity -v -p codesigning` يعرض `TexaCore Local Signing`. (قد يقول CSSMERR_TP_NOT_TRUSTED في `-v` للشهادة الذاتية؛ هذا لا يمنع التوقيع ولا مطابقة المتطلَّب.)
4. احفظ نسخة احتياطية من المفتاح الخاص (Export… .p12 بكلمة سر) — فقدانه يعني هوية جديدة وسؤالاً جديداً من macOS.
5. البناء: `TEXACORE_MAC_SIGN_IDENTITY="TexaCore Local Signing" npm run build:all` (أو بمفتاح في سلسلة مفاتيح مخصَّصة: `TEXACORE_MAC_SIGN_KEYCHAIN=/path/build.keychain-db`).
6. تحقّق: `codesign -d -r- "TexaCore ERP.app"` يجب أن يطبع `identifier "com.texacore.installer" and certificate leaf = H"…"` (لا `cdhash`).
7. **تحقّق على ماك حقيقي (لم أستطع اختباره دون إنشاء شهادة):** ثبّت 2.0.4 من الـdmg، امنح الإذن، ثبّت نسخة أحدث موقَّعة بالهوية نفسها، وتأكّد أن macOS لا يسأل ثانية.

الأسرار: التوقيع الذاتي لا يحتوي TeamIdentifier فتبقى الأسرار في ملف `secrets.json` (0600) كما هي — لا تحوُّل إلى سلسلة المفاتيح ولا خطر على المالك.

## الطريق ب — Apple Developer ID (للتوزيع العام)
يتطلب عضوية Apple Developer ($99/سنة) وشهادة `Developer ID Application`.
1. `TEXACORE_MAC_SIGN_IDENTITY="Developer ID Application: <الاسم> (<TEAMID>)" npm run build:all` — يفعّل تلقائياً hardened runtime والطابع الزمني وملف الصلاحيات `build/entitlements.mac.plist`.
2. **ما لم يُنفَّذ بعد (يحتاج الشهادة):** كل ملف تنفيذي داخل `Resources/bin` (ثنائيات PostgreSQL وcloudflared) يجب أن يوقَّع بنفس الهوية مع hardened runtime كي تقبل Apple التوثيق؛ وcloudflared يحمل توقيع Cloudflare ويفحصه `verifyCloudflaredFile` فسيلزم تعديل ذلك الفحص. ثم:
   `xcrun notarytool submit TexaCore-ERP-<v>-arm64.zip --keychain-profile <profile> --wait` ثم `xcrun stapler staple "TexaCore ERP.app"` وإعادة بناء الـdmg.
3. مع Developer ID (TeamIdentifier موجود) تنتقل الأسرار تلقائياً إلى سلسلة المفاتيح عند أول تشغيل (الترحيل مُختبَر وبلا فقد).

## الاختيار
- لتجنّب السؤال المتكرر الآن بأقل جهد: **الطريق أ**.
- عند البيع العام: **الطريق ب** (يزيل تحذير «مطوّر غير معرَّف» أيضاً).
