-- ════════════════════════════════════════════════════════════════════════
-- 20260702o — محرّك الكاش باك للمتاجر (تكانيكس/أوبوفيكس)
-- ════════════════════════════════════════════════════════════════════════
-- البنية:
--   • ecommerce_cashback_settings  — نسبة ديناميكية لكل متجر + سقف الاسترداد + انتهاء + أكواد الحسابات
--   • ecommerce_cashback_ledger    — دفتر أرصدة (earn/redeem/reverse/expire/adjust) — مصدر الحقيقة
--   • أعمدة ecommerce_orders: cashback_used / cashback_earned (لقطة؛ الدفتر هو الحقيقة)
--   • الدورة: إنشاء الطلب ⇒ earn معلّق — التسليم ⇒ تأكيد + قيد محاسبي — الإلغاء/الإرجاع ⇒ عكس
--   • الاسترداد عند الدفع: يتحقق الخادم من الرصيد والسقف (تريغر BEFORE INSERT) — لا ثقة بالمتصفح
-- المحاسبة (قيود آلية مرحَّلة، reference_type='cashback'):
--   كسب مؤكد:   من ح/ 534 التسويق (مصروف)      إلى ح/ 218 التزام كاش باك العملاء
--   استرداد:    من ح/ 218 التزام كاش باك        إلى ح/ 411 الإيرادات (تعويض صافي الفاتورة)
--   عكس/انتهاء: من ح/ 218 التزام كاش باك        إلى ح/ 534 التسويق (عكس المخصص)
--   الأكواد قابلة للتغيير من الإعدادات. حساب 218 يُنشأ تلقائياً تحت 21 إن غاب.
--   القيد فشلُه لا يكسر تدفق الطلب (best-effort مع تسجيل الخطأ في notes).
-- العملة: بعملة الطلب (تكانيكس USD / أوبوفيكس UAH)؛ رصيد الزبون أحادي العملة بحكم انتمائه لمتجر واحد.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) جدول الإعدادات لكل متجر ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ecommerce_cashback_settings (
    store_id            UUID PRIMARY KEY REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL,
    enabled             BOOLEAN NOT NULL DEFAULT false,
    rate_percent        NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (rate_percent >= 0 AND rate_percent <= 50),
    min_order_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
    redeem_cap_percent  NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (redeem_cap_percent >= 0 AND redeem_cap_percent <= 100),
    expiry_days         INTEGER CHECK (expiry_days IS NULL OR expiry_days > 0),
    -- شرائح مستقبلية حسب الحجم الشهري: [{"min_monthly": 5000, "rate": 10}]
    tiers               JSONB NOT NULL DEFAULT '[]'::jsonb,
    expense_account_code   TEXT NOT NULL DEFAULT '534',
    liability_account_code TEXT NOT NULL DEFAULT '218',
    redeem_credit_account_code TEXT NOT NULL DEFAULT '411',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          UUID
);

ALTER TABLE public.ecommerce_cashback_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cashback_settings_admin_all ON public.ecommerce_cashback_settings;
CREATE POLICY cashback_settings_admin_all
    ON public.ecommerce_cashback_settings
    FOR ALL TO authenticated
    USING (tenant_id = get_user_tenant_id() OR is_platform_admin())
    WITH CHECK (tenant_id = get_user_tenant_id() OR is_platform_admin());

GRANT SELECT, INSERT, UPDATE ON public.ecommerce_cashback_settings TO authenticated;

-- ── 2) دفتر الكاش باك ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ecommerce_cashback_ledger (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    store_id      UUID NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
    customer_id   UUID NOT NULL REFERENCES public.ecommerce_customers(id) ON DELETE CASCADE,
    order_id      UUID REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL,
    entry_type    TEXT NOT NULL CHECK (entry_type IN ('earn','redeem','reverse','expire','adjust')),
    status        TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled')),
    -- المبلغ موجب دائماً؛ الإشارة تُشتق من النوع (earn/adjust+ ، redeem/reverse/expire−)
    -- adjust يقبل السالب للتصحيحات الإدارية
    amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0 OR entry_type = 'adjust'),
    rate_percent  NUMERIC(5,2),
    currency      TEXT NOT NULL DEFAULT 'USD',
    journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at  TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ
);

