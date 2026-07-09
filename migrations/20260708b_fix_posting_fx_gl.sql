-- ============================================================================
-- 20260708b_fix_posting_fx_gl.sql
-- Systemic foreign-currency GL fix for the posting layer.
--
-- BUG (same class as fixed in 20260708a for the payment functions):
--   The GL base columns on journal_entry_lines (debit / credit) and the
--   journal_entries header totals (total_debit / total_credit) must hold the
--   BASE-currency amount = FACE x exchange_rate. The *_fc columns hold the
--   FACE (foreign) amount. FX direction is BASE-per-FOREIGN: base = face x rate
--   (verified against JournalVoucherTab.tsx). The affected posting functions
--   were writing the FACE amount straight into the base columns (no multiply),
--   so any invoice/return in a non-base currency posted an under/over-stated
--   GL. For base currency (rate = 1) every change below is a strict NO-OP.
--
-- CRITICAL COST-LINE NUANCE (why we do NOT blindly multiply every line):
--   Inventory is valued in BASE currency. A sales invoice's COGS line and the
--   matching inventory-out line are therefore ALREADY in base — multiplying
--   them by the SALES fx rate would introduce a brand-new bug. So each JE is
--   split conceptually into:
--     * transaction-currency lines (revenue, AR/AP, tax, cash/bank, shipping,
--       discount, the invoice's own net/total)  -> base = face x rate, fc = face
--     * base-currency lines (COGS, inventory valuation)  -> LEFT UNCHANGED
--   Each sub-entry is independently balanced, so the whole entry stays balanced
--   after conversion (Sigma base debit = Sigma base credit).
--
-- SCOPE (only WIRED, rate-available functions are modified here):
--   * post_sales_invoice     -> FIXED  (rate: sales_transactions.exchange_rate)
--   * post_sales_return      -> FIXED  (rate: sales_returns.exchange_rate)
--   * post_purchase_invoice  -> FIXED  (rate: purchase_(invoices|transactions).exchange_rate)
--
-- DELIBERATELY NOT TOUCHED (see report):
--   * post_purchase_return                    -> NO exchange_rate column on
--        purchase_returns; cannot convert without inventing a rate. FLAGGED.
--   * create_purchase_journal_entry           -> orphan trigger fn, not attached
--        to any trigger, references legacy non-existent `accounts` table. DEAD.
--   * create_container_expense_journal_entry  -> references non-existent
--        `accounts` table + wrong `journal_entry_id` line column. DEAD/DRIFTED.
--   * create_container_journal_entry          -> not wired; its only lines are
--        inventory valuation (goods + landed costs) which are ALREADY base — no
--        transaction-currency line exists to convert. No-op even if wired.
--
-- Everything else (account resolution, guards, fallbacks, post_journal_entry
-- calls, party columns, security/search_path, messages) is preserved verbatim.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) post_sales_invoice
--    Rate: v_trx.exchange_rate (COALESCE 1).
--    CONVERTED (transaction currency): receivable (v_total + v_shipping),
--      revenue (v_net_amount), tax (v_tax_amount), shipping (v_shipping),
--      and the header totals for those portions.
--    LEFT AS BASE (already base): COGS debit + inventory-out credit
--      (v_cost_amount). *_fc mirrors face throughout.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_trx         sales_transactions%ROWTYPE;
    v_account_ar  UUID;
    v_account_rev UUID;
    v_account_tax UUID;
    v_account_cogs UUID;
    v_account_inv UUID;
    v_je_id       UUID;
    v_user_id     UUID;
    v_total       NUMERIC(15,4) := 0;
    v_net_amount  NUMERIC(15,4) := 0;
    v_tax_amount  NUMERIC(15,4) := 0;
    v_delivered_subtotal NUMERIC(15,4) := 0;
    v_delivered_discount NUMERIC(15,4) := 0;
    v_cost_amount NUMERIC(15,4) := 0;
    v_line_num    INT := 0;
    v_entry_no    TEXT;
    v_inv_label   TEXT;
    v_item_count  INT := 0;
    v_has_delivered BOOLEAN := false;
    v_cogs_recorded BOOLEAN := false;
    v_total_debit  NUMERIC(15,4) := 0;
    v_total_credit NUMERIC(15,4) := 0;
    v_shipping     NUMERIC(15,4) := 0;
    v_account_shipping UUID;
    v_rate        NUMERIC := 1;   -- FX: base = face x v_rate (BASE-per-FOREIGN)
