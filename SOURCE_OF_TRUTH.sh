# 🏠 TexaCore Installer — مصدر الحقيقة (Source of Truth)
# آخر تحديث: 2026-05-04

# ══════════════════════════════════════════════════════════════
#  ⚡ التشغيل السريع — انسخ والصق هذا الأمر
# ══════════════════════════════════════════════════════════════
#
#   cd "/Users/macbook/TexaCore-Backups-2026-03-25/erpsystem supabase/texacore-installer"
#   npm start
#
# أو في وضع التطوير (يفتح DevTools):
#
#   npm run dev
#
# ══════════════════════════════════════════════════════════════


# ─── النسخة الحالية ─────────────────────────────────────────
INSTALLER_VERSION=1.3.1
BUILD_DATE=2026-05-04T11:45:00Z
GIT_TAG=v1.3.1

# ─── مسار المشروع الرسمي ────────────────────────────────────
INSTALLER_ROOT="/Users/macbook/TexaCore-Backups-2026-03-25/erpsystem supabase/texacore-installer"
INSTALLER_MAIN="src/main.js"
INSTALLER_PORT_ELECTRON=8080

# ─── مسار مشروع الويب (Frontend ERP) ────────────────────────
ERP_WEB_ROOT="/Users/macbook/TexaCore-Backups-2026-03-25/erpsystem supabase"
ERP_WEB_DEV_PORT=3334

# ─── الملفات الأساسية ───────────────────────────────────────
# الملفات التالية هي أحدث نسخة ويجب عدم استبدالها بملفات Git القديمة
#
# src/main.js           — العملية الرئيسية (Electron Main Process)
# src/renderer.js       — واجهة المستخدم (UI Logic)
# src/preload.js        — جسر الاتصال بين Main و Renderer
# src/index.html        — الهيكل البصري
# src/styles.css        — الأنماط
# src/rsf-reader.js     — قارئ ملفات الرشيد (.rsf)
# src/rsf-mapper.js     — محول البيانات (الرشيد → TexaCore)
# src/rsf-exporter.js   — مصدّر البيانات (TexaCore → الرشيد)
# src/service-manager.js — إدارة الخدمات المدمجة (PG, GoTrue, PostgREST)
# src/backup-manager.js — نظام النسخ الاحتياطي (.tcdb)
# src/license-guard.js  — حماية وتشفير التراخيص
# src/migration-runner.js — تطبيق الـ migrations تلقائياً


# ─── سجل الإصدارات ──────────────────────────────────────────
#
# v1.3.1 (2026-05-04) — إصلاح استيراد الفواتير + تتبع الإصدارات
#   • rsf-reader: دعم البنية البديلة (MoveBayBill+MOVE) للفواتير
#   • rsf-mapper: خرائط ربط عكسية (supplierByAccountMap, customerByAccountMap)
#   • UI: عرض رقم الإصدار + تاريخ البناء في Footer
#   • package.json: حقل buildDate لتتبع الإصدارات
#
# v1.3.0 (2026-05-03) — النسخة الهجينة (محلي + سحابي)
#   • تحويل من Docker إلى خدمات مدمجة (Embedded PG + GoTrue + PostgREST)
#   • نظام استيراد/تصدير الرشيد (RSF Reader/Mapper/Exporter)
#   • نظام النسخ الاحتياطي المشفر (.tcdb)
#   • نظام التراخيص المشفر (Hardware-bound)
#   • Cloud Access عبر Cloudflare Tunnel
#   • Service Manager يدير جميع الخدمات محلياً
#
# v1.0.6 (2026-04-24) — إصلاح Docker على Windows
# v1.0.0 (2026-04-23) — الإصدار الأول


# ─── ⚠️ تحذيرات مهمة ────────────────────────────────────────
#
# 1. لا تعمل git reset أو git checkout على مجلد src/
#    الملفات الجديدة (rsf-reader, rsf-mapper, etc.) غير موجودة في النسخة القديمة
#
# 2. النسخة في Git القديم هي v1.0.6 (Docker-based)
#    النسخة الحالية هي v1.3.1 (Embedded services)
#    لا تخلط بينهم!
#
# 3. عند أي تعديل: حدّث VERSION و BUILD_DATE هنا وفي package.json
#
# 4. بعد أي تعديل مهم:
#    cd "$INSTALLER_ROOT"
#    # تحديث buildDate في package.json
#    npm start   # أو npm run dev للتطوير
#    git add -A && git commit -m "vX.Y.Z — وصف التغيير"
#    git tag vX.Y.Z