-- earn/redeem واحد لكل طلب (يمنع الازدواج عند تكرار تحولات الحالة)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashback_ledger_order_type
    ON public.ecommerce_cashback_ledger(order_id, entry_type)
    WHERE order_id IS NOT NULL AND entry_type IN ('earn','redeem','reverse');
CREATE INDEX IF NOT EXISTS idx_cashback_ledger_customer ON public.ecommerce_cashback_ledger(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashback_ledger_store ON public.ecommerce_cashback_ledger(store_id);

ALTER TABLE public.ecommerce_cashback_ledger ENABLE ROW LEVEL SECURITY;

-- الأدمن: كامل الصلاحية ضمن المستأجر
DROP POLICY IF EXISTS cashback_ledger_admin_all ON public.ecommerce_cashback_ledger;
CREATE POLICY cashback_ledger_admin_all
    ON public.ecommerce_cashback_ledger
    FOR ALL TO authenticated
    USING (tenant_id = get_user_tenant_id() OR is_platform_admin())
    WITH CHECK (tenant_id = get_user_tenant_id() OR is_platform_admin());

-- زبون المتجر: قراءة سجلّه فقط (الكتابة عبر الدوال المعرَّفة أمنياً حصراً)
DROP POLICY IF EXISTS cashback_ledger_customer_read ON public.ecommerce_cashback_ledger;
CREATE POLICY cashback_ledger_customer_read
    ON public.ecommerce_cashback_ledger
    FOR SELECT TO authenticated
    USING (customer_id = current_customer_id());

GRANT SELECT ON public.ecommerce_cashback_ledger TO authenticated;

-- ── 3) أعمدة الطلب ──────────────────────────────────────────────────────
ALTER TABLE public.ecommerce_orders ADD COLUMN IF NOT EXISTS cashback_used   NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.ecommerce_orders ADD COLUMN IF NOT EXISTS cashback_earned NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ── 4) الرصيد المؤكد/المعلق ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cashback_confirmed_balance(p_customer_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT COALESCE(SUM(
        CASE WHEN entry_type IN ('earn','adjust') THEN amount ELSE -amount END
    ), 0)
    FROM ecommerce_cashback_ledger
    WHERE customer_id = p_customer_id AND status = 'confirmed';
$$;

CREATE OR REPLACE FUNCTION public.get_cashback_balance(p_customer_id UUID)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_tenant UUID;
    v_confirmed NUMERIC;
    v_pending NUMERIC;
    v_currency TEXT;
BEGIN
    SELECT tenant_id INTO v_tenant FROM ecommerce_customers WHERE id = p_customer_id;
    IF v_tenant IS NULL THEN
        RETURN jsonb_build_object('confirmed', 0, 'pending', 0, 'currency', 'USD');
    END IF;

    -- الحارس: الزبون نفسه، أو أدمن المستأجر، أو service_role
    IF NOT (p_customer_id = current_customer_id()
            OR v_tenant = get_user_tenant_id()
            OR is_platform_admin()
            OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'not allowed';
    END IF;

    v_confirmed := cashback_confirmed_balance(p_customer_id);

    SELECT COALESCE(SUM(amount), 0) INTO v_pending
    FROM ecommerce_cashback_ledger
    WHERE customer_id = p_customer_id AND status = 'pending' AND entry_type = 'earn';

    SELECT currency INTO v_currency
    FROM ecommerce_cashback_ledger
    WHERE customer_id = p_customer_id
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
        'confirmed', v_confirmed,
        'pending', v_pending,
        'currency', COALESCE(v_currency,
            (SELECT s.default_currency FROM ecommerce_stores s
             JOIN ecommerce_customers c ON c.store_id = s.id
             WHERE c.id = p_customer_id), 'USD')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cashback_balance(UUID) TO authenticated;

-- ── 5) واجهات المتجر ────────────────────────────────────────────────────
-- إعدادات عامة (للعرض قبل الدخول: «اربح X٪ كاش باك»)
CREATE OR REPLACE FUNCTION public.get_cashback_public_settings(p_store_id UUID)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT COALESCE(
        (SELECT jsonb_build_object(
            'enabled', enabled,
            'rate_percent', rate_percent,
            'redeem_cap_percent', redeem_cap_percent,
            'min_order_amount', min_order_amount,
            'expiry_days', expiry_days
        ) FROM ecommerce_cashback_settings WHERE store_id = p_store_id),
        jsonb_build_object('enabled', false, 'rate_percent', 0,
                           'redeem_cap_percent', 0, 'min_order_amount', 0, 'expiry_days', NULL)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_cashback_public_settings(UUID) TO anon, authenticated;

-- رصيد وسجلّ الزبون الحالي (للكابينة والدفع)
CREATE OR REPLACE FUNCTION public.get_my_cashback(p_store_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_customer UUID;
    v_balance jsonb;
    v_entries jsonb;
BEGIN
    v_customer := current_customer_id();
    IF v_customer IS NULL THEN
        RETURN jsonb_build_object('confirmed', 0, 'pending', 0, 'currency', 'USD', 'entries', '[]'::jsonb);
    END IF;

    v_balance := get_cashback_balance(v_customer);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'type', l.entry_type,
        'status', l.status,
        'amount', l.amount,
        'currency', l.currency,
        'order_number', o.order_number,
        'created_at', l.created_at,
        'confirmed_at', l.confirmed_at,
        'expires_at', l.expires_at
    ) ORDER BY l.created_at DESC), '[]'::jsonb)
    INTO v_entries
    FROM (
        SELECT * FROM ecommerce_cashback_ledger
        WHERE customer_id = v_customer
        ORDER BY created_at DESC
        LIMIT 50
    ) l
    LEFT JOIN ecommerce_orders o ON o.id = l.order_id;

    RETURN v_balance || jsonb_build_object('entries', v_entries);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_cashback(UUID) TO authenticated;