BEGIN
    v_user_id := auth.uid();

    SELECT * INTO v_trx FROM sales_transactions WHERE id = p_invoice_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
    END IF;

    PERFORM assert_can_access_company(v_trx.company_id);

    IF v_trx.is_posted = true THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة مُرحَّلة مسبقاً');
    END IF;

    v_rate := COALESCE(v_trx.exchange_rate, 1);

    v_inv_label := COALESCE(v_trx.invoice_no, v_trx.draft_no, LEFT(p_invoice_id::text, 8));

    SELECT COUNT(*) INTO v_item_count
    FROM sales_transaction_items sti
    WHERE sti.transaction_id = p_invoice_id
      AND COALESCE(sti.delivered_qty, 0) > 0;

    v_has_delivered := v_item_count > 0;

    SELECT
        COALESCE(SUM(line_sub), 0),
        COALESCE(SUM(line_disc), 0),
        COALESCE(SUM((line_sub - line_disc) * line_tax_rate / 100), 0),
        COALESCE(SUM(line_cost), 0)
    INTO v_delivered_subtotal, v_delivered_discount, v_tax_amount, v_cost_amount
    FROM (
        SELECT
            COALESCE(sti.delivered_qty, 0) * COALESCE(sti.unit_price, 0) AS line_sub,
            CASE WHEN COALESCE(sti.discount_percent, 0) > 0
                 THEN COALESCE(sti.delivered_qty, 0) * COALESCE(sti.unit_price, 0) * sti.discount_percent / 100
                 ELSE COALESCE(sti.discount_amount, 0) * (COALESCE(sti.delivered_qty, 0) / NULLIF(sti.quantity, 0))
            END AS line_disc,
            COALESCE(sti.tax_rate, 0) AS line_tax_rate,
            COALESCE(sti.cost_price, 0) * COALESCE(sti.delivered_qty, 0) AS line_cost
        FROM sales_transaction_items sti
        WHERE sti.transaction_id = p_invoice_id
    ) t;

    v_net_amount := v_delivered_subtotal - v_delivered_discount;
    v_total := v_net_amount + v_tax_amount;

    IF NOT v_has_delivered THEN
        v_total := COALESCE(v_trx.total_amount, 0);
        v_tax_amount := COALESCE(v_trx.tax_amount, 0);
        v_net_amount := v_total - v_tax_amount;

        SELECT COALESCE(SUM(COALESCE(sti.cost_price, 0) * COALESCE(sti.quantity, 0)), 0)
        INTO v_cost_amount
        FROM sales_transaction_items sti
        WHERE sti.transaction_id = p_invoice_id;
    END IF;

    v_shipping := GREATEST(COALESCE(v_trx.shipping_amount, 0), 0);

    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'مبلغ الفاتورة صفر أو سالب — تحقق من الكميات المسلّمة');
    END IF;

    -- ── الحسابات (عبر المحلّل الموحّد؛ يبقى حساب العميل الطرفي أولوية) ──
    IF v_trx.customer_id IS NOT NULL THEN
        SELECT c.receivable_account_id INTO v_account_ar
        FROM customers c
        WHERE c.id = v_trx.customer_id AND c.receivable_account_id IS NOT NULL;

        IF v_account_ar IS NULL THEN
            SELECT id INTO v_account_ar
            FROM chart_of_accounts
            WHERE is_party_account = true AND party_type = 'customer' AND party_id = v_trx.customer_id
            LIMIT 1;
        END IF;
    END IF;

    IF v_account_ar IS NULL THEN
        v_account_ar := resolve_posting_account(v_trx.company_id, 'sales_receivable');
    END IF;

    v_account_rev := resolve_posting_account(v_trx.company_id, 'sales_revenue');

    IF v_tax_amount > 0 THEN
        v_account_tax := resolve_posting_account(v_trx.company_id, 'sales_tax_output');
    END IF;

    v_account_cogs := resolve_posting_account(v_trx.company_id, 'sales_cogs');
    v_account_inv  := resolve_posting_account(v_trx.company_id, 'sales_inventory');

    IF v_shipping > 0 THEN
        v_account_shipping := resolve_posting_account(v_trx.company_id, 'sales_shipping');
        IF v_account_shipping IS NULL THEN v_account_shipping := v_account_rev; END IF;
    END IF;

    IF v_account_ar IS NULL OR v_account_rev IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حسابات المبيعات غير مكتملة — تحقق من الذمم المدينة (1130/113) وحساب الإيرادات (411/4100)');
    END IF;

    IF v_tax_amount > 0 AND v_account_tax IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حساب ضريبة المخرجات (2130/2141/2150) غير موجود رغم وجود ضريبة — أضِفه قبل الترحيل');
    END IF;

    v_cogs_recorded := (v_cost_amount > 0 AND v_account_cogs IS NOT NULL AND v_account_inv IS NOT NULL);

    UPDATE sales_transactions
    SET stage = 'posted',
        is_posted = true,
        posted_at = NOW(),
        posted_by = v_user_id,
        subtotal = v_delivered_subtotal,
        discount_amount = v_delivered_discount,
        tax_amount = v_tax_amount,
        total_amount = v_total + v_shipping,
        updated_at = NOW()
    WHERE id = p_invoice_id;

    IF v_has_delivered THEN
        UPDATE sales_transaction_items
        SET quantity = delivered_qty,
            subtotal = delivered_qty * unit_price,
            discount_amount = CASE WHEN COALESCE(discount_percent, 0) > 0
                                   THEN (delivered_qty * unit_price) * (discount_percent / 100)
                                   ELSE COALESCE(discount_amount, 0) * (delivered_qty / NULLIF(quantity, 0))
                              END,
            tax_amount = ((delivered_qty * unit_price)
                          - CASE WHEN COALESCE(discount_percent, 0) > 0
                                 THEN (delivered_qty * unit_price) * (discount_percent / 100)
                                 ELSE COALESCE(discount_amount, 0) * (delivered_qty / NULLIF(quantity, 0))
                            END
                         ) * (COALESCE(tax_rate, 0) / 100),
            total = ((delivered_qty * unit_price)
                     - CASE WHEN COALESCE(discount_percent, 0) > 0
                            THEN (delivered_qty * unit_price) * (discount_percent / 100)
                            ELSE COALESCE(discount_amount, 0) * (delivered_qty / NULLIF(quantity, 0))
                       END
                    ) * (1 + COALESCE(tax_rate, 0) / 100)
        WHERE transaction_id = p_invoice_id
          AND COALESCE(delivered_qty, 0) > 0;
    END IF;

    v_entry_no := 'JE-S-' || to_char(NOW(), 'YYMMDD') || '-' ||
                  LPAD(nextval('journal_entry_number_seq')::text, 4, '0');

    -- Header totals in BASE: transaction-currency portions x rate + cost pair (already base).
    v_total_debit  := round((v_total + v_shipping) * v_rate, 2)
                      + CASE WHEN v_cogs_recorded THEN v_cost_amount ELSE 0 END;
    v_total_credit := round(v_net_amount * v_rate, 2)
                      + CASE WHEN v_tax_amount > 0 THEN round(v_tax_amount * v_rate, 2) ELSE 0 END
                      + round(v_shipping * v_rate, 2)
                      + CASE WHEN v_cogs_recorded THEN v_cost_amount ELSE 0 END;

    INSERT INTO journal_entries (
        tenant_id, company_id, entry_number, entry_date,
        description,
        reference_type, reference_id, reference_number,
        currency, exchange_rate,
        total_debit, total_credit,
        status, is_posted, created_by
    ) VALUES (
        v_trx.tenant_id, v_trx.company_id, v_entry_no, CURRENT_DATE,
        'فاتورة مبيعات — ' || v_inv_label || CASE WHEN v_has_delivered THEN ' (بناءً على المسلّم فعلياً)' ELSE '' END,
        'sales_invoice', p_invoice_id, v_inv_label,
        COALESCE(v_trx.currency, 'SAR'), v_rate,
        v_total_debit, v_total_credit,
        'draft', false, v_user_id
    ) RETURNING id INTO v_je_id;

    -- Receivable (transaction currency): base = face x rate, fc = face.
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id, description,
        debit, credit, debit_fc, credit_fc, party_type, party_id
    ) VALUES (
        v_trx.tenant_id, v_je_id, v_line_num, v_account_ar,
        'ذمم مدينة — ' || COALESCE(v_trx.customer_name, ''),
        round((v_total + v_shipping) * v_rate, 2), 0, v_total + v_shipping, 0, 'customer', v_trx.customer_id
    );

    -- Revenue (transaction currency).
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id, description,
        debit, credit, debit_fc, credit_fc
    ) VALUES (
        v_trx.tenant_id, v_je_id, v_line_num, v_account_rev,
        'إيرادات مبيعات — ' || v_inv_label,
        0, round(v_net_amount * v_rate, 2), 0, v_net_amount
    );

    -- Output tax (transaction currency).
    IF v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc
        ) VALUES (
            v_trx.tenant_id, v_je_id, v_line_num, v_account_tax,
            'ضريبة مخرجات — ' || v_inv_label,
            0, round(v_tax_amount * v_rate, 2), 0, v_tax_amount
        );
    END IF;

    -- Shipping revenue (transaction currency).
    IF v_shipping > 0 AND v_account_shipping IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc
        ) VALUES (
            v_trx.tenant_id, v_je_id, v_line_num, v_account_shipping,
            'إيراد شحن — ' || v_inv_label,
            0, round(v_shipping * v_rate, 2), 0, v_shipping
        );
    END IF;

    -- COGS + inventory-out: ALREADY BASE currency (inventory valuation). LEFT UNCHANGED.
    IF v_cogs_recorded THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc
        ) VALUES (
            v_trx.tenant_id, v_je_id, v_line_num, v_account_cogs,
            'تكلفة مبيعات — ' || v_inv_label,
            v_cost_amount, 0, v_cost_amount, 0
        );

        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (
            tenant_id, entry_id, line_number, account_id, description,
            debit, credit, debit_fc, credit_fc
        ) VALUES (
            v_trx.tenant_id, v_je_id, v_line_num, v_account_inv,
            'إخراج مخزون — ' || v_inv_label,
            0, v_cost_amount, 0, v_cost_amount
        );
    END IF;

    PERFORM post_journal_entry(v_je_id, v_user_id);

    UPDATE sales_transactions SET journal_entry_id = v_je_id WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'invoice_number', v_inv_label,
        'journal_entry_id', v_je_id,
        'customer_account_id', v_account_ar,
        'based_on_delivered', v_has_delivered,
        'delivered_subtotal', v_delivered_subtotal,
        'delivered_discount', v_delivered_discount,
        'net_amount', v_net_amount,
        'tax_amount', v_tax_amount,
        'shipping_amount', v_shipping,
        'total_amount', v_total + v_shipping,
        'cost_amount', v_cost_amount,
        'cogs_recorded', v_cogs_recorded,
        'gross_profit', v_net_amount - v_cost_amount,
        'message', CASE
            WHEN v_has_delivered THEN 'تم ترحيل فاتورة المبيعات بنجاح — بناءً على الكميات المسلّمة فعلياً'
            ELSE 'تم ترحيل فاتورة المبيعات بنجاح — بناءً على الفاتورة الأصلية (لا توجد كميات مسلّمة)'
        END
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;

