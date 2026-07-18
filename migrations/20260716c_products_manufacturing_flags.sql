-- 20260716c: أعلام المنتج المصنّع على products (§4-ج بند 5 + §4-د بند 5)
-- ═══════════════════════════════════════════════════════════════════════════
-- إضافة أعلام/خصائص التصنيع على المنتجات. المبدأ «شامل بالمخطط من اليوم الأول».
-- default_bom_id بلا FK بعد — جدول mfg_boms يأتي في P1 (يُضاف القيد حينها).
-- idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_manufactured  boolean DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_semi_finished boolean DEFAULT false;
-- default_bom_id: مرجع BOM الافتراضي — لا FK حتى إنشاء mfg_boms في P1 (يُضاف القيد الأجنبي لاحقاً).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS default_bom_id   uuid;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS density          numeric;   -- كثافة للتحويل كغ↔لتر (عملياتي)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shelf_life_days  int;       -- لاحتساب expiry_date للدفعات المنتَجة
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS nominal_potency  numeric;   -- الفعالية الاسمية (استهلاك بالفعالية — §4-د بند 5)

COMMENT ON COLUMN public.products.default_bom_id IS 'مرجع BOM الافتراضي؛ FK إلى mfg_boms يُضاف في P1.';