-- أرصدة زبائن متجر كامل (للوحة الإدارة — عمود الرصيد بقائمة الزبائن)
CREATE OR REPLACE FUNCTION public.get_cashback_balances_for_store(p_store_id UUID)
RETURNS TABLE (customer_id UUID, confirmed NUMERIC, pending NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF NOT ((SELECT tenant_id FROM ecommerce_stores WHERE id = p_store_id) = get_user_tenant_id()
            OR is_platform_admin()
            OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'not allowed';
    END IF;

    RETURN QUERY
    SELECT l.customer_id,
           COALESCE(SUM(CASE WHEN l.status = 'confirmed'
                THEN CASE WHEN l.entry_type IN ('earn','adjust') THEN l.amount ELSE -l.amount END
                ELSE 0 END), 0) AS confirmed,
           COALESCE(SUM(CASE WHEN l.status = 'pending' AND l.entry_type = 'earn' THEN l.amount ELSE 0 END), 0) AS pending
    FROM ecommerce_cashback_ledger l
    WHERE l.store_id = p_store_id
    GROUP BY l.customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cashback_balances_for_store(UUID) TO authenticated;

-- ── 6) القيد المحاسبي لحركة كاش باك ────────────────────────────────────
-- من/إلى حسب النوع (انظر رأس الملف). يُرحَّل فوراً عبر post_journal_entry.
CREATE OR REPLACE FUNCTION public.post_cashback_journal(p_ledger_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_l          ecommerce_cashback_ledger%ROWTYPE;
    v_settings   ecommerce_cashback_settings%ROWTYPE;
    v_company    UUID;
    v_order_no   TEXT;
    v_cust_name  TEXT;
    v_acc_exp    UUID;
    v_acc_liab   UUID;
    v_acc_credit UUID;
    v_dr_acc     UUID;
    v_cr_acc     UUID;
    v_desc       TEXT;
    v_je_id      UUID;
    v_entry_no   TEXT;
    v_amount     NUMERIC;
    v_parent_21  UUID;
    v_liab_type  UUID;
BEGIN
    SELECT * INTO v_l FROM ecommerce_cashback_ledger WHERE id = p_ledger_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ledger row not found');
    END IF;
    IF v_l.journal_entry_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'journal_entry_id', v_l.journal_entry_id, 'note', 'already posted');
    END IF;

    v_amount := ABS(v_l.amount);
    IF v_amount = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'zero amount');
    END IF;

    SELECT * INTO v_settings FROM ecommerce_cashback_settings WHERE store_id = v_l.store_id;

    -- الشركة: من الطلب إن وُجدت وإلا أول شركة بالمستأجر
    SELECT o.company_id, o.order_number INTO v_company, v_order_no
    FROM ecommerce_orders o WHERE o.id = v_l.order_id;
    IF v_company IS NULL THEN
        SELECT id INTO v_company FROM companies
        WHERE tenant_id = v_l.tenant_id ORDER BY created_at LIMIT 1;
    END IF;
    IF v_company IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'no company for tenant');
    END IF;

    SELECT TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) INTO v_cust_name
    FROM ecommerce_customers WHERE id = v_l.customer_id;

    -- الحسابات بالأكواد (نمط post_sales_invoice: شركة أولاً ثم عام)
    SELECT id INTO v_acc_exp FROM chart_of_accounts
    WHERE tenant_id = v_l.tenant_id AND (company_id = v_company OR company_id IS NULL)
      AND account_code = COALESCE(v_settings.expense_account_code, '534')
    ORDER BY CASE WHEN company_id = v_company THEN 0 ELSE 1 END LIMIT 1;

    SELECT id INTO v_acc_liab FROM chart_of_accounts
    WHERE tenant_id = v_l.tenant_id AND (company_id = v_company OR company_id IS NULL)
      AND account_code = COALESCE(v_settings.liability_account_code, '218')
    ORDER BY CASE WHEN company_id = v_company THEN 0 ELSE 1 END LIMIT 1;

    -- إنشاء حساب الالتزام 218 تلقائياً تحت مجموعة 21 إن غاب
    IF v_acc_liab IS NULL AND COALESCE(v_settings.liability_account_code, '218') = '218' THEN
        SELECT id INTO v_parent_21 FROM chart_of_accounts
        WHERE tenant_id = v_l.tenant_id AND company_id = v_company AND account_code = '21'
        LIMIT 1;
        IF v_parent_21 IS NOT NULL THEN
            SELECT account_type_id INTO v_liab_type FROM chart_of_accounts WHERE id = v_parent_21;
            INSERT INTO chart_of_accounts
                (tenant_id, company_id, account_code, name_ar, name_en, account_type_id,
                 parent_id, is_active, is_system, currency)
            VALUES
                (v_l.tenant_id, v_company, '218',
                 'التزام كاش باك العملاء', 'Customer Cashback Liability', v_liab_type,
                 v_parent_21, true, true, v_l.currency)
            RETURNING id INTO v_acc_liab;
        END IF;
    END IF;

    SELECT id INTO v_acc_credit FROM chart_of_accounts
    WHERE tenant_id = v_l.tenant_id AND (company_id = v_company OR company_id IS NULL)
      AND account_code = COALESCE(v_settings.redeem_credit_account_code, '411')
    ORDER BY CASE WHEN company_id = v_company THEN 0 ELSE 1 END LIMIT 1;

    IF v_acc_liab IS NULL OR v_acc_exp IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حسابات الكاش باك غير متوفرة (218/534) — أنشئها أو عدّل الأكواد بالإعدادات');
    END IF;

    -- تحديد طرفي القيد حسب النوع
    IF v_l.entry_type = 'earn' THEN
        v_dr_acc := v_acc_exp;  v_cr_acc := v_acc_liab;
        v_desc := 'كاش باك مكتسب — طلب ' || COALESCE(v_order_no, '؟') || ' — ' || COALESCE(v_cust_name, '');
    ELSIF v_l.entry_type = 'redeem' THEN
        IF v_acc_credit IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'حساب دائن الاسترداد (411) غير موجود');
        END IF;
        v_dr_acc := v_acc_liab; v_cr_acc := v_acc_credit;
        v_desc := 'استرداد كاش باك — طلب ' || COALESCE(v_order_no, '؟') || ' — ' || COALESCE(v_cust_name, '');
    ELSIF v_l.entry_type IN ('reverse','expire') THEN
        v_dr_acc := v_acc_liab; v_cr_acc := v_acc_exp;
        v_desc := CASE WHEN v_l.entry_type = 'expire' THEN 'انتهاء كاش باك — ' ELSE 'عكس كاش باك (إلغاء/إرجاع) — طلب ' END
                  || COALESCE(v_order_no, '') || ' — ' || COALESCE(v_cust_name, '');
    ELSIF v_l.entry_type = 'adjust' THEN
        IF v_l.amount >= 0 THEN
            v_dr_acc := v_acc_exp; v_cr_acc := v_acc_liab;
        ELSE
            v_dr_acc := v_acc_liab; v_cr_acc := v_acc_exp;
        END IF;
        v_desc := 'تسوية كاش باك — ' || COALESCE(v_cust_name, '') || COALESCE(' — ' || v_l.notes, '');
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'unknown entry type');
    END IF;

    v_entry_no := 'JE-CB-' || to_char(NOW(), 'YYMMDD') || '-' ||
                  LPAD(nextval('journal_entry_number_seq')::text, 4, '0');

    INSERT INTO journal_entries (
        tenant_id, company_id, entry_number, entry_date, description,
        reference_type, reference_id, reference_number,
        currency, exchange_rate, total_debit, total_credit,
        status, is_posted, created_by
    ) VALUES (
        v_l.tenant_id, v_company, v_entry_no, CURRENT_DATE, v_desc,
        'cashback', v_l.id, COALESCE(v_order_no, LEFT(v_l.id::text, 8)),
        v_l.currency, 1, v_amount, v_amount,
        'draft', false, auth.uid()
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, debit, credit, currency, description)
    VALUES
        (v_l.tenant_id, v_je_id, 1, v_dr_acc, v_amount, 0, v_l.currency, v_desc),
        (v_l.tenant_id, v_je_id, 2, v_cr_acc, 0, v_amount, v_l.currency, v_desc);

    PERFORM post_journal_entry(v_je_id, auth.uid());

    UPDATE ecommerce_cashback_ledger SET journal_entry_id = v_je_id WHERE id = p_ledger_id;

    RETURN jsonb_build_object('success', true, 'journal_entry_id', v_je_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_cashback_journal(UUID) TO authenticated;

-- غلاف best-effort: فشل المحاسبة لا يكسر تدفق الطلب
CREATE OR REPLACE FUNCTION public._cashback_try_post_journal(p_ledger_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_res jsonb;
BEGIN
    v_res := post_cashback_journal(p_ledger_id);
    IF COALESCE((v_res->>'success')::boolean, false) = false THEN
        UPDATE ecommerce_cashback_ledger
        SET notes = COALESCE(notes || ' | ', '') || 'JE: ' || COALESCE(v_res->>'error', '؟')
        WHERE id = p_ledger_id;
    END IF;
EXCEPTION WHEN OTHERS THEN
    UPDATE ecommerce_cashback_ledger
    SET notes = COALESCE(notes || ' | ', '') || 'JE exception: ' || SQLERRM
    WHERE id = p_ledger_id;
END;
$$;

-- ── 7) تريغر التحقق قبل إدراج الطلب (استرداد + لقطة الكسب) ──────────────
CREATE OR REPLACE FUNCTION public.ecommerce_orders_cashback_before()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_settings ecommerce_cashback_settings%ROWTYPE;
    v_balance  NUMERIC;
    v_cap      NUMERIC;
    v_earn_base NUMERIC;
    v_tenant   UUID;
BEGIN
    -- tenant قد لا يصل من المتجر — اشتقاقه من المتجر
    v_tenant := COALESCE(NEW.tenant_id, (SELECT tenant_id FROM ecommerce_stores WHERE id = NEW.store_id));

    SELECT * INTO v_settings FROM ecommerce_cashback_settings WHERE store_id = NEW.store_id;

    -- 7-أ) التحقق من الاسترداد (لا ثقة بالمتصفح)
    IF COALESCE(NEW.cashback_used, 0) > 0 THEN
        IF v_settings IS NULL OR v_settings.enabled = false THEN
            RAISE EXCEPTION 'cashback is not enabled for this store';
        END IF;
        IF NEW.customer_id IS NULL THEN
            RAISE EXCEPTION 'cashback requires a registered customer';
        END IF;
        -- الهوية: الزبون نفسه أو أدمن/خدمة
        IF NOT (NEW.customer_id = current_customer_id()
                OR v_tenant = get_user_tenant_id()
                OR is_platform_admin()
                OR auth.role() = 'service_role') THEN
            RAISE EXCEPTION 'cashback redemption identity mismatch';
        END IF;

        v_balance := cashback_confirmed_balance(NEW.customer_id);
        IF NEW.cashback_used > v_balance + 0.01 THEN
            RAISE EXCEPTION 'cashback amount exceeds balance (% > %)', NEW.cashback_used, v_balance;
        END IF;

        v_cap := ROUND((COALESCE(NEW.subtotal,0) - COALESCE(NEW.discount_amount,0))
                       * v_settings.redeem_cap_percent / 100, 2);
        IF NEW.cashback_used > v_cap + 0.01 THEN
            RAISE EXCEPTION 'cashback amount exceeds redeem cap (% > %)', NEW.cashback_used, v_cap;
        END IF;
    END IF;

    -- 7-ب) لقطة الكسب المتوقع (تُعلَّق حتى التسليم)
    NEW.cashback_earned := 0;
    IF v_settings.enabled AND NEW.customer_id IS NOT NULL AND v_settings.rate_percent > 0 THEN
        v_earn_base := COALESCE(NEW.subtotal,0) - COALESCE(NEW.discount_amount,0) - COALESCE(NEW.cashback_used,0);
        IF v_earn_base >= GREATEST(v_settings.min_order_amount, 0.01) THEN
            NEW.cashback_earned := ROUND(v_earn_base * v_settings.rate_percent / 100, 2);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_orders_cashback_before ON public.ecommerce_orders;