-- ============================================================================
-- 2) post_sales_return
--    Rate: v_return.exchange_rate (COALESCE 1) — sales_returns has the column.
--    CONVERTED (transaction currency): revenue reduction (v_net), tax reduction
--      (v_tax), receivable reduction (v_total), and the header totals for those.
--    LEFT AS BASE (already base): inventory-in debit + COGS-reversal credit
--      (v_cost_total). This function previously populated *_fc = face; we keep
--      that and now correctly set base = face x rate for the tx-ccy lines.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.post_sales_return(p_return_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_return       sales_returns%ROWTYPE;
    v_item         RECORD;
    v_je_id        UUID;
    v_user_id      UUID;
    v_net          NUMERIC(15,4) := 0;
    v_tax          NUMERIC(15,4) := 0;
    v_total        NUMERIC(15,4) := 0;
    v_cost_total   NUMERIC(15,4) := 0;
    v_item_cost    NUMERIC(15,4) := 0;
    v_src_txn      UUID;
    v_movement_count INT := 0;
    v_line_num     INT := 0;
    v_account_ar   UUID;
    v_account_rev  UUID;
    v_account_tax  UUID;
    v_account_inv  UUID;
    v_account_cogs UUID;
    v_movement_number VARCHAR(50);
    v_wh_id        UUID;
    v_cogs_recorded BOOLEAN := false;
    v_total_debit  NUMERIC(15,4) := 0;
    v_total_credit NUMERIC(15,4) := 0;
    v_rate         NUMERIC := 1;   -- FX: base = face x v_rate (BASE-per-FOREIGN)
BEGIN
    v_user_id := auth.uid();

    SELECT * INTO v_return FROM sales_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'مرتجع المبيعات غير موجود');
    END IF;

    PERFORM assert_can_access_company(v_return.company_id);

    IF v_return.status = 'posted' THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرتجع مُرحَّل مسبقاً');
    END IF;

    v_rate := COALESCE(v_return.exchange_rate, 1);

    v_wh_id := COALESCE(p_warehouse_id, v_return.warehouse_id);

    IF v_return.invoice_id IS NOT NULL THEN
        v_src_txn := v_return.invoice_id;
    ELSIF v_return.source_type = 'ecommerce' AND v_return.source_id IS NOT NULL THEN
        SELECT sales_invoice_id INTO v_src_txn FROM ecommerce_orders WHERE id = v_return.source_id;
    END IF;

    FOR v_item IN SELECT * FROM sales_return_items WHERE return_id = p_return_id
    LOOP
        v_movement_count := v_movement_count + 1;

        v_item_cost := 0;
        IF v_src_txn IS NOT NULL THEN
            SELECT sti.cost_price INTO v_item_cost
            FROM sales_transaction_items sti
            WHERE sti.transaction_id = v_src_txn
              AND ( (v_item.material_id IS NOT NULL AND sti.material_id = v_item.material_id)
                 OR (v_item.product_id  IS NOT NULL AND sti.product_id  = v_item.product_id) )
            ORDER BY sti.cost_price DESC NULLS LAST
            LIMIT 1;
            v_item_cost := COALESCE(v_item_cost, 0);
        END IF;
        v_cost_total := v_cost_total + v_item.quantity_returned * v_item_cost;

        v_movement_number := 'SR-' || COALESCE(v_return.return_number, '') || '-' || v_movement_count;

        INSERT INTO inventory_movements (
            tenant_id, company_id,
            movement_number, movement_date,
            movement_type,
            product_id, material_id, variant_id,
            to_warehouse_id,
            quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number,
            notes, created_by
        ) VALUES (
            v_return.tenant_id, v_return.company_id,
            v_movement_number, CURRENT_DATE,
            'return_in',
            v_item.product_id, v_item.material_id, v_item.variant_id,
            v_wh_id,
            v_item.quantity_returned, v_item_cost,
            v_item.quantity_returned * v_item_cost,
            'sales_return', p_return_id, v_return.return_number,
            'مرتجع مبيعات', v_user_id
        );
    END LOOP;

    SELECT
        COALESCE(SUM(COALESCE(sri.subtotal, sri.total - COALESCE(sri.tax_amount, 0),
                              sri.quantity_returned * COALESCE(sri.unit_price, 0))), 0),
        COALESCE(SUM(COALESCE(sri.tax_amount, 0)), 0)
    INTO v_net, v_tax
    FROM sales_return_items sri
    WHERE sri.return_id = p_return_id;
    v_total := v_net + v_tax;

    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'قيمة المرتجع صفر أو سالبة');
    END IF;

    -- ── الحسابات (عبر المحلّل الموحّد؛ يبقى حساب العميل الطرفي أولوية) ──
    IF v_return.customer_id IS NOT NULL THEN
        SELECT receivable_account_id INTO v_account_ar
        FROM customers WHERE id = v_return.customer_id AND receivable_account_id IS NOT NULL;
        IF v_account_ar IS NULL THEN
            SELECT id INTO v_account_ar FROM chart_of_accounts
            WHERE is_party_account = true AND party_type = 'customer' AND party_id = v_return.customer_id
            LIMIT 1;
        END IF;
    END IF;
    IF v_account_ar IS NULL THEN
        v_account_ar := resolve_posting_account(v_return.company_id, 'sales_receivable');
    END IF;

    v_account_rev := resolve_posting_account(v_return.company_id, 'sales_revenue');

    IF v_tax > 0 THEN
        v_account_tax := resolve_posting_account(v_return.company_id, 'sales_tax_output');
    END IF;

    v_account_inv  := resolve_posting_account(v_return.company_id, 'sales_inventory');
    v_account_cogs := resolve_posting_account(v_return.company_id, 'sales_cogs');

    IF v_account_ar IS NULL OR v_account_rev IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حسابات المرتجع غير مكتملة — تحقق من الذمم المدينة والإيرادات');
    END IF;
    IF v_tax > 0 AND v_account_tax IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'حساب ضريبة المخرجات غير موجود رغم وجود ضريبة في المرتجع');
    END IF;

    v_cogs_recorded := (v_cost_total > 0 AND v_account_inv IS NOT NULL AND v_account_cogs IS NOT NULL);

    UPDATE sales_returns SET status = 'posted', updated_at = NOW() WHERE id = p_return_id;

    -- Header totals in BASE: transaction-currency portions x rate + cost pair (already base).
    v_total_debit  := round(v_net * v_rate, 2) + round(v_tax * v_rate, 2)
                      + CASE WHEN v_cogs_recorded THEN v_cost_total ELSE 0 END;
    v_total_credit := round(v_total * v_rate, 2)
                      + CASE WHEN v_cogs_recorded THEN v_cost_total ELSE 0 END;

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id,
        entry_date, entry_type, description,
        reference_type, reference_id, reference_number,
        total_debit, total_credit,
        status, is_posted, created_by
    ) VALUES (
        v_return.tenant_id, v_return.company_id, v_return.branch_id,
        CURRENT_DATE, 'auto',
        'مرتجع مبيعات — ' || COALESCE(v_return.return_number, ''),
        'sales_return', p_return_id, v_return.return_number,
        v_total_debit, v_total_credit,
        'draft', false, v_user_id
    ) RETURNING id INTO v_je_id;

    -- Revenue reduction (transaction currency).
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
    VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_rev, 'تخفيض إيرادات — مرتجع', round(v_net * v_rate, 2), 0, v_net, 0);

    -- Tax reduction (transaction currency).
    IF v_tax > 0 AND v_account_tax IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_tax, 'تخفيض ضريبة — مرتجع', round(v_tax * v_rate, 2), 0, v_tax, 0);
    END IF;

    -- Receivable reduction (transaction currency).
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc, party_type, party_id)
    VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_ar, 'تخفيض ذمم مدينة — مرتجع', 0, round(v_total * v_rate, 2), 0, v_total, 'customer', v_return.customer_id);

    -- Inventory-in + COGS-reversal: ALREADY BASE currency (inventory valuation). LEFT UNCHANGED.
    IF v_cogs_recorded THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_inv, 'إرجاع مخزون — مرتجع', v_cost_total, 0, v_cost_total, 0);

        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_return.tenant_id, v_je_id, v_line_num, v_account_cogs, 'عكس تكلفة مبيعات — مرتجع', 0, v_cost_total, 0, v_cost_total);
    END IF;

    PERFORM post_journal_entry(v_je_id, v_user_id);

    RETURN jsonb_build_object(
        'success', true,
        'return_id', p_return_id,
        'movements_created', v_movement_count,
        'net_amount', v_net,
        'tax_amount', v_tax,
        'total_amount', v_total,
        'cost_reversed', v_cost_total,
        'cogs_reversed', v_cogs_recorded,
        'journal_entry_id', v_je_id,
        'message', 'تم ترحيل مرتجع المبيعات بنجاح'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;

-- ============================================================================
-- 3) post_purchase_invoice
--    Rate: v_exchange_rate (COALESCE 1) sourced from purchase_invoices.exchange_rate
--      or purchase_transactions.exchange_rate.
--    ALL THREE lines are transaction currency (the invoice's own net/total):
--      purchases (v_purch_debit), input tax (v_tax_amount), payable (v_total).
--      There is NO base-cost/COGS line in this entry (it books the purchase
--      value denominated in the invoice currency), so every line converts.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_source     TEXT;
    v_tenant_id  UUID;
    v_company_id UUID;
    v_branch_id  UUID;
    v_supplier_id UUID;
    v_supplier_name TEXT;
    v_invoice_number TEXT;
    v_invoice_date DATE;
    v_currency   TEXT;
    v_exchange_rate NUMERIC;
    v_is_posted  BOOLEAN;
    v_je_id      UUID;
    v_user_id    UUID;
    v_account_purchases UUID;
    v_account_ap        UUID;
    v_account_tax       UUID;
    v_net_amount NUMERIC(15,4);
    v_tax_amount NUMERIC(15,4);
    v_total      NUMERIC(15,4);
    v_purch_debit NUMERIC(15,4);
    v_line_num   INT := 0;
    v_rate       NUMERIC := 1;   -- FX: base = face x v_rate (BASE-per-FOREIGN)
BEGIN
    v_user_id := auth.uid();

    SELECT 'invoices', pi.tenant_id, pi.company_id, pi.branch_id, pi.supplier_id, pi.supplier_name,
           pi.invoice_number, COALESCE(pi.invoice_date, CURRENT_DATE),
           COALESCE(pi.currency, 'SAR'), COALESCE(pi.exchange_rate, 1),
           COALESCE(pi.is_posted, false), COALESCE(pi.total_amount, 0), COALESCE(pi.tax_amount, 0)
      INTO v_source, v_tenant_id, v_company_id, v_branch_id, v_supplier_id, v_supplier_name,
           v_invoice_number, v_invoice_date, v_currency, v_exchange_rate, v_is_posted, v_total, v_tax_amount
    FROM purchase_invoices pi WHERE pi.id = p_invoice_id FOR UPDATE;

    IF v_source IS NULL THEN
        SELECT 'transactions', pt.tenant_id, pt.company_id, pt.branch_id, pt.supplier_id, pt.supplier_name,
               COALESCE(pt.invoice_no, pt.draft_no, LEFT(pt.id::text, 8)), COALESCE(pt.invoice_date, pt.doc_date, CURRENT_DATE),
               COALESCE(pt.currency, 'SAR'), COALESCE(pt.exchange_rate, 1),
               COALESCE(pt.is_posted, false), COALESCE(pt.total_amount, 0), COALESCE(pt.tax_amount, 0)
          INTO v_source, v_tenant_id, v_company_id, v_branch_id, v_supplier_id, v_supplier_name,
               v_invoice_number, v_invoice_date, v_currency, v_exchange_rate, v_is_posted, v_total, v_tax_amount
        FROM purchase_transactions pt WHERE pt.id = p_invoice_id FOR UPDATE;
    END IF;

    IF v_source IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة غير موجودة');
    END IF;

    PERFORM assert_can_access_company(v_company_id);

    IF v_is_posted = true THEN
        RETURN jsonb_build_object('success', false, 'error', 'الفاتورة مُرحَّلة مسبقاً');
    END IF;

    v_rate := COALESCE(v_exchange_rate, 1);

    v_net_amount := v_total - v_tax_amount;

    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'مبلغ الفاتورة صفر');
    END IF;

    -- ── الحسابات (عبر المحلّل الموحّد) ──
    -- المشتريات: إعدادات default_purchase_account_id ثم الأكواد 521/5100/5000/52/1400
    v_account_purchases := resolve_posting_account(v_company_id, 'purchase_expense');

    -- الذمم الدائنة: أولوية حساب المورد الطرفي، ثم is_payable، ثم المحلّل الموحّد
    IF v_supplier_id IS NOT NULL THEN
        SELECT id INTO v_account_ap FROM chart_of_accounts
        WHERE company_id = v_company_id AND is_party_account = true
          AND party_type = 'supplier' AND party_id = v_supplier_id LIMIT 1;
    END IF;
    IF v_account_ap IS NULL THEN
        SELECT id INTO v_account_ap FROM chart_of_accounts
        WHERE company_id = v_company_id
          AND COALESCE(is_payable, false) = true
          AND COALESCE(is_group, false) = false
        ORDER BY account_code LIMIT 1;
    END IF;
    IF v_account_ap IS NULL THEN
        v_account_ap := resolve_posting_account(v_company_id, 'purchase_payable');
    END IF;

    IF v_tax_amount > 0 THEN
        v_account_tax := resolve_posting_account(v_company_id, 'purchase_tax_input');
    END IF;

    IF v_account_purchases IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'لم يُعثر على حساب المشتريات (5100/5000/1400)', 'invoice_id', p_invoice_id);
    END IF;
    IF v_account_ap IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'لم يُعثر على حساب الذمم الدائنة (2100/2000)', 'invoice_id', p_invoice_id);
    END IF;

    v_purch_debit := CASE WHEN v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN v_net_amount ELSE v_total END;

    IF v_source = 'invoices' THEN
        UPDATE purchase_invoices
        SET status = 'posted', is_posted = true, posted_at = NOW(), updated_at = NOW()
        WHERE id = p_invoice_id;
    ELSE
        UPDATE purchase_transactions
        SET stage = 'posted', is_posted = true, posted_at = NOW(), posted_by = v_user_id, updated_at = NOW()
        WHERE id = p_invoice_id;
    END IF;

    -- Header totals in BASE: whole entry is transaction currency -> x rate.
    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_date, entry_type, description,
        reference_type, reference_id, reference_number, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by
    ) VALUES (
        v_tenant_id, v_company_id, v_branch_id,
        v_invoice_date, 'auto',
        'فاتورة مشتريات — ' || COALESCE(v_invoice_number, ''),
        'purchase_invoice', p_invoice_id, v_invoice_number,
        v_currency, v_rate,
        round(v_total * v_rate, 2), round(v_total * v_rate, 2), 'draft', false, v_user_id
    ) RETURNING id INTO v_je_id;

    -- Purchases (transaction currency): base = face x rate, fc = face.
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
    VALUES (v_tenant_id, v_je_id, v_line_num, v_account_purchases,
            'مشتريات — ' || COALESCE(v_invoice_number, ''), round(v_purch_debit * v_rate, 2), 0, v_purch_debit, 0);

    -- Input tax (transaction currency).
    IF v_tax_amount > 0 AND v_account_tax IS NOT NULL THEN
        v_line_num := v_line_num + 1;
        INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc)
        VALUES (v_tenant_id, v_je_id, v_line_num, v_account_tax,
                'ضريبة مدخلات — ' || COALESCE(v_invoice_number, ''), round(v_tax_amount * v_rate, 2), 0, v_tax_amount, 0);
    END IF;

    -- Payable (transaction currency).
    v_line_num := v_line_num + 1;
    INSERT INTO journal_entry_lines (tenant_id, entry_id, line_number, account_id, description, debit, credit, debit_fc, credit_fc, party_type, party_id)
    VALUES (v_tenant_id, v_je_id, v_line_num, v_account_ap,
            'ذمم دائنة — ' || COALESCE(v_supplier_name, '') || ' — ' || COALESCE(v_invoice_number, ''),
            0, round(v_total * v_rate, 2), 0, v_total, 'supplier', v_supplier_id);

    PERFORM post_journal_entry(v_je_id, v_user_id);

    IF v_source = 'invoices' THEN
        UPDATE purchase_invoices SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    ELSE
        UPDATE purchase_transactions SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true, 'invoice_id', p_invoice_id, 'invoice_number', v_invoice_number,
        'journal_entry_id', v_je_id, 'total_amount', v_total, 'tax_amount', v_tax_amount,
        'source', v_source,
        'message', 'تم ترحيل فاتورة المشتريات بنجاح'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE, 'invoice_id', p_invoice_id);
END;
$function$;

COMMIT;

-- ============================================================================
-- NOT MODIFIED (intentionally) — see migration header + task report:
--   * post_purchase_return  : purchase_returns has NO exchange_rate column;
--         converting would require inventing a rate. Flagged for human review.
--   * create_purchase_journal_entry : orphan trigger fn (not attached to any
--         trigger) + references non-existent legacy `accounts` table. Dead.
--   * create_container_expense_journal_entry : references non-existent
--         `accounts` table + non-existent `journal_entry_id` line column. Dead.
--   * create_container_journal_entry : not wired; only inventory-valuation
--         lines (goods + landed cost) which are already base — nothing to
--         convert even if it were wired.
-- ============================================================================
