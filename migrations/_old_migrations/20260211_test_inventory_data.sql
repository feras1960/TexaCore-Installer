-- ═══════════════════════════════════════════════════════════════
-- 🧪 بيانات تجريبية: رولونات أقمشة لمستودعي اودبسا + كييف
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_tenant_id UUID := 'e3a8b7ef-6f27-43c1-bd3f-61d183a97a47';
    v_company_id UUID := '1313232a-6ad3-4002-891c-a9a9e8849a93';
    v_wh_odessa UUID;
    v_wh_kyiv UUID;
    v_branch_id UUID;
BEGIN
    -- جلب مستودع اودبسا
    SELECT id, branch_id INTO v_wh_odessa, v_branch_id
    FROM warehouses WHERE company_id = v_company_id AND name_ar ILIKE '%اودبسا%' LIMIT 1;
    IF v_wh_odessa IS NULL THEN 
        RAISE NOTICE 'مستودع اودبسا غير موجود! Skipping test data insertion.'; 
        RETURN;
    END IF;
    RAISE NOTICE 'مستودع اودبسا: %', v_wh_odessa;

    -- إنشاء مستودع كييف
    SELECT id INTO v_wh_kyiv FROM warehouses WHERE company_id = v_company_id AND code = 'WH-KYIV' LIMIT 1;
    IF v_wh_kyiv IS NULL THEN
        INSERT INTO warehouses (id, tenant_id, company_id, branch_id, code, name, name_ar, name_en, warehouse_type, is_active)
        VALUES (gen_random_uuid(), v_tenant_id, v_company_id, v_branch_id, 'WH-KYIV', 'مستودع كييف', 'مستودع كييف', 'Kyiv Warehouse', 'regular', true)
        RETURNING id INTO v_wh_kyiv;
    END IF;
    RAISE NOTICE 'مستودع كييف: %', v_wh_kyiv;

    -- ══════════ مستودع اودبسا ══════════

    -- قطن سادة 100%
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '4a9b437a-5157-4481-ae35-0b7380d2be80', 'COT-PL-001', 60.00, 60.00, 0, v_wh_odessa, 'available', 35.00),
    (v_tenant_id, v_company_id, '4a9b437a-5157-4481-ae35-0b7380d2be80', 'COT-PL-002', 55.00, 38.50, 12.00, v_wh_odessa, 'partial', 35.00),
    (v_tenant_id, v_company_id, '4a9b437a-5157-4481-ae35-0b7380d2be80', 'COT-PL-003', 50.00, 50.00, 50.00, v_wh_odessa, 'reserved', 36.50),
    (v_tenant_id, v_company_id, '4a9b437a-5157-4481-ae35-0b7380d2be80', 'COT-PL-004', 45.00, 8.50, 0, v_wh_odessa, 'available', 34.00),
    (v_tenant_id, v_company_id, '4a9b437a-5157-4481-ae35-0b7380d2be80', 'COT-PL-005', 65.00, 65.00, 0, v_wh_odessa, 'available', 36.00);

    -- قطن تويل
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, 'b77188f9-a8a4-44ff-b4f3-0906e58f0dea', 'COT-TW-001', 48.00, 48.00, 0, v_wh_odessa, 'available', 42.00),
    (v_tenant_id, v_company_id, 'b77188f9-a8a4-44ff-b4f3-0906e58f0dea', 'COT-TW-002', 52.00, 34.00, 15.00, v_wh_odessa, 'partial', 42.00),
    (v_tenant_id, v_company_id, 'b77188f9-a8a4-44ff-b4f3-0906e58f0dea', 'COT-TW-003', 45.00, 45.00, 0, v_wh_odessa, 'available', 43.50);

    -- قطن مصري
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, 'e90d8c55-8e72-4c9e-820e-c77436b97bd4', 'CTN-EG-001', 70.00, 70.00, 0, v_wh_odessa, 'available', 22.00),
    (v_tenant_id, v_company_id, 'e90d8c55-8e72-4c9e-820e-c77436b97bd4', 'CTN-EG-002', 65.00, 40.00, 20.00, v_wh_odessa, 'partial', 22.00),
    (v_tenant_id, v_company_id, 'e90d8c55-8e72-4c9e-820e-c77436b97bd4', 'CTN-EG-003', 60.00, 60.00, 60.00, v_wh_odessa, 'reserved', 23.00);

    -- حموي ملون
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, 'df3f8e13-b996-4598-8148-a44878666570', 'HMW-ML-001', 55.00, 55.00, 0, v_wh_odessa, 'available', 28.00),
    (v_tenant_id, v_company_id, 'df3f8e13-b996-4598-8148-a44878666570', 'HMW-ML-002', 50.00, 32.00, 10.00, v_wh_odessa, 'partial', 28.00);

    -- قطني حموي ملون
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '2e490b8b-63a0-46cc-86ae-ad7b443c6999', 'QHM-001', 60.00, 45.00, 0, v_wh_odessa, 'available', 26.00),
    (v_tenant_id, v_company_id, '2e490b8b-63a0-46cc-86ae-ad7b443c6999', 'QHM-002', 55.00, 55.00, 30.00, v_wh_odessa, 'reserved', 26.00);

    -- كتان طبيعي
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '7e0a45fa-3de5-4cb7-8ea4-68ad572126ed', 'LIN-NT-001', 35.00, 35.00, 0, v_wh_odessa, 'available', 55.00),
    (v_tenant_id, v_company_id, '7e0a45fa-3de5-4cb7-8ea4-68ad572126ed', 'LIN-NT-002', 40.00, 25.00, 8.00, v_wh_odessa, 'partial', 55.00);

    -- كتان تركي
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, 'c0971d9a-d704-4a9b-be8b-31880e77ef70', 'LIN-TR-001', 45.00, 28.00, 0, v_wh_odessa, 'available', 30.00),
    (v_tenant_id, v_company_id, 'c0971d9a-d704-4a9b-be8b-31880e77ef70', 'LIN-TR-002', 50.00, 50.00, 25.00, v_wh_odessa, 'reserved', 30.00);

    -- بوليستر هندي
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '24090e7b-bfff-4076-b08e-ac2e7fe11047', 'PLY-IN-001', 100.00, 100.00, 0, v_wh_odessa, 'available', 12.00),
    (v_tenant_id, v_company_id, '24090e7b-bfff-4076-b08e-ac2e7fe11047', 'PLY-IN-002', 90.00, 55.00, 20.00, v_wh_odessa, 'partial', 12.00),
    (v_tenant_id, v_company_id, '24090e7b-bfff-4076-b08e-ac2e7fe11047', 'PLY-IN-003', 95.00, 95.00, 0, v_wh_odessa, 'available', 12.50);

    -- بوليستر ساتان
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '5df9330c-7547-43ab-ba7a-78503adbf6d2', 'PLY-ST-001', 80.00, 80.00, 30.00, v_wh_odessa, 'reserved', 28.00),
    (v_tenant_id, v_company_id, '5df9330c-7547-43ab-ba7a-78503adbf6d2', 'PLY-ST-002', 75.00, 52.00, 0, v_wh_odessa, 'available', 28.00);

    -- حرير طبيعي
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '4512bc22-e01d-4ad7-a06a-2d435efdf1d5', 'SLK-NT-001', 25.00, 25.00, 15.00, v_wh_odessa, 'reserved', 150.00),
    (v_tenant_id, v_company_id, '4512bc22-e01d-4ad7-a06a-2d435efdf1d5', 'SLK-NT-002', 20.00, 14.00, 0, v_wh_odessa, 'available', 155.00);

    -- حرير صيني
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '6d0e8382-4ac3-49b6-8a70-b63687779cf9', 'SLK-CH-001', 45.00, 45.00, 0, v_wh_odessa, 'available', 70.00),
    (v_tenant_id, v_company_id, '6d0e8382-4ac3-49b6-8a70-b63687779cf9', 'SLK-CH-002', 40.00, 28.00, 10.00, v_wh_odessa, 'partial', 70.00);

    -- ══════════ مستودع كييف ══════════

    -- قطن سادة
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '4a9b437a-5157-4481-ae35-0b7380d2be80', 'COT-PL-K01', 58.00, 58.00, 0, v_wh_kyiv, 'available', 35.50),
    (v_tenant_id, v_company_id, '4a9b437a-5157-4481-ae35-0b7380d2be80', 'COT-PL-K02', 50.00, 42.00, 0, v_wh_kyiv, 'available', 35.00);

    -- قطن تويل
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, 'b77188f9-a8a4-44ff-b4f3-0906e58f0dea', 'COT-TW-K01', 46.00, 46.00, 20.00, v_wh_kyiv, 'reserved', 42.00),
    (v_tenant_id, v_company_id, 'b77188f9-a8a4-44ff-b4f3-0906e58f0dea', 'COT-TW-K02', 40.00, 40.00, 0, v_wh_kyiv, 'available', 43.00);

    -- قطن مصري
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, 'e90d8c55-8e72-4c9e-820e-c77436b97bd4', 'CTN-EG-K01', 55.00, 55.00, 0, v_wh_kyiv, 'available', 22.50),
    (v_tenant_id, v_company_id, 'e90d8c55-8e72-4c9e-820e-c77436b97bd4', 'CTN-EG-K02', 50.00, 35.00, 15.00, v_wh_kyiv, 'partial', 22.00);

    -- حموي ملون
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, 'df3f8e13-b996-4598-8148-a44878666570', 'HMW-ML-K01', 48.00, 48.00, 0, v_wh_kyiv, 'available', 29.00);

    -- قطني حموي
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '2e490b8b-63a0-46cc-86ae-ad7b443c6999', 'QHM-K01', 50.00, 50.00, 0, v_wh_kyiv, 'available', 27.00);

    -- كتان طبيعي
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '7e0a45fa-3de5-4cb7-8ea4-68ad572126ed', 'LIN-NT-K01', 30.00, 30.00, 0, v_wh_kyiv, 'available', 56.00);

    -- بوليستر هندي
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '24090e7b-bfff-4076-b08e-ac2e7fe11047', 'PLY-IN-K01', 85.00, 85.00, 85.00, v_wh_kyiv, 'reserved', 12.00),
    (v_tenant_id, v_company_id, '24090e7b-bfff-4076-b08e-ac2e7fe11047', 'PLY-IN-K02', 80.00, 80.00, 0, v_wh_kyiv, 'available', 12.00);

    -- بوليستر ساتان
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '5df9330c-7547-43ab-ba7a-78503adbf6d2', 'PLY-ST-K01', 70.00, 70.00, 0, v_wh_kyiv, 'available', 29.00);

    -- حرير صيني
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, '6d0e8382-4ac3-49b6-8a70-b63687779cf9', 'SLK-CH-K01', 50.00, 50.00, 50.00, v_wh_kyiv, 'reserved', 72.00);

    -- كتان تركي
    INSERT INTO fabric_rolls (tenant_id, company_id, material_id, roll_number, original_length, current_length, reserved_length, warehouse_id, status, cost_per_meter) VALUES
    (v_tenant_id, v_company_id, 'c0971d9a-d704-4a9b-be8b-31880e77ef70', 'LIN-TR-K01', 42.00, 42.00, 0, v_wh_kyiv, 'available', 31.00);

    RAISE NOTICE '✅ تم بنجاح! 42 رولون (27 اودبسا + 15 كييف)';
END $$;
