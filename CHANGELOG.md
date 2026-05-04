# 📋 TexaCore ERP — سجل التغييرات (Changelog)


## [v1.3.1] — 2026-05-04

### إصلاح استيراد الفواتير + تتبع الإصدارات:
- إصلاح `rsf-reader`: دعم البنية البديلة (MoveBayBill+MOVE) لفواتير المشتريات والمبيعات
- إصلاح `rsf-mapper`: إضافة خرائط ربط عكسية (`supplierByAccountMap`, `customerByAccountMap`)
- إضافة نظام تتبع الإصدارات: عرض رقم الإصدار + تاريخ البناء في Footer
- إضافة `SOURCE_OF_TRUTH.sh` كمرجع رسمي للمشروع

---

## [v1.3.0] — 2026-05-03

### النسخة الهجينة — تحول جذري من Docker إلى خدمات مدمجة:
- ✅ Embedded PostgreSQL + GoTrue + PostgREST (بدون Docker)
- ✅ نظام استيراد/تصدير الرشيد (RSF Reader/Mapper/Exporter)
- ✅ نظام النسخ الاحتياطي المشفر (.tcdb)
- ✅ نظام التراخيص المشفر (Hardware-bound)
- ✅ Cloud Access عبر Cloudflare Tunnel
- ✅ Service Manager لإدارة جميع الخدمات محلياً
- ✅ Migration Runner تلقائي

---

## [v1.0.6] — 2026-04-24

### التغييرات:
- إصلاح عرض مسار Docker وزر فتح المجلد

---


## [v1.0.5] — 2026-04-24

### التغييرات:
- إضافة زر فتح مجلد التحميل كـ fallback أخير

---


## [v1.0.4] — 2026-04-24

### التغييرات:
- إصلاح فتح مثبّت Docker على Windows — 3 طرق fallback

---


## [v1.0.3] — 2026-04-24

### التغييرات:
- إصلاح عرض رقم الإصدار ديناميكياً

---


## [v1.0.2] — 2026-04-24

### التغييرات:
- إصلاح التثبيت التلقائي لـ Docker على Windows

---


## [v1.0.1] — 2026-04-24

### التغييرات:
- Desktop Setup Wizard + Multi-Company + Backup Engine + Google Drive

---

## [v1.0.0] — 2026-04-23

### الإصدار الأول 🎉
- ✅ إنشاء برنامج التثبيت (Electron + electron-builder)
- ✅ بناء macOS (.dmg Universal) و Windows (.exe NSIS)
- ✅ نظام التراخيص (Trial + Paid) مع تفعيل تلقائي
- ✅ اكتشاف Docker تلقائياً مع تحميل تلقائي إذا غير مثبت
- ✅ System Tray — يعمل في الخلفية مثل Google Drive
- ✅ نظام التحديثات التلقائية (electron-updater + GitHub Releases)
- ✅ إرسال مفتاح الترخيص بالبريد الإلكتروني
- ✅ إشعار انتهاء الترخيص (Banner تحذيري قبل 7 أيام)
- ✅ أيقونة التطبيق من شعار TexaCore الأصلي

---
