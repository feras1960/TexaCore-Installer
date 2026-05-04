-- ══════════════════════════════════════════
-- المرحلة 2: جداول الطلبات للمتجر الإلكتروني
-- ecommerce_orders + ecommerce_order_items
-- ══════════════════════════════════════════

-- ═══ جدول الطلبات ═══
CREATE TABLE IF NOT EXISTS ecommerce_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT (current_setting('app.current_tenant_id', true))::uuid,
  store_id UUID REFERENCES ecommerce_stores(id),
  
  -- معلومات الطلب
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'returned')),
  
  -- معلومات العميل (بدون تسجيل حالياً)
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  customer_type TEXT DEFAULT 'guest' CHECK (customer_type IN ('guest', 'registered', 'wholesale')),
  customer_id UUID, -- سيرتبط بجدول العملاء لاحقاً
  
  -- عنوان الشحن
  shipping_address JSONB NOT NULL DEFAULT '{}',
  -- { full_name, phone, country, city, district, street, building, postal_code, notes }
  
  -- المبالغ
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SAR',
  
  -- الكوبون
  coupon_code TEXT,
  
  -- الدفع
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_method TEXT DEFAULT 'cod', -- cash_on_delivery, bank_transfer, card
  payment_reference TEXT,
  
  -- ملاحظات
  customer_notes TEXT,
  internal_notes TEXT,
  
  -- ربط مع ERP
  sales_invoice_id UUID, -- سيرتبط بفاتورة المبيعات في ERP
  
  -- الطوابع الزمنية
  confirmed_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ جدول بنود الطلب ═══
CREATE TABLE IF NOT EXISTS ecommerce_order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT (current_setting('app.current_tenant_id', true))::uuid,
  order_id UUID NOT NULL REFERENCES ecommerce_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES ecommerce_products(id),
  material_id UUID, -- ربط مباشر بالمادة في fabric_materials
  
  -- بيانات المنتج وقت الطلب (snapshot)
  product_name JSONB NOT NULL DEFAULT '{}', -- {ar: "...", en: "..."}
  product_image TEXT,
  material_code TEXT,
  
  -- الكميات والأسعار
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'meter',
  unit_price NUMERIC(12,2) NOT NULL, -- السعر الفعّال وقت الطلب
  original_price NUMERIC(12,2), -- السعر قبل الخصم
  total_price NUMERIC(12,2) NOT NULL,
  
  -- الطوابع
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ الفهارس ═══
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_tenant ON ecommerce_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_store ON ecommerce_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_status ON ecommerce_orders(status);
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_customer_email ON ecommerce_orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_customer_phone ON ecommerce_orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_number ON ecommerce_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_created ON ecommerce_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecommerce_order_items_order ON ecommerce_order_items(order_id);

-- ═══ Trigger لتحديث updated_at ═══
CREATE OR REPLACE TRIGGER set_ecommerce_orders_updated_at
  BEFORE UPDATE ON ecommerce_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══ دالة توليد رقم طلب فريد ═══
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  new_num TEXT;
  seq_val INT;
BEGIN
  SELECT COALESCE(MAX(
    CAST(NULLIF(regexp_replace(order_number, '[^0-9]', '', 'g'), '') AS INT)
  ), 10000) + 1
  INTO seq_val
  FROM ecommerce_orders;
  
  new_num := 'TXO-' || seq_val;
  RETURN new_num;
END;
$$ LANGUAGE plpgsql;

-- ═══ سياسات RLS ═══
ALTER TABLE ecommerce_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_order_items ENABLE ROW LEVEL SECURITY;

-- الطلبات: القراءة العامة بواسطة رقم الطلب + البريد (للتتبع)
-- الكتابة: أي شخص يمكنه إنشاء طلب (guest checkout)
CREATE POLICY "ecommerce_orders_public_insert"
  ON ecommerce_orders FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "ecommerce_orders_public_read"
  ON ecommerce_orders FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "ecommerce_orders_admin_update"
  ON ecommerce_orders FOR UPDATE
  TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_platform_admin());

CREATE POLICY "ecommerce_orders_admin_delete"
  ON ecommerce_orders FOR DELETE
  TO authenticated
  USING (is_platform_admin());

-- بنود الطلب
CREATE POLICY "ecommerce_order_items_public_insert"
  ON ecommerce_order_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "ecommerce_order_items_public_read"
  ON ecommerce_order_items FOR SELECT
  TO anon, authenticated
  USING (true);

-- ═══ الصلاحيات ═══
GRANT SELECT, INSERT ON ecommerce_orders TO anon;
GRANT SELECT, INSERT ON ecommerce_order_items TO anon;
GRANT ALL ON ecommerce_orders TO authenticated;
GRANT ALL ON ecommerce_order_items TO authenticated;
