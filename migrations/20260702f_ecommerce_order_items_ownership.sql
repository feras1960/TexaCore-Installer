-- 20260702f — تحصين: سياسة إدراج بنود الطلب تتحقق من ملكية الطلب الأب
-- التدقيق كشف أن سياسة الإدراج كانت WITH CHECK (is_storefront_customer() AND order_id IS NOT NULL)
-- بلا أي ربط بمالك الطلب ⇒ زبون متجر مسجّل يستطيع حقن بنود في طلب زبون آخر.
-- الإصلاح (دفاع بالعمق، لا يكسر السيلف/الضيف):
--   يُسمح بالإدراج فقط إن كان الطلب الأب مملوكاً للزبون الحالي (customer_id = current_customer_id())
--   أو طلب ضيف (customer_id IS NULL). المتجر يُنشئ الطلب بـ customer_id ثم يُدرج البنود، فالمسار الشرعي سليم.
-- الحلّ الجذري (لاحقاً): RPC خادمية create_storefront_order تُلغي الإدراج المباشر وتعيد التسعير من الخادم.

BEGIN;

DROP POLICY IF EXISTS ecommerce_order_items_public_insert_validated ON public.ecommerce_order_items;

CREATE POLICY ecommerce_order_items_public_insert_validated
    ON public.ecommerce_order_items
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
        is_storefront_customer()
        AND order_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.ecommerce_orders o
            WHERE o.id = ecommerce_order_items.order_id
              AND (o.customer_id = current_customer_id() OR o.customer_id IS NULL)
        )
    );

COMMIT;