CREATE TRIGGER trg_ecommerce_orders_cashback_before
    BEFORE INSERT ON public.ecommerce_orders
    FOR EACH ROW EXECUTE FUNCTION public.ecommerce_orders_cashback_before();

-- ── 8) تريغر بعد الإدراج: تسجيل حركتي الدفتر ────────────────────────────
CREATE OR REPLACE FUNCTION public.ecommerce_orders_cashback_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_tenant UUID;
    v_settings ecommerce_cashback_settings%ROWTYPE;
    v_ledger_id UUID;
BEGIN
    v_tenant := COALESCE(NEW.tenant_id, (SELECT tenant_id FROM ecommerce_stores WHERE id = NEW.store_id));
    SELECT * INTO v_settings FROM ecommerce_cashback_settings WHERE store_id = NEW.store_id;

    -- استرداد مؤكد فوراً (خُصم من قيمة الطلب المدفوعة)
    IF COALESCE(NEW.cashback_used, 0) > 0 AND NEW.customer_id IS NOT NULL THEN
        INSERT INTO ecommerce_cashback_ledger
            (tenant_id, store_id, customer_id, order_id, entry_type, status,
             amount, currency, confirmed_at, notes)
        VALUES
            (v_tenant, NEW.store_id, NEW.customer_id, NEW.id, 'redeem', 'confirmed',
             NEW.cashback_used, COALESCE(NEW.currency, 'USD'), NOW(),
             'استرداد عند الدفع — طلب ' || NEW.order_number)
        RETURNING id INTO v_ledger_id;
        PERFORM _cashback_try_post_journal(v_ledger_id);
    END IF;

    -- كسب معلّق حتى التسليم
    IF COALESCE(NEW.cashback_earned, 0) > 0 AND NEW.customer_id IS NOT NULL THEN
        INSERT INTO ecommerce_cashback_ledger
            (tenant_id, store_id, customer_id, order_id, entry_type, status,
             amount, rate_percent, currency, notes)
        VALUES
            (v_tenant, NEW.store_id, NEW.customer_id, NEW.id, 'earn', 'pending',
             NEW.cashback_earned, v_settings.rate_percent, COALESCE(NEW.currency, 'USD'),
             'كسب معلّق حتى تسليم الطلب ' || NEW.order_number);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_orders_cashback_after_insert ON public.ecommerce_orders;
