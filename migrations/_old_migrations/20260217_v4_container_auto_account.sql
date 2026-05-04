-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  إنشاء حسابات الكونتينرات تلقائياً تحت 1143 بضاعة في الطريق        ║
-- ║  2026-02-17 — Phase 6B Container Auto-Account                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        EXECUTE 'ALTER TABLE containers ADD COLUMN IF NOT EXISTS container_account_id UUID REFERENCES chart_of_accounts(id)';
        EXECUTE 'COMMENT ON COLUMN containers.container_account_id IS ''حساب بضاعة بالطريق الفرعي — يُنشأ تلقائياً تحت 1143''';
    END IF;
END $$;

-- 2️⃣ دالة إنشاء حساب فرعي تلقائياً عند إنشاء كونتينر
CREATE OR REPLACE FUNCTION create_container_transit_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company_id UUID;
    v_tenant_id UUID;
    v_chart_type VARCHAR(30);
    v_git_parent_id UUID;  -- حساب 1143 الأب
    v_new_account_id UUID;
    v_next_seq INT;
    v_new_code VARCHAR(20);
    v_container_ref VARCHAR(100);
    v_current_asset_type UUID;
BEGIN
    -- Get company info
    v_company_id := NEW.company_id;
    
    SELECT c.tenant_id, c.chart_type INTO v_tenant_id, v_chart_type
    FROM companies c WHERE c.id = v_company_id;

    -- Only for extended and fabric_extended charts (simple doesn't have GIT)
    IF v_chart_type NOT IN ('extended', 'fabric_extended') THEN
        RAISE NOTICE '⏭️ الشجرة القياسية لا تدعم حسابات الكونتينرات — تخطي';
        RETURN NEW;
    END IF;

    -- Find parent account 1143 (بضاعة في الطريق)
    SELECT id INTO v_git_parent_id
    FROM chart_of_accounts
    WHERE company_id = v_company_id 
      AND account_code = '1143' 
      AND is_detail = false 
      AND is_active = true
    LIMIT 1;

    IF v_git_parent_id IS NULL THEN
        RAISE NOTICE '⚠️ حساب 1143 (بضاعة بالطريق) غير موجود للشركة % — لم يتم إنشاء حساب', v_company_id;
        RETURN NEW;
    END IF;

    -- Get next sequence number
    SELECT COALESCE(MAX(
        CASE 
            WHEN account_code ~ '^1143[0-9]+$' 
            THEN CAST(SUBSTRING(account_code FROM 5) AS INT)
            ELSE 0 
        END
    ), 0) + 1 INTO v_next_seq
    FROM chart_of_accounts
    WHERE company_id = v_company_id 
      AND parent_id = v_git_parent_id;

    v_new_code := '1143' || v_next_seq::TEXT;

    -- Container reference for account name
    v_container_ref := COALESCE(NEW.container_number, NEW.shipment_number, 'CNT-' || v_next_seq);

    -- Get account type
    SELECT id INTO v_current_asset_type FROM account_types WHERE code = 'CURRENT_ASSET';

    -- Create sub-account
    INSERT INTO chart_of_accounts (
        tenant_id, company_id, account_code, 
        name_ar, name_en, 
        account_type_id, parent_id, 
        is_detail, is_active
    )
    VALUES (
        v_tenant_id, v_company_id, v_new_code,
        'كونتينر ' || v_container_ref,
        'Container ' || v_container_ref,
        v_current_asset_type, v_git_parent_id,
        true, true
    )
    RETURNING id INTO v_new_account_id;

    -- Link back to container
    NEW.container_account_id := v_new_account_id;

    RAISE NOTICE '✅ تم إنشاء حساب % (%) للكونتينر %', v_new_code, v_new_account_id, v_container_ref;

    RETURN NEW;
END;
$$;

-- 3️⃣ إنشاء الـ Trigger
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_create_container_account ON containers';
        EXECUTE '
        CREATE TRIGGER trg_create_container_account
            BEFORE INSERT ON containers
            FOR EACH ROW
            EXECUTE FUNCTION create_container_transit_account();';
    END IF;
END $$;

COMMENT ON FUNCTION create_container_transit_account() IS 'V4 — ينشئ حساب فرعي تلقائي تحت 1143 لكل كونتينر جديد (Extended + Fabric فقط)';

-- 4️⃣ إنشاء حسابات للكونتينرات الموجودة (بأثر رجعي)
DO $$
DECLARE
    v_rec RECORD;
    v_git_parent_id UUID;
    v_new_account_id UUID;
    v_next_seq INT;
    v_new_code VARCHAR(20);
    v_container_ref VARCHAR(100);
    v_current_asset_type UUID;
    v_tenant_id UUID;
    v_chart_type VARCHAR(30);
    v_count INT := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'containers') THEN
    SELECT id INTO v_current_asset_type FROM account_types WHERE code = 'CURRENT_ASSET';

    FOR v_rec IN 
        SELECT c.id, c.company_id, c.container_number, c.shipment_number, c.container_account_id
        FROM containers c
        WHERE c.container_account_id IS NULL
        ORDER BY c.created_at
    LOOP
        -- Get company info
        SELECT comp.tenant_id, comp.chart_type INTO v_tenant_id, v_chart_type
        FROM companies comp WHERE comp.id = v_rec.company_id;

        IF v_chart_type NOT IN ('extended', 'fabric_extended') THEN
            CONTINUE;
        END IF;

        -- Find 1143
        SELECT id INTO v_git_parent_id
        FROM chart_of_accounts
        WHERE company_id = v_rec.company_id 
          AND account_code = '1143' 
          AND is_detail = false
        LIMIT 1;

        IF v_git_parent_id IS NULL THEN
            CONTINUE;
        END IF;

        -- Next seq
        SELECT COALESCE(MAX(
            CASE WHEN account_code ~ '^1143[0-9]+$' 
            THEN CAST(SUBSTRING(account_code FROM 5) AS INT) ELSE 0 END
        ), 0) + 1 INTO v_next_seq
        FROM chart_of_accounts
        WHERE company_id = v_rec.company_id AND parent_id = v_git_parent_id;

        v_new_code := '1143' || v_next_seq::TEXT;
        v_container_ref := COALESCE(v_rec.container_number, v_rec.shipment_number, 'CNT-' || v_next_seq);

        -- Create account
        INSERT INTO chart_of_accounts (
            tenant_id, company_id, account_code, name_ar, name_en,
            account_type_id, parent_id, is_detail, is_active
        ) VALUES (
            v_tenant_id, v_rec.company_id, v_new_code,
            'كونتينر ' || v_container_ref, 'Container ' || v_container_ref,
            v_current_asset_type, v_git_parent_id, true, true
        ) RETURNING id INTO v_new_account_id;

        -- Link
        EXECUTE 'UPDATE containers SET container_account_id = $1 WHERE id = $2' USING v_new_account_id, v_rec.id;
        v_count := v_count + 1;
        RAISE NOTICE '  ✅ كونتينر %: حساب %', v_container_ref, v_new_code;
    END LOOP;

    RAISE NOTICE '🏁 تم إنشاء % حساب للكونتينرات الموجودة', v_count;
    END IF;
END;
$$;

-- ============================================================
-- Add missing columns to container_items
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'container_items') THEN
        EXECUTE 'ALTER TABLE container_items ADD COLUMN IF NOT EXISTS color_name TEXT';
        EXECUTE 'ALTER TABLE container_items ADD COLUMN IF NOT EXISTS material_code TEXT';
        EXECUTE 'ALTER TABLE container_items ADD COLUMN IF NOT EXISTS expected_sell_price NUMERIC DEFAULT 0';
    END IF;
END $$;