CREATE TRIGGER trg_ecommerce_orders_cashback_after_insert
    AFTER INSERT ON public.ecommerce_orders
    FOR EACH ROW EXECUTE FUNCTION public.ecommerce_orders_cashback_after_insert();

-- ── 9) تريغر تحوّل الحالة: تأكيد عند التسليم / عكس عند الإلغاء ──────────
CREATE OR REPLACE FUNCTION public.ecommerce_orders_cashback_on_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_settings ecommerce_cashback_settings%ROWTYPE;
    v_earn ecommerce_cashback_ledger%ROWTYPE;
    v_ledger_id UUID;
    v_tenant UUID;
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    v_tenant := COALESCE(NEW.tenant_id, (SELECT tenant_id FROM ecommerce_stores WHERE id = NEW.store_id));
    SELECT * INTO v_settings FROM ecommerce_cashback_settings WHERE store_id = NEW.store_id;
    SELECT * INTO v_earn FROM ecommerce_cashback_ledger
    WHERE order_id = NEW.id AND entry_type = 'earn' LIMIT 1;

    -- التسليم/الاكتمال ⇒ تأكيد الكسب المعلّق + قيد محاسبي
    IF NEW.status IN ('delivered', 'completed') THEN
        IF v_earn.id IS NOT NULL AND v_earn.status = 'pending' THEN
            UPDATE ecommerce_cashback_ledger
            SET status = 'confirmed',
                confirmed_at = NOW(),
                expires_at = CASE WHEN v_settings.expiry_days IS NOT NULL
                                  THEN NOW() + (v_settings.expiry_days || ' days')::interval
                                  ELSE NULL END
            WHERE id = v_earn.id;
            PERFORM _cashback_try_post_journal(v_earn.id);
        END IF;

    -- الإلغاء/الإرجاع ⇒ إسقاط الكسب + إعادة المُسترَدّ للرصيد
    ELSIF NEW.status IN ('cancelled', 'returned') THEN
        IF v_earn.id IS NOT NULL THEN
            IF v_earn.status = 'pending' THEN
                UPDATE ecommerce_cashback_ledger
                SET status = 'cancelled',
                    notes = COALESCE(notes || ' | ', '') || 'أُلغي مع الطلب'
                WHERE id = v_earn.id;
            ELSIF v_earn.status = 'confirmed' THEN
                INSERT INTO ecommerce_cashback_ledger
                    (tenant_id, store_id, customer_id, order_id, entry_type, status,
                     amount, currency, confirmed_at, notes)
                VALUES
                    (v_tenant, NEW.store_id, v_earn.customer_id, NEW.id, 'reverse', 'confirmed',
                     v_earn.amount, v_earn.currency, NOW(),
                     'عكس كسب مؤكد — إلغاء/إرجاع الطلب ' || NEW.order_number)
                ON CONFLICT DO NOTHING
                RETURNING id INTO v_ledger_id;
                IF v_ledger_id IS NOT NULL THEN
                    PERFORM _cashback_try_post_journal(v_ledger_id);
                END IF;
            END IF;
        END IF;

        -- إعادة الكاش باك المستخدَم إلى رصيد الزبون (تسوية موجبة)
        IF COALESCE(NEW.cashback_used, 0) > 0 AND NEW.customer_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM ecommerce_cashback_ledger
               WHERE order_id = NEW.id AND entry_type = 'adjust'
           ) THEN
            INSERT INTO ecommerce_cashback_ledger
                (tenant_id, store_id, customer_id, order_id, entry_type, status,
                 amount, currency, confirmed_at, notes)
            VALUES
                (v_tenant, NEW.store_id, NEW.customer_id, NEW.id, 'adjust', 'confirmed',
                 NEW.cashback_used, COALESCE(NEW.currency, 'USD'), NOW(),
                 'إعادة كاش باك مستخدَم — إلغاء/إرجاع الطلب ' || NEW.order_number)
            RETURNING id INTO v_ledger_id;
            PERFORM _cashback_try_post_journal(v_ledger_id);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_orders_cashback_on_status ON public.ecommerce_orders;
CREATE TRIGGER trg_ecommerce_orders_cashback_on_status
    AFTER UPDATE OF status ON public.ecommerce_orders
    FOR EACH ROW EXECUTE FUNCTION public.ecommerce_orders_cashback_on_status();

-- ── 10) بذر الإعدادات للمتاجر القائمة (معطّل افتراضياً — يُفعَّل من اللوحة) ──
INSERT INTO public.ecommerce_cashback_settings (store_id, tenant_id, enabled, rate_percent, redeem_cap_percent, min_order_amount)
SELECT s.id, s.tenant_id, false, 7.00, 50.00, 0
FROM public.ecommerce_stores s
ON CONFLICT (store_id) DO NOTHING;

COMMIT;
