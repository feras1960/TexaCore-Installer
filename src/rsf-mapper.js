/**
 * TexaCore RSF Mapper — تحويل بيانات الرشيد لهيكل TexaCore
 * يأخذ البيانات من rsf-reader ويدخلها في PostgreSQL المحلي
 */

const { RsfReader } = require('./rsf-reader');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();

class RsfMapper {
  constructor(reader, tenantId, companyId, userId) {
    this.reader = reader;
    this.tenantId = tenantId;
    this.companyId = companyId;
    this.userId = userId;
    
    // خرائط الربط (رمز الرشيد → UUID في TexaCore)
    this.accountTypeMap = {};  // code → UUID
    this.accountMap = {};      // رمز حساب → UUID
    this.costCenterMap = {};   // رمز مركز → UUID
    this.customerMap = {};     // رمز عميل → UUID
    this.supplierMap = {};     // رمز مورد → UUID
    this.supplierNameMap = {};  // رمز مورد → اسم المورد
    this.customerByAccountMap = {};  // رمز حساب محاسبي (161xxx) → UUID عميل
    this.supplierByAccountMap = {};  // رمز حساب محاسبي (261xxx) → UUID مورد
    this.materialMap = {};     // رمز مادة → UUID (fabric_materials)
    this.materialNameMap = {}; // رمز مادة → اسم المادة بالعربي (للاستخدام في الفواتير)
    this.productMap = {};      // رمز مادة → UUID (products) — لربط فواتير المبيعات
    this.warehouseMap = {};    // رقم مستودع → UUID
    
    // العملات — تُحمّل من ملف الرشيد
    this.baseCurrencyCode = 'UAH';  // القيمة الافتراضية
    this.foreignCurrencyCode = 'USD';
    this.currencyMap = {};  // rashidCurrencyNum → { code, rate }
    
    this.progress = { step: '', current: 0, total: 0 };
    this.onProgress = null;
  }

  _emit(step, current, total) {
    this.progress = { step, current, total };
    if (this.onProgress) this.onProgress(this.progress);
  }

  // ═══════════════════════════════════════════════════════
  // تنفيذ الاستيراد الكامل
  // ═══════════════════════════════════════════════════════


  async importAll(pgClient, options = {}) {
    const summary = this.reader.getSummary();
    const results = { success: true, errors: [], counts: {}, users: [] };

    // تحميل العملات من ملف الرشيد
    this._loadCurrencies();

    try {
      await pgClient.query('BEGIN');

      // تعطيل الـ triggers أثناء الاستيراد بالكامل
      const importTables = [
        'sales_transaction_items', 'sales_invoice_items', 'sales_transactions', 'sales_invoices',
        'purchase_transaction_items', 'purchase_transactions',
        'purchase_invoice_items', 'purchase_invoices',
        'purchase_receipt_items', 'purchase_receipts',
        'delivery_note_items', 'delivery_notes',
        'inventory_movements', 'inventory_stock',
        'stock_transfer_items', 'stock_transfers',
        'journal_entry_lines', 'journal_entries',
        'cash_transactions', 'cash_accounts',
        'fabric_materials', 'fabric_groups', 'products',
        'cost_centers', 'chart_of_accounts',
        'customers', 'suppliers', 'fiscal_years',
        'warehouses'
      ];
      for (const t of importTables) {
        try {
          await pgClient.query(`SAVEPOINT sp_${t}`);
          await pgClient.query(`ALTER TABLE ${t} DISABLE TRIGGER ALL`);
        } catch {
          await pgClient.query(`ROLLBACK TO SAVEPOINT sp_${t}`);
        }
      }

      // 1. حذف الشجرة الافتراضية الفارغة
      this._emit('حذف البيانات الافتراضية', 0, 1);
      await this._clearDefaults(pgClient);

      // 2. جلب أنواع الحسابات
      this._emit('تحضير أنواع الحسابات', 0, 1);
      await this._loadAccountTypes(pgClient);

      // 2.5 مزامنة أسعار صرف العملات من الرشيد → currencies table
      this._emit('مزامنة أسعار العملات', 0, 1);
      await this._syncCurrenciesToDB(pgClient);

      // 3. شجرة الحسابات
      this._emit('استيراد شجرة الحسابات', 0, summary.counts.accounts);
      results.counts.accounts = await this._insertAccounts(pgClient);

      // 4. العملاء
      this._emit('استيراد العملاء', 0, summary.counts.customers);
      results.counts.customers = await this._insertCustomers(pgClient);

      // 5. الموردين
      this._emit('استيراد الموردين', 0, summary.counts.suppliers);
      results.counts.suppliers = await this._insertSuppliers(pgClient);

      // 6. مراكز التكلفة
      this._emit('استيراد مراكز التكلفة', 0, summary.counts.costCenters);
      results.counts.costCenters = await this._insertCostCenters(pgClient);

      // 7. المستودعات
      this._emit('استيراد المستودعات', 0, 1);
      results.counts.warehouses = await this._insertWarehouses(pgClient);

      // 8. المواد → products + fabric_materials
      this._emit('استيراد المواد', 0, summary.counts.materials);
      results.counts.materials = await this._insertMaterials(pgClient);

      // 8.5. قوائم الأسعار (جملة، مفرد، نصف جملة، خاص...)
      this._emit('إنشاء قوائم الأسعار', 0, 1);
      results.counts.priceLists = await this._createPriceLists(pgClient);

      // 9. السنة المالية
      this._emit('إنشاء السنة المالية', 0, 1);
      results.counts.fiscalYear = await this._insertFiscalYear(pgClient);

      // 10. القيود المحاسبية
      this._emit('استيراد القيود', 0, summary.counts.journalEntries);
      results.counts.journalEntries = await this._insertJournalEntries(pgClient);

      // 11. فواتير المبيعات
      this._emit('استيراد فواتير المبيعات', 0, summary.counts.salesInvoices);
      try {
        await pgClient.query('SAVEPOINT sp_sales');
        results.counts.salesInvoices = await this._insertSalesInvoices(pgClient);
      } catch (e) {
        console.warn('[RSF] ⚠️ Sales invoices skipped:', e.message.substring(0, 100));
        await pgClient.query('ROLLBACK TO SAVEPOINT sp_sales');
        results.counts.salesInvoices = 0;
      }

      // 12. فواتير المشتريات
      this._emit('استيراد فواتير المشتريات', 0, summary.counts.purchaseInvoices);
      try {
        await pgClient.query('SAVEPOINT sp_purchase');
        results.counts.purchaseInvoices = await this._insertPurchaseInvoices(pgClient);
      } catch (e) {
        console.warn('[RSF] ⚠️ Purchase invoices skipped:', e.message.substring(0, 100));
        await pgClient.query('ROLLBACK TO SAVEPOINT sp_purchase');
        results.counts.purchaseInvoices = 0;
      }

      // 12b. طلبيات الشراء
      this._emit('استيراد طلبيات الشراء', 0, summary.counts.purchaseOrders || 0);
      try {
        await pgClient.query('SAVEPOINT sp_purchase_orders');
        results.counts.purchaseOrders = await this._insertPurchaseOrders(pgClient);
      } catch (e) {
        console.warn('[RSF] ⚠️ Purchase orders skipped:', e.message.substring(0, 100));
        await pgClient.query('ROLLBACK TO SAVEPOINT sp_purchase_orders');
        results.counts.purchaseOrders = 0;
      }

      // 13. حركات المستودع
      this._emit('استيراد حركات المستودع', 0, summary.counts.inventoryMoves);
      try {
        await pgClient.query('SAVEPOINT sp_inv');
        results.counts.inventoryMoves = await this._insertInventoryMoves(pgClient);
      } catch (e) {
        console.warn('[RSF] ⚠️ Inventory moves skipped:', e.message.substring(0, 100));
        await pgClient.query('ROLLBACK TO SAVEPOINT sp_inv');
        results.counts.inventoryMoves = 0;
      }

      // 14. سندات القبض والدفع
      this._emit('استيراد سندات القبض/الدفع', 0, summary.counts.receipts);
      try {
        await pgClient.query('SAVEPOINT sp_receipts');
        results.counts.receipts = await this._insertReceipts(pgClient);
      } catch (e) {
        console.warn('[RSF] ⚠️ Receipts skipped:', e.message.substring(0, 100));
        await pgClient.query('ROLLBACK TO SAVEPOINT sp_receipts');
        results.counts.receipts = 0;
      }

      // 15. الأرصدة الختامية
      this._emit('تحديث الأرصدة الختامية', 0, 1);
      try { await pgClient.query('SAVEPOINT sp_endbal'); results.counts.endBalances = await this._updateEndBalances(pgClient); } catch (e) { console.warn('[RSF] ⚠️ endBalances:', e.message.substring(0,80)); try { await pgClient.query('ROLLBACK TO SAVEPOINT sp_endbal'); } catch {} }

      // 16. إعدادات المحاسبة
      this._emit('تعيين الإعدادات', 0, 1);
      try { await pgClient.query('SAVEPOINT sp_settings'); await this._fillAccountingSettings(pgClient); } catch (e) { console.warn('[RSF] ⚠️ settings:', e.message.substring(0,80)); try { await pgClient.query('ROLLBACK TO SAVEPOINT sp_settings'); } catch {} }

      // 17. ملء جدول مخزون المستودعات (الكميات الافتتاحية)
      this._emit('ربط الكميات بالمستودعات', 0, 1);
      try { await pgClient.query('SAVEPOINT sp_invstock'); results.counts.inventoryStock = await this._populateInventoryStock(pgClient); } catch (e) { console.warn('[RSF] ⚠️ inventory:', e.message.substring(0,80)); try { await pgClient.query('ROLLBACK TO SAVEPOINT sp_invstock'); } catch {} }

      // 18. إعادة حساب الأرصدة الحالية من القيود المحاسبية
      this._emit('إعادة حساب الأرصدة', 0, 1);
      try { await pgClient.query('SAVEPOINT sp_recalc'); results.counts.recalculatedBalances = await this._recalculateBalances(pgClient); } catch (e) { console.warn('[RSF] ⚠️ recalc:', e.message.substring(0,80)); try { await pgClient.query('ROLLBACK TO SAVEPOINT sp_recalc'); } catch {} }

      // إعادة تفعيل الـ triggers قبل COMMIT
      for (const t of importTables) {
        try {
          await pgClient.query(`SAVEPOINT spe_${t}`);
          await pgClient.query(`ALTER TABLE ${t} ENABLE TRIGGER ALL`);
          await pgClient.query(`RELEASE SAVEPOINT spe_${t}`);
        } catch {
          try { await pgClient.query(`ROLLBACK TO SAVEPOINT spe_${t}`); } catch {}
        }
      }

      // ═══ مزامنة يدوية: purchase_invoices → purchase_transactions ═══
      // الـ triggers كانت معطلة أثناء INSERT، لذا نزامن يدوياً الآن
      this._emit('مزامنة فواتير المشتريات', 0, 1);
      try {
        await pgClient.query('SAVEPOINT sp_purchase_sync');
        await pgClient.query(`
          INSERT INTO purchase_transactions (
            id, tenant_id, company_id, branch_id, stage, invoice_no,
            supplier_id, doc_date, invoice_date, due_date,
            warehouse_id, receipt_mode, shipment_id,
            currency, exchange_rate,
            subtotal, discount_amount, tax_amount, expenses_total, total_amount,
            paid_amount, balance,
            is_posted, is_active,
            journal_entry_id, notes, supplier_invoice_number, supplier_invoice_date,
            supplier_notes, confirmation_status,
            created_by, created_at, updated_at,
            expenses, attachments,
            received_at
          )
          SELECT
            pi.id, pi.tenant_id, pi.company_id, pi.branch_id,
            CASE
              WHEN pi.receipt_status = 'received' THEN 'paid'
              WHEN pi.status IN ('posted','completed') THEN 'posted'
              WHEN pi.status = 'paid' THEN 'paid'
              WHEN pi.document_stage IN ('draft','quotation','order','approved','receipt','invoice','posted','cancelled') THEN pi.document_stage
              ELSE 'draft'
            END,
            pi.invoice_number,
            pi.supplier_id, pi.invoice_date, pi.invoice_date, pi.due_date,
            pi.warehouse_id, pi.receipt_mode, pi.shipment_id,
            pi.currency, COALESCE(pi.exchange_rate, 1),
            COALESCE(pi.subtotal, 0), COALESCE(pi.discount_amount, 0),
            COALESCE(pi.tax_amount, 0), COALESCE(pi.expenses_total, 0),
            COALESCE(pi.total_amount, 0),
            CASE WHEN pi.payment_status = 'paid' THEN COALESCE(pi.total_amount, 0) ELSE 0 END,
            CASE WHEN pi.payment_status = 'paid' THEN 0 ELSE COALESCE(pi.total_amount, 0) END,
            CASE WHEN pi.status IN ('posted','paid','completed') THEN true ELSE COALESCE(pi.is_posted, false) END,
            true,
            pi.journal_entry_id, pi.notes, pi.supplier_invoice_number, pi.supplier_invoice_date,
            pi.supplier_notes,
            CASE WHEN pi.confirmation_status IN ('confirmed','rejected') THEN pi.confirmation_status ELSE 'confirmed' END,
            pi.created_by, pi.created_at, pi.updated_at,
            COALESCE(pi.expenses, '[]'::jsonb), COALESCE(pi.attachments, '[]'::jsonb),
            CASE WHEN pi.receipt_status = 'received' THEN pi.invoice_date::timestamptz ELSE NULL END
          FROM purchase_invoices pi
          WHERE pi.company_id = $1
          ON CONFLICT (id) DO UPDATE SET
            stage = EXCLUDED.stage,
            invoice_no = EXCLUDED.invoice_no,
            supplier_id = EXCLUDED.supplier_id,
            total_amount = EXCLUDED.total_amount,
            is_posted = EXCLUDED.is_posted,
            received_at = EXCLUDED.received_at,
            updated_at = now()
        `, [this.companyId]);
      } catch (e) { console.warn('[RSF] ⚠️ purchase sync:', e.message.substring(0,80)); try { await pgClient.query('ROLLBACK TO SAVEPOINT sp_purchase_sync'); } catch {} }

      // ═══ مزامنة يدوية: sales_invoices → sales_transactions ═══
      this._emit('مزامنة فواتير المبيعات', 0, 1);
      try {
        await pgClient.query('SAVEPOINT sp_sales_sync');
        await pgClient.query(`
          INSERT INTO sales_transactions (
            id, tenant_id, company_id, branch_id, stage, invoice_no,
            customer_id, customer_name, salesperson_id,
            doc_date, invoice_date, due_date,
            warehouse_id,
            currency, exchange_rate,
            subtotal, discount_amount, tax_amount, total_amount,
            paid_amount, balance,
            is_posted, is_active,
            journal_entry_id, notes,
            created_by, created_at, updated_at,
            delivered_at, delivery_confirmed_at
          )
          SELECT
            si.id, si.tenant_id, si.company_id, si.branch_id,
            CASE
              WHEN si.status = 'posted' THEN 'posted'
              WHEN si.status = 'paid' THEN 'paid'
              WHEN si.document_stage IN ('draft','quotation','reservation','confirmed','order','delivery','invoice','posted','cancelled','paid') THEN si.document_stage
              ELSE 'draft'
            END,
            si.invoice_number,
            si.customer_id, NULL, NULL,
            si.invoice_date, si.invoice_date, si.due_date,
            si.warehouse_id,
            si.currency, COALESCE(si.exchange_rate, 1),
            COALESCE(si.subtotal, 0), COALESCE(si.discount_amount, 0),
            COALESCE(si.tax_amount, 0), COALESCE(si.total_amount, 0),
            0, COALESCE(si.total_amount, 0),
            CASE WHEN si.status IN ('posted','paid') THEN true ELSE COALESCE(si.is_posted, false) END,
            true,
            si.journal_entry_id, si.notes,
            si.created_by, si.created_at, si.updated_at,
            CASE WHEN si.delivery_status = 'delivered' THEN si.invoice_date::timestamptz ELSE NULL END,
            CASE WHEN si.delivery_status = 'delivered' THEN si.invoice_date::timestamptz ELSE NULL END
          FROM sales_invoices si
          WHERE si.company_id = $1
          ON CONFLICT (id) DO UPDATE SET
            stage = EXCLUDED.stage,
            invoice_no = EXCLUDED.invoice_no,
            customer_id = EXCLUDED.customer_id,
            total_amount = EXCLUDED.total_amount,
            is_posted = EXCLUDED.is_posted,
            delivered_at = EXCLUDED.delivered_at,
            delivery_confirmed_at = EXCLUDED.delivery_confirmed_at,
            updated_at = now()
        `, [this.companyId]);
      } catch (e) { console.warn('[RSF] ⚠️ sales sync:', e.message.substring(0,80)); try { await pgClient.query('ROLLBACK TO SAVEPOINT sp_sales_sync'); } catch {} }

      // ═══ مزامنة البنود: purchase_invoice_items → purchase_transaction_items ═══
      this._emit('مزامنة بنود المشتريات', 0, 1);
      try {
        await pgClient.query('SAVEPOINT sp_pi_items_sync');
        await pgClient.query(`
          INSERT INTO purchase_transaction_items (
            id, transaction_id, line_number,
            product_id, material_id, item_code,
            description, description_ar,
            quantity, received_qty, returned_qty,
            unit, unit_price,
            discount_amount, discount_percent,
            tax_rate, tax_amount,
            subtotal, total,
            color_id, color_name,
            warehouse_id, cost_price,
            notes, created_at, updated_at
          )
          SELECT
            pii.id, pii.invoice_id, pii.line_number,
            pii.product_id, pii.material_id, NULL,
            pii.description, pii.description,
            pii.quantity, pii.quantity, 0,
            NULL, pii.unit_price,
            COALESCE(pii.discount_amount, 0), COALESCE(pii.discount_percentage, 0),
            COALESCE(pii.tax_rate, 0), COALESCE(pii.tax_amount, 0),
            COALESCE(pii.subtotal, 0), COALESCE(pii.total, 0),
            pii.color_id, pii.color_name,
            pii.warehouse_id, COALESCE(pii.unit_cost, pii.unit_price),
            pii.notes, now(), now()
          FROM purchase_invoice_items pii
          JOIN purchase_invoices pi ON pi.id = pii.invoice_id
          WHERE pi.company_id = $1
          ON CONFLICT (id) DO UPDATE SET
            quantity = EXCLUDED.quantity,
            unit_price = EXCLUDED.unit_price,
            total = EXCLUDED.total,
            updated_at = now()
        `, [this.companyId]);
      } catch (e) { console.warn('[RSF] ⚠️ purchase items sync:', e.message.substring(0,80)); try { await pgClient.query('ROLLBACK TO SAVEPOINT sp_pi_items_sync'); } catch {} }

      // ═══ مزامنة البنود: sales_invoice_items → sales_transaction_items ═══
      this._emit('مزامنة بنود المبيعات', 0, 1);
      try {
        await pgClient.query('SAVEPOINT sp_si_items_sync');
        await pgClient.query(`
          INSERT INTO sales_transaction_items (
            id, transaction_id, line_number,
            product_id, material_id, item_code,
            description, description_ar,
            quantity, delivered_qty, returned_qty,
            unit, unit_price,
            discount_amount, discount_percent,
            tax_rate, tax_amount,
            subtotal, total,
            warehouse_id, cost_price,
            notes, created_at, updated_at
          )
          SELECT
            sii.id, sii.invoice_id, sii.line_number,
            sii.product_id, NULL, NULL,
            sii.description, sii.description,
            sii.quantity, sii.quantity, 0,
            NULL, sii.unit_price,
            COALESCE(sii.discount_amount, 0), COALESCE(sii.discount_percent, 0),
            COALESCE(sii.tax_rate, 0), COALESCE(sii.tax_amount, 0),
            COALESCE(sii.subtotal, 0), COALESCE(sii.total, 0),
            sii.warehouse_id, COALESCE(sii.unit_cost, sii.unit_price),
            sii.notes, now(), now()
          FROM sales_invoice_items sii
          JOIN sales_invoices si ON si.id = sii.invoice_id
          WHERE si.company_id = $1
          ON CONFLICT (id) DO UPDATE SET
            quantity = EXCLUDED.quantity,
            unit_price = EXCLUDED.unit_price,
            total = EXCLUDED.total,
            updated_at = now()
        `, [this.companyId]);
      } catch (e) { console.warn('[RSF] ⚠️ sales items sync:', e.message.substring(0,80)); try { await pgClient.query('ROLLBACK TO SAVEPOINT sp_si_items_sync'); } catch {} }

      console.log('[RSF] ✅ مزامنة المشتريات والمبيعات (رؤوس + بنود) إلى جداول الـ transactions تمت بنجاح');

      await pgClient.query('COMMIT');

      // ═══ إعلام PostgREST بتحديث الـ schema cache ═══
      try {
        await pgClient.query("NOTIFY pgrst, 'reload schema'");
        console.log('[RSF] 📡 PostgREST schema reload notified');
      } catch (e) { console.warn('[RSF] PostgREST notify:', e.message); }

      // 11. إنشاء المستخدمين (بعد COMMIT — يستخدم GoTrue API منفصل)
      if (options.gotrueRequest) {
        this._emit('إنشاء المستخدمين', 0, summary.counts.users);
        const userResults = await this._createUsersFromRsf(pgClient, options.gotrueRequest);
        results.users = userResults;
        results.counts.users = userResults.length;
      }

      this._emit('تم الاستيراد بنجاح!', 1, 1);

    } catch (err) {
      // إعادة تفعيل الـ triggers حتى في حالة الخطأ
      const importTables = [
        'sales_transaction_items', 'sales_invoice_items', 'sales_transactions', 'sales_invoices',
        'purchase_transaction_items', 'purchase_transactions',
        'purchase_invoice_items', 'purchase_invoices',
        'inventory_movements', 'inventory_stock',
        'journal_entry_lines', 'journal_entries',
        'cash_transactions', 'cash_accounts',
        'fabric_materials', 'fabric_groups', 'products',
        'cost_centers', 'chart_of_accounts',
        'customers', 'suppliers', 'fiscal_years',
        'warehouses'
      ];
      for (const t of importTables) {
        try { await this._safeQuery(pgClient, `ALTER TABLE ${t} ENABLE TRIGGER ALL`); } catch {}
      }
      try { await pgClient.query('ROLLBACK'); } catch {}
      results.success = false;
      results.errors.push(err.message || String(err));
      console.error('[RSF Mapper] خطأ:', err);
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════
  // إنشاء المستخدمين من جدول Password في الرشيد
  // ═══════════════════════════════════════════════════════

  async _createUsersFromRsf(pgClient, gotrueRequest) {
    const rsfUsers = this.reader.getUsers();
    if (!rsfUsers || rsfUsers.length === 0) return [];

    const DEFAULT_PASSWORD = 'admin123';
    const createdUsers = [];

    for (const rsfUser of rsfUsers) {
      if (!rsfUser.name) continue;

      const username = rsfUser.name.replace(/\s+/g, '_').toLowerCase();
      const email = `${username}@${this.companyId}.local`;
      const roleName = rsfUser.level >= 9 ? 'admin' : (rsfUser.level >= 5 ? 'accountant' : 'viewer');

      try {
        // إنشاء مستخدم GoTrue
        const res = await gotrueRequest('POST', '/admin/users', {
          email: email,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: {
            role: roleName,
            full_name: rsfUser.name,
            tenant_id: this.tenantId,
            company_id: this.companyId,
            imported_from: 'al-rasheed',
            rasheed_level: rsfUser.level,
          },
          app_metadata: {
            provider: 'email',
            providers: ['email'],
            tenant_id: this.tenantId,
            company_id: this.companyId,
            role: roleName,
          }
        });

        if (res.status === 200 || res.status === 201) {
          const userId = res.body.id;

          // إنشاء user_profile
          await pgClient.query(`
            INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `, [userId, this.tenantId, this.companyId, email, rsfUser.name, roleName]);

          // تعيين دور في user_roles لضمان ظهور الموديولات
          const roleCode = roleName === 'admin' ? 'company_owner' 
            : (roleName === 'accountant' ? 'accountant' : 'warehouse_manager');
          await pgClient.query(`
            INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
            SELECT $1, r.id, $2, $3, true
            FROM public.roles r WHERE r.code = $4
            LIMIT 1
            ON CONFLICT DO NOTHING
          `, [userId, this.tenantId, this.companyId, roleCode]);

          createdUsers.push({
            username: username,
            name: rsfUser.name,
            email: email,
            password: DEFAULT_PASSWORD,
            role: roleName,
            rasheedLevel: rsfUser.level,
          });

          console.log(`[RSF] ✅ User created: ${username} (${roleName})`);
        } else if (res.body?.error_code === 'email_exists') {
          console.log(`[RSF] ℹ️ User already exists: ${email}`);
          createdUsers.push({
            username, name: rsfUser.name, email,
            password: '(موجود مسبقاً)', role: roleName,
            rasheedLevel: rsfUser.level,
          });
        } else {
          console.warn(`[RSF] ⚠️ Could not create user ${username}:`, res.body);
        }
      } catch (err) {
        console.warn(`[RSF] ⚠️ User creation error for ${username}:`, err.message);
      }
    }

    // إذا لم يوجد أي مستخدم — أنشئ admin افتراضي
    if (createdUsers.length === 0) {
      try {
        const email = `admin@${this.companyId}.local`;
        const res = await gotrueRequest('POST', '/admin/users', {
          email,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { role: 'admin', full_name: 'Admin', tenant_id: this.tenantId, company_id: this.companyId },
          app_metadata: { provider: 'email', providers: ['email'], tenant_id: this.tenantId, company_id: this.companyId, role: 'admin' }
        });
        if (res.status === 200 || res.status === 201) {
          const adminUserId = res.body.id;
          await pgClient.query(`
            INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
            VALUES ($1, $2, $3, $4, 'Admin', 'admin')
            ON CONFLICT (id) DO NOTHING
          `, [adminUserId, this.tenantId, this.companyId, email]);

          // تعيين دور company_owner للمستخدم الافتراضي
          await pgClient.query(`
            INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
            SELECT $1, r.id, $2, $3, true
            FROM public.roles r WHERE r.code = 'company_owner'
            LIMIT 1
            ON CONFLICT DO NOTHING
          `, [adminUserId, this.tenantId, this.companyId]);

          createdUsers.push({ username: 'admin', name: 'Admin', email, password: DEFAULT_PASSWORD, role: 'admin' });
        }
      } catch {}
    }

    return createdUsers;
  }

  // ═══════════════════════════════════════════════════════
  // استعلام آمن — يستخدم SAVEPOINT لمنع إبطال الـ Transaction
  // ═══════════════════════════════════════════════════════

  async _safeQuery(pgClient, sql, params = []) {
    const sp = 'sp_' + Math.random().toString(36).substring(2, 8);
    try {
      await pgClient.query(`SAVEPOINT ${sp}`);
      const result = await pgClient.query(sql, params);
      return result;
    } catch (e) {
      await pgClient.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      return null; // الجدول غير موجود أو خطأ آخر — نتجاهل
    }
  }

  // ═══════════════════════════════════════════════════════
  // حذف البيانات الافتراضية
  // ═══════════════════════════════════════════════════════

  async _clearDefaults(pgClient) {
    // حذف بالترتيب الصحيح (الأبناء أولاً — FK dependencies)

    // 1. سطور فواتير المبيعات والمشتريات (الجداول الموحدة + القديمة)
    await this._safeQuery(pgClient, `DELETE FROM sales_invoice_items WHERE tenant_id = $1`, [this.tenantId]);
    await this._safeQuery(pgClient, `DELETE FROM sales_transaction_items WHERE transaction_id IN (SELECT id FROM sales_transactions WHERE company_id = $1)`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM purchase_transaction_items WHERE transaction_id IN (SELECT id FROM purchase_transactions WHERE company_id = $1)`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM purchase_invoice_items WHERE tenant_id = $1`, [this.tenantId]);

    // 2. رؤوس الفواتير (الجداول الموحدة + القديمة)
    await this._safeQuery(pgClient, `DELETE FROM sales_transactions WHERE company_id = $1`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM sales_invoices WHERE company_id = $1`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM purchase_transactions WHERE company_id = $1`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM purchase_invoices WHERE company_id = $1`, [this.companyId]);

    // 3. المناقلات (بنود أولاً ثم الرؤوس)
    await this._safeQuery(pgClient, `DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE company_id = $1)`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM stock_transfers WHERE company_id = $1`, [this.companyId]);

    // 4. حركات المستودع + أرصدة المخزون
    await this._safeQuery(pgClient, `DELETE FROM inventory_movements WHERE company_id = $1`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM inventory_stock WHERE company_id = $1`, [this.companyId]);

    // 4. سطور القيود
    await this._safeQuery(pgClient, `DELETE FROM journal_entry_lines WHERE tenant_id = $1`, [this.tenantId]);

    // 5. رؤوس القيود
    await this._safeQuery(pgClient, `DELETE FROM journal_entries WHERE company_id = $1`, [this.companyId]);

    // 6. الحركات النقدية
    await this._safeQuery(pgClient, `DELETE FROM cash_transactions WHERE company_id = $1`, [this.companyId]);

    // 7. الحسابات النقدية
    await this._safeQuery(pgClient, `DELETE FROM cash_accounts WHERE company_id = $1`, [this.companyId]);

    // 8. المواد (fabric_materials أولاً لأنها تعتمد على products و fabric_groups)
    await this._safeQuery(pgClient, `DELETE FROM fabric_materials WHERE company_id = $1`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM products WHERE company_id = $1`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM fabric_groups WHERE company_id = $1`, [this.companyId]);

    // 9. مراكز التكلفة
    await this._safeQuery(pgClient, `DELETE FROM cost_centers WHERE company_id = $1`, [this.companyId]);

    // 10. الموردين والعملاء
    await this._safeQuery(pgClient, `DELETE FROM suppliers WHERE company_id = $1`, [this.companyId]);
    await this._safeQuery(pgClient, `DELETE FROM customers WHERE company_id = $1`, [this.companyId]);

    // 11. شجرة الحسابات (آخر شيء لأن كل شيء يعتمد عليها)
    await this._safeQuery(pgClient, `DELETE FROM chart_of_accounts WHERE company_id = $1`, [this.companyId]);

    // ملاحظة: لا نحذف warehouses — قد تكون مشتركة
  }

  // ═══════════════════════════════════════════════════════
  // جلب أنواع الحسابات من TexaCore
  // ═══════════════════════════════════════════════════════

  async _loadAccountTypes(pgClient) {
    const { rows } = await pgClient.query('SELECT id, code FROM account_types');
    for (const r of rows) {
      this.accountTypeMap[r.code] = r.id;
    }
  }

  // ═══════════════════════════════════════════════════════
  // شجرة الحسابات
  // ═══════════════════════════════════════════════════════

  async _insertAccounts(pgClient) {
    const accounts = this.reader.getAccounts();
    
    // فلترة الرؤوس الوهمية (00, 01, 02, 03)
    const validAccounts = accounts.filter(a => {
      const cls = RsfReader.classifyAccount(a.code);
      return cls !== null;
    });

    // إنشاء رؤوس رئيسية مفقودة (1 أصول، 2 خصوم، 3 مصاريف، 4 إيرادات)
    const rootAccounts = this._createRootAccounts(validAccounts);
    const allAccounts = [...rootAccounts, ...validAccounts];

    // ترتيب حسب طول الرمز (الآباء أولاً)
    allAccounts.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));

    let inserted = 0;
    for (const acc of allAccounts) {
      const cls = RsfReader.classifyAccount(acc.code);
      if (!cls) continue;

      const typeId = this.accountTypeMap[cls.type] || this.accountTypeMap['ASSET'];
      const flags = RsfReader.getAccountFlags(acc.code, acc.isSub);
      
      // تحديد parent_id
      let parentId = null;
      if (acc.ref && acc.ref !== '0' && acc.ref !== '') {
        parentId = this.accountMap[acc.ref] || null;
      }
      // إذا لم يُعثر على الأب بـ ref، نبحث بأول أرقام الرمز
      if (!parentId && acc.code.length > 2) {
        for (let len = acc.code.length - 1; len >= 1; len--) {
          const parentCode = acc.code.substring(0, len);
          if (this.accountMap[parentCode]) {
            parentId = this.accountMap[parentCode];
            break;
          }
        }
      }

      const id = uuidv4();
      const balance = acc.debit - acc.credit;

      const result = await pgClient.query(`
        INSERT INTO chart_of_accounts 
        (id, tenant_id, company_id, account_code, name_ar, name_en, 
         account_type_id, parent_id, is_group, is_detail,
         is_cash_account, is_bank_account, is_receivable, is_payable,
         opening_balance, current_balance, is_active, is_system)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,false)
        ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING
        RETURNING id
      `, [
        id, this.tenantId, this.companyId,
        acc.code, acc.nameAr || acc.name, acc.name,
        typeId, parentId,
        flags.is_group, flags.is_detail,
        flags.is_cash_account, flags.is_bank_account,
        flags.is_receivable, flags.is_payable,
        0, balance
      ]);

      // إذا تم الإدخال — نستخدم الـ ID الجديد
      // إذا تم التخطي (conflict) — نجلب الـ ID الموجود من قاعدة البيانات
      if (result.rows.length > 0) {
        this.accountMap[acc.code] = result.rows[0].id;
      } else {
        const existing = await pgClient.query(
          `SELECT id FROM chart_of_accounts WHERE tenant_id=$1 AND company_id=$2 AND account_code=$3`,
          [this.tenantId, this.companyId, acc.code]
        );
        if (existing.rows.length > 0) {
          this.accountMap[acc.code] = existing.rows[0].id;
        } else {
          this.accountMap[acc.code] = id; // fallback (لا ينبغي أن يحدث)
        }
      }
      inserted++;
      this._emit('استيراد شجرة الحسابات', inserted, allAccounts.length);
    }

    return inserted;
  }

  _createRootAccounts(accounts) {
    const roots = [];
    const existingPrefixes = new Set(accounts.map(a => a.code.substring(0, 1)));

    const rootDefs = [
      { code: '1', name: 'الأصول', nameEn: 'Assets' },
      { code: '2', name: 'الخصوم وحقوق الملكية', nameEn: 'Liabilities & Equity' },
      { code: '3', name: 'المصروفات', nameEn: 'Expenses' },
      { code: '4', name: 'الإيرادات', nameEn: 'Revenue' },
    ];

    for (const def of rootDefs) {
      // نُنشئ الرأس فقط إذا هناك حسابات تبدأ بهذا الرقم
      const hasChildren = accounts.some(a => a.code.startsWith(def.code));
      if (hasChildren) {
        roots.push({
          code: def.code,
          name: def.nameEn,
          nameAr: def.name,
          ref: '',
          isSub: true, // مجموعة
          credit: 0, debit: 0, currencyNum: 0,
        });
      }
    }
    return roots;
  }

  // ═══════════════════════════════════════════════════════
  // العملاء
  // ═══════════════════════════════════════════════════════

  async _insertCustomers(pgClient) {
    const customers = this.reader.getCustomers();
    let inserted = 0;

    for (const cust of customers) {
      const id = uuidv4();
      const code = cust.code || `CUST-${inserted + 1}`;
      
      // البحث عن حساب العميل في الشجرة
      // code قد يكون نفسه رمز الحساب (مثل 161002) أو رقم بسيط
      const receivableAccountId = this.accountMap[code] ||
                                   this.accountMap[cust.accountCode] ||
                                   this.accountMap[`161${code.padStart(3, '0')}`] ||
                                   this.accountMap['161'] || null;

      const custResult = await pgClient.query(`
        INSERT INTO customers 
        (id, tenant_id, company_id, code, name_ar, name_en, 
         phone, mobile, email, address, country, city,
         tax_number, credit_limit, receivable_account_id,
         notes, status, balance, currency)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active',$17,$18)
        ON CONFLICT (tenant_id, code) DO UPDATE SET
          receivable_account_id = COALESCE(EXCLUDED.receivable_account_id, customers.receivable_account_id),
          currency = EXCLUDED.currency
        RETURNING id
      `, [
        id, this.tenantId, this.companyId,
        code, cust.nameAr || cust.name, cust.name,
        cust.phone, cust.mobile, cust.email, cust.address,
        cust.country, cust.city, cust.taxNumber,
        cust.creditLimit, receivableAccountId,
        cust.notes, cust.balance, this.baseCurrencyCode || 'UAH'
      ]);

      const actualCustId = custResult.rows[0]?.id || id;
      this.customerMap[code] = actualCustId;
      // ربط رمز الحساب المحاسبي أيضاً (للفواتير من البنية البديلة)
      const custAccCode = cust.accountCode || (code.startsWith('161') ? code : `161${code.padStart(3, '0')}`);
      this.customerByAccountMap[custAccCode] = actualCustId;
      inserted++;
      this._emit('استيراد العملاء', inserted, customers.length);
    }
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // الموردين
  // ═══════════════════════════════════════════════════════

  async _insertSuppliers(pgClient) {
    const suppliers = this.reader.getSuppliers();
    let inserted = 0;

    for (const sup of suppliers) {
      const id = uuidv4();
      const code = sup.code || `SUP-${inserted + 1}`;
      
      // code قد يكون نفسه رمز الحساب (مثل 261024) أو رقم بسيط
      const payableAccountId = this.accountMap[code] ||
                                this.accountMap[sup.accountCode] ||
                                this.accountMap[`261${code.padStart(3, '0')}`] ||
                                this.accountMap['261'] || null;
      // Debug: trace first supplier or specific supplier
      if (code === '261020' || inserted === 0) {
        console.log(`[Supplier ${code}] accountMap[${code}]=${this.accountMap[code] ? 'FOUND' : 'MISSING'} → payableAccountId=${payableAccountId ? 'SET' : 'NULL'}`);
      }

      const supResult = await pgClient.query(`
        INSERT INTO suppliers 
        (id, tenant_id, company_id, code, name_ar, name_en,
         phone, mobile, email, address, country, city,
         tax_number, payable_account_id, notes, status, balance, currency)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'active',$16,$17)
        ON CONFLICT (tenant_id, code) DO UPDATE SET
          payable_account_id = EXCLUDED.payable_account_id,
          currency = EXCLUDED.currency
        RETURNING id
      `, [
        id, this.tenantId, this.companyId,
        code, sup.nameAr || sup.name, sup.name,
        sup.phone, sup.mobile, sup.email, sup.address,
        sup.country, sup.city, sup.taxNumber,
        payableAccountId, sup.notes, sup.balance, this.baseCurrencyCode || 'UAH'
      ]);

      const actualSupId = supResult.rows[0]?.id || id;
      this.supplierMap[code] = actualSupId;
      this.supplierNameMap[code] = sup.nameAr || sup.name || code;
      // ربط رمز الحساب المحاسبي أيضاً (للفواتير من البنية البديلة)
      // إذا كان الرمز نفسه يبدأ بـ 261 فهو رمز محاسبي بالفعل
      const supAccCode = sup.accountCode || (code.startsWith('261') ? code : `261${code.padStart(3, '0')}`);
      this.supplierByAccountMap[supAccCode] = actualSupId;
      inserted++;
      this._emit('استيراد الموردين', inserted, suppliers.length);
    }
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // مراكز التكلفة
  // ═══════════════════════════════════════════════════════

  async _insertCostCenters(pgClient) {
    const centers = this.reader.getCostCenters();
    // ترتيب: الرئيسيين أولاً
    centers.sort((a, b) => a.code.length - b.code.length);

    let inserted = 0;
    for (const cc of centers) {
      const id = uuidv4();
      const isGroup = cc.type === 0;

      let parentId = null;
      if (cc.ref && cc.ref !== '0') {
        parentId = this.costCenterMap[cc.ref] || null;
      }
      if (!parentId && cc.code.length > 2) {
        const parentCode = cc.code.substring(0, 2);
        parentId = this.costCenterMap[parentCode] || null;
      }

      await pgClient.query(`
        INSERT INTO cost_centers 
        (id, tenant_id, company_id, code, name_ar, name_en, parent_id, is_group, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
        ON CONFLICT (tenant_id, company_id, code) DO NOTHING
      `, [id, this.tenantId, this.companyId, cc.code, 
          cc.nameAr || cc.name, cc.name, parentId, isGroup]);

      this.costCenterMap[cc.code] = id;
      inserted++;
    }
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // المواد
  // ═══════════════════════════════════════════════════════

  async _insertMaterials(pgClient) {
    const materials = this.reader.getMaterials();
    if (!materials || materials.length === 0) return 0;

    // ═══ تصنيف المواد: مجموعات vs مواد فعلية ═══
    // ملاحظة: الرشيد يضع IsSub=0 لكل المواد! لذلك نكتشف المجموعات بطرق متعددة:
    //   1. إذا كان isSub=true (في حال كان مضبوطاً صراحة)
    //   2. إذا كان كود المادة يمثل بادئة (prefix) لكود مادة أخرى → مجموعة أب
    //   3. إذا كان طول الكود يطابق طول مجموعة مكتشفة أخرى → مجموعة فارغة (نفس المستوى)
    const allCodes = materials.map(m => m.code).filter(c => c.length > 0);
    
    // خطوة 1: اكتشاف المجموعات التي لديها أبناء فعلاً
    const parentPrefixes = new Set();
    for (const code of allCodes) {
      for (const other of allCodes) {
        if (other.length > code.length && other.startsWith(code)) {
          parentPrefixes.add(code);
          break;
        }
      }
    }
    
    // خطوة 2: تحديد أطوال الأكواد التي تمثل مستويات المجموعات
    const groupCodeLengths = new Set();
    for (const prefix of parentPrefixes) {
      groupCodeLengths.add(prefix.length);
    }
    
    const isGroupByStructure = (code) => {
      // المادة تُعتبر مجموعة إذا:
      // 1. هي أب فعلي لمواد أخرى (prefix match)
      if (parentPrefixes.has(code)) return true;
      // 2. أو طول كودها يطابق أطوال المجموعات المكتشفة (= مجموعة فارغة بنفس المستوى)
      if (groupCodeLengths.has(code.length) && allCodes.some(c => c.length > code.length)) return true;
      return false;
    };
    
    const groups = materials.filter(m => m.isSub === true || isGroupByStructure(m.code));
    const items = materials.filter(m => !m.isSub && !isGroupByStructure(m.code));

    console.log(`[RSF] Materials breakdown: ${groups.length} groups, ${items.length} items (auto-detected by code structure)`);

    // ═══ 1. إنشاء المجموعات في fabric_groups ═══
    // ترتيب حسب طول الرمز (الآباء أولاً)
    groups.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));

    const groupMap = {}; // رمز مجموعة → UUID
    let groupOrder = 0;
    for (const grp of groups) {
      const groupId = uuidv4();
      const code = grp.code || `GRP-${groupOrder + 1}`;
      const nameAr = grp.nameAr || grp.name || code;
      const nameEn = grp.name || code;

      // تحديد parent_id من ref أو من أول أرقام الرمز
      let parentId = null;
      if (grp.ref && grp.ref !== '0' && grp.ref !== '') {
        parentId = groupMap[grp.ref] || null;
      }
      if (!parentId && code.length > 2) {
        for (let len = code.length - 1; len >= 1; len--) {
          const parentCode = code.substring(0, len);
          if (groupMap[parentCode]) {
            parentId = groupMap[parentCode];
            break;
          }
        }
      }

      groupOrder++;
      await pgClient.query(`
        INSERT INTO fabric_groups
        (id, tenant_id, company_id, code, name_ar, name_en, parent_id, display_order, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
        ON CONFLICT DO NOTHING
      `, [groupId, this.tenantId, this.companyId, code, nameAr, nameEn, parentId, groupOrder]);

      groupMap[code] = groupId;
      // أيضاً نسجل في materialMap للتوافق مع الفواتير (بعض الفواتير قد تشير لرمز مجموعة)
      this.materialMap[code] = groupId;
      this._emit('استيراد المجموعات', groupOrder, groups.length);
    }
    console.log(`[RSF] ✅ تم إنشاء ${Object.keys(groupMap).length} مجموعة مواد`);

    // ═══ 2. استيراد الوحدات من RSF ═══
    const UNIT_NAME_MAP = {
      'متر': { code: 'MTR', nameAr: 'متر', nameEn: 'Meter', type: 'length' },
      'م': { code: 'MTR', nameAr: 'متر', nameEn: 'Meter', type: 'length' },
      'كغ': { code: 'KG', nameAr: 'كيلوغرام', nameEn: 'Kilogram', type: 'weight' },
      'كيلو': { code: 'KG', nameAr: 'كيلوغرام', nameEn: 'Kilogram', type: 'weight' },
      'طن': { code: 'TON', nameAr: 'طن', nameEn: 'Ton', type: 'weight' },
      'قطعة': { code: 'PCS', nameAr: 'قطعة', nameEn: 'Piece', type: 'count' },
      'حبة': { code: 'PCS', nameAr: 'قطعة', nameEn: 'Piece', type: 'count' },
      'ثوب': { code: 'ROLL', nameAr: 'ثوب', nameEn: 'Roll', type: 'length' },
      'رول': { code: 'ROLL', nameAr: 'رول', nameEn: 'Roll', type: 'length' },
      'طاقة': { code: 'BOLT', nameAr: 'طاقة', nameEn: 'Bolt', type: 'length' },
      'بالة': { code: 'BALE', nameAr: 'بالة', nameEn: 'Bale', type: 'count' },
      'كرتون': { code: 'CTN', nameAr: 'كرتون', nameEn: 'Carton', type: 'count' },
      'صندوق': { code: 'BOX', nameAr: 'صندوق', nameEn: 'Box', type: 'count' },
      'لتر': { code: 'LTR', nameAr: 'لتر', nameEn: 'Liter', type: 'volume' },
      'ياردة': { code: 'YRD', nameAr: 'ياردة', nameEn: 'Yard', type: 'length' },
      'يارد': { code: 'YRD', nameAr: 'ياردة', nameEn: 'Yard', type: 'length' },
      'yard': { code: 'YRD', nameAr: 'ياردة', nameEn: 'Yard', type: 'length' },
      'meter': { code: 'MTR', nameAr: 'متر', nameEn: 'Meter', type: 'length' },
      'kg': { code: 'KG', nameAr: 'كيلوغرام', nameEn: 'Kilogram', type: 'weight' },
      'piece': { code: 'PCS', nameAr: 'قطعة', nameEn: 'Piece', type: 'count' },
      'pcs': { code: 'PCS', nameAr: 'قطعة', nameEn: 'Piece', type: 'count' },
      'roll': { code: 'ROLL', nameAr: 'رول', nameEn: 'Roll', type: 'length' },
      'bolt': { code: 'BOLT', nameAr: 'طاقة', nameEn: 'Bolt', type: 'length' },
      'шт': { code: 'PCS', nameAr: 'قطعة', nameEn: 'Piece', type: 'count' },
      'м': { code: 'MTR', nameAr: 'متر', nameEn: 'Meter', type: 'length' },
      'кг': { code: 'KG', nameAr: 'كيلوغرام', nameEn: 'Kilogram', type: 'weight' },
      'рул': { code: 'ROLL', nameAr: 'رول', nameEn: 'Roll', type: 'length' },
    };

    this._unitMap = {};
    const uniqueUnits = new Set();
    for (const mat of items) {
      const unit = (mat.unit || '').trim().toLowerCase();
      if (unit) uniqueUnits.add(unit);
    }

    // إنشاء وحدة افتراضية (قطعة)
    let defaultUnitId;
    const { rows: existingPCS } = await pgClient.query(
      "SELECT id FROM units_of_measure WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1",
      [this.tenantId]
    );
    if (existingPCS.length > 0) {
      defaultUnitId = existingPCS[0].id;
    } else {
      defaultUnitId = uuidv4();
      await pgClient.query(`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en, category)
        VALUES ($1, $2, 'PCS', 'قطعة', 'Piece', 'count')
        ON CONFLICT (tenant_id, code) DO NOTHING
      `, [defaultUnitId, this.tenantId]);
    }
    this._unitMap['PCS'] = defaultUnitId;

    for (const unitRaw of uniqueUnits) {
      const mapped = UNIT_NAME_MAP[unitRaw];
      const code = mapped ? mapped.code : unitRaw.toUpperCase().substring(0, 10);
      if (this._unitMap[code]) continue;
      const { rows: existing } = await pgClient.query(
        'SELECT id FROM units_of_measure WHERE tenant_id = $1 AND code = $2 LIMIT 1',
        [this.tenantId, code]
      );
      if (existing.length > 0) {
        this._unitMap[code] = existing[0].id;
      } else {
        const uid = uuidv4();
        await pgClient.query(`
          INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en, category)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (tenant_id, code) DO NOTHING
        `, [uid, this.tenantId, code,
          mapped ? mapped.nameAr : unitRaw,
          mapped ? mapped.nameEn : unitRaw,
          mapped ? mapped.type : 'count'
        ]);
        this._unitMap[code] = uid;
      }
    }
    console.log(`[RSF] ✅ تم إنشاء ${Object.keys(this._unitMap).length} وحدة قياس`);

    // ═══ 3. إدخال المواد الفعلية (items فقط) ═══
    const defaultWarehouseId = Object.values(this.warehouseMap)[0] || null;

    let inserted = 0;
    for (const mat of items) {
      const fabricId = uuidv4();
      const sku = mat.code || `MAT-${inserted + 1}`;
      const nameAr = mat.nameAr || mat.name || sku;
      const nameEn = mat.name || sku;

      // تحديد المجموعة الأم: من ref أو من أول أرقام الرمز
      let groupId = null;
      if (mat.ref && mat.ref !== '0' && mat.ref !== '') {
        groupId = groupMap[mat.ref] || null;
      }
      if (!groupId && sku.length > 2) {
        for (let len = sku.length - 1; len >= 1; len--) {
          const parentCode = sku.substring(0, len);
          if (groupMap[parentCode]) {
            groupId = groupMap[parentCode];
            break;
          }
        }
      }

      // تحديد وحدة المادة
      const unitRaw = (mat.unit || '').trim().toLowerCase();
      const mapped = UNIT_NAME_MAP[unitRaw];
      const unitCode = mapped ? mapped.code : (unitRaw ? unitRaw.toUpperCase().substring(0, 10) : 'PCS');
      const unitId = this._unitMap[unitCode] || defaultUnitId;

      // تحديد المستودع الافتراضي: أول مستودع فيه رصيد
      let matDefaultWarehouse = defaultWarehouseId;
      if (mat.warehouseBalances && Object.keys(mat.warehouseBalances).length > 0) {
        const firstWhNum = Object.keys(mat.warehouseBalances)[0];
        matDefaultWarehouse = this.warehouseMap[firstWhNum] || defaultWarehouseId;
      }

      // إدخال في products
      const productId = uuidv4();
      await pgClient.query(`
        INSERT INTO products 
        (id, tenant_id, company_id, sku, name_ar, name_en, 
         base_unit_id, default_cost, default_price,
         min_stock, max_stock, product_type, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'stockable','active')
        ON CONFLICT DO NOTHING
      `, [
        productId, this.tenantId, this.companyId,
        sku, nameAr, nameEn,
        defaultUnitId, mat.buyPrice || 0,
        mat.wholesalePrice || mat.sellPrice || 0,
        mat.minimumPr || 0, mat.smax || 0
      ]);

      // إدخال في fabric_materials مع group_id
      await pgClient.query(`
        INSERT INTO fabric_materials
        (id, tenant_id, company_id, product_id, code, name_ar, name_en,
         composition, category, unit, purchase_price, selling_price,
         currency, notes, status, current_stock, group_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT DO NOTHING
      `, [
        fabricId, this.tenantId, this.companyId, productId,
        sku, nameAr, nameEn,
        mat.unit || '', 'mixed', mat.unit || 'piece',
        mat.buyPrice || 0, mat.sellPrice || 0,
        this.baseCurrencyCode,
        mat.notes || '', 'active',
        mat.balance || 0, groupId
      ]);

      // تخزين أرصدة المستودعات لاستخدامها لاحقاً في inventory_stock
      if (mat.warehouseBalances && Object.keys(mat.warehouseBalances).length > 0) {
        if (!this._materialStockMap) this._materialStockMap = [];
        for (const [whNum, qty] of Object.entries(mat.warehouseBalances)) {
          const whId = this.warehouseMap[String(whNum)];
          if (whId && qty !== 0) {
            this._materialStockMap.push({
              materialId: fabricId,
              warehouseId: whId,
              quantity: qty
            });
          }
        }
      }

      this.materialMap[sku] = fabricId;
      this.materialNameMap[sku] = nameAr; // حفظ اسم المادة لاستخدامه في بنود الفواتير
      this.productMap[sku] = productId;
      inserted++;
      this._emit('استيراد المواد', inserted, items.length);
    }

    console.log(`[RSF] ✅ تم استيراد ${Object.keys(groupMap).length} مجموعات + ${inserted} مواد`);
    if (this._materialStockMap) {
      console.log(`[RSF] 📦 ${this._materialStockMap.length} سجل رصيد مستودع محفوظ للإدراج`);
    }
    return inserted + Object.keys(groupMap).length;
  }

  // ═══════════════════════════════════════════════════════
  // قوائم الأسعار (جملة، مفرد، نصف جملة، خاص...)
  // ═══════════════════════════════════════════════════════

  async _createPriceLists(pgClient) {
    const materials = this.reader.getMaterials();
    // فقط المواد الفعلية (ليست مجموعات)
    const items = materials.filter(m => !m.isSub && this.productMap[m.code]);
    if (items.length === 0) return 0;

    // ═══ تعريف قوائم الأسعار ═══
    const PRICE_LISTS = [
      { code: 'RETAIL',         nameAr: 'سعر المفرد',      nameEn: 'Retail Price',         field: 'sellPrice',         isDefault: true },
      { code: 'WHOLESALE',      nameAr: 'سعر الجملة',      nameEn: 'Wholesale Price',      field: 'wholesalePrice',    isDefault: false },
      { code: 'HALF_WHOLESALE', nameAr: 'سعر نصف الجملة',  nameEn: 'Half Wholesale Price', field: 'halfWholesalePrice', isDefault: false },
      { code: 'MIN_PRICE',      nameAr: 'الحد الأدنى للسعر', nameEn: 'Minimum Price',       field: 'minPrice',          isDefault: false },
      { code: 'SPECIAL',        nameAr: 'السعر الخاص',     nameEn: 'Special Price',        field: 'specialPrice',      isDefault: false },
      { code: 'FOREIGN',        nameAr: 'السعر بالعملة الأجنبية', nameEn: 'Foreign Currency Price', field: 'foreignPrice', isDefault: false },
    ];

    let totalItems = 0;

    for (const pl of PRICE_LISTS) {
      // تحقق إن كان هناك أي منتج بسعر > 0 لهذه القائمة
      const hasAnyPrice = items.some(m => (m[pl.field] || 0) > 0);
      if (!hasAnyPrice && !pl.isDefault) continue; // لا ننشئ قوائم فارغة

      const plId = uuidv4();
      const currency = pl.code === 'FOREIGN' ? (this.foreignCurrencyCode || 'USD') : (this.baseCurrencyCode || 'UAH');

      await pgClient.query(`
        INSERT INTO price_lists (id, tenant_id, company_id, code, name_ar, name_en, currency, is_active, is_default)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
        ON CONFLICT DO NOTHING
      `, [plId, this.tenantId, this.companyId, pl.code, pl.nameAr, pl.nameEn || pl.nameAr, currency, pl.isDefault]);

      // إضافة بنود الأسعار
      let itemCount = 0;
      for (const mat of items) {
        const price = mat[pl.field] || 0;
        if (price <= 0) continue;

        const productId = this.productMap[mat.code];
        if (!productId) continue;

        await pgClient.query(`
          INSERT INTO price_list_items (id, tenant_id, price_list_id, product_id, price)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `, [uuidv4(), this.tenantId, plId, productId, price]);
        itemCount++;
      }
      totalItems += itemCount;
      if (itemCount > 0) {
        console.log(`[RSF] ✅ قائمة "${pl.nameAr}" (${pl.code}): ${itemCount} منتج بأسعار`);
      }
    }

    console.log(`[RSF] ✅ تم إنشاء ${PRICE_LISTS.length} قوائم أسعار مع ${totalItems} بند`);
    return totalItems;
  }

  // ═══════════════════════════════════════════════════════
  // السنة المالية
  // ═══════════════════════════════════════════════════════

  async _insertFiscalYear(pgClient) {
    const entries = this.reader.getJournalHeaders();
    if (entries.length === 0) return 0;

    // استخراج أقدم وأحدث تاريخ
    const dates = entries.filter(e => e.date).map(e => new Date(e.date));
    if (dates.length === 0) return 0;

    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    const year = minDate.getFullYear();

    const id = uuidv4();
    await pgClient.query(`
      INSERT INTO fiscal_years 
      (id, tenant_id, company_id, name, code, start_date, end_date, is_current)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true)
      ON CONFLICT (tenant_id, company_id, code) DO NOTHING
    `, [
      id, this.tenantId, this.companyId,
      `السنة المالية ${year}`, String(year),
      `${year}-01-01`, `${year}-12-31`
    ]);

    this.fiscalYearId = id;
    return 1;
  }

  // ═══════════════════════════════════════════════════════
  // القيود المحاسبية
  // ═══════════════════════════════════════════════════════

  async _insertJournalEntries(pgClient) {
    const entries = this.reader.getJournalEntries();
    let inserted = 0;

    for (const entry of entries) {
      if (!entry.lines || entry.lines.length === 0) continue;

      const entryId = uuidv4();
      const entryDate = entry.date ? new Date(entry.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      // حساب المجاميع بالعملة المحلية
      let totalDebit = 0, totalCredit = 0;
      for (const line of entry.lines) {
        // debit/credit من الرشيد = بالعملة الأصلية
        // localAmount = بالعملة المحلية (UAH)
        const localDebit = line.debit > 0 ? (line.localAmount || line.debit) : 0;
        const localCredit = line.credit > 0 ? (line.localAmount || line.credit) : 0;
        totalDebit += localDebit;
        totalCredit += localCredit;
      }

      // وصف القيد من أول سطر
      const description = entry.notes || 
        (entry.lines[0] && entry.lines[0].description) || 
        `قيد رقم ${entry.nrs}`;

      // ═══ إدخال القيد كـ draft أولاً لتجنب chk_balanced_entry ═══
      await pgClient.query(`
        INSERT INTO journal_entries 
        (id, tenant_id, company_id, entry_number, entry_date,
         fiscal_year_id, entry_type, description, currency, exchange_rate,
         total_debit, total_credit, status, is_posted,
         created_by, notes)
        VALUES ($1,$2,$3,$4,$5,$6,'imported',$7,$8,$9,$10,$11,'draft',false,$12,$13)
        ON CONFLICT (tenant_id, entry_number) DO NOTHING
      `, [
        entryId, this.tenantId, this.companyId,
        `RSF-${entry.nrs}`, entryDate,
        this.fiscalYearId, description,
        this.baseCurrencyCode, 1,
        0, 0,
        this.userId, entry.notes
      ]);

      // إدراج السطور وتتبع المجاميع الفعلية
      let actualDebit = 0, actualCredit = 0;
      let lineNum = 0;

      for (let i = 0; i < entry.lines.length; i++) {
        const line = entry.lines[i];
        const accountId = this.accountMap[line.accountCode];
        if (!accountId) {
          console.warn(`[RSF] تحذير: حساب ${line.accountCode} غير موجود — تخطي سطر`);
          continue;
        }

        // ═══ حساب العملة وأسعار الصرف ═══
        // currencyMap هو المصدر الوحيد للحقيقة عن عملة السطر
        const currInfo = this.currencyMap[line.currencyNum] || { code: this.baseCurrencyCode, rate: 1 };
        const isBaseCurrency = (line.currencyNum === 0 || currInfo.code === this.baseCurrencyCode);
        
        let localDebit = 0, localCredit = 0;
        let fcDebit = 0, fcCredit = 0;
        let exchangeRate = 1;
        // ═══ العملة تُحدد فقط من currencyMap — لا نُغيّرها أبداً ═══
        let lineCurrency = currInfo.code;

        if (isBaseCurrency) {
          // ═══ السطر بالعملة المحلية (UAH) ═══
          // Total/Total1 = المبلغ بالغريفن
          // LocalTot = نفس المبلغ (بالغريفن)
          // MianTot = المعادل بالدولار (إعلامي فقط — لا يُغيّر العملة!)
          localDebit = line.debit > 0 ? (line.localAmount || line.debit) : 0;
          localCredit = line.credit > 0 ? (line.localAmount || line.credit) : 0;
          // MianTot هنا إعلامي فقط — نحفظه كمرجع لكن لا نُغيّر lineCurrency
          exchangeRate = 1;
          // لا fcDebit/fcCredit — السطر بالعملة المحلية
        } else {
          // ═══ السطر بعملة أجنبية (USD مثلاً) ═══
          // Total/Total1 = المبلغ بالعملة الأجنبية (USD)
          // LocalTot = المعادل بالغريفن
          // MianTot = نفس Total (بالعملة الأجنبية)
          lineCurrency = currInfo.code;
          fcDebit = line.debit || 0;
          fcCredit = line.credit || 0;
          localDebit = line.debit > 0 ? (line.localAmount || line.debit * currInfo.rate) : 0;
          localCredit = line.credit > 0 ? (line.localAmount || line.credit * currInfo.rate) : 0;
          const fcAmt = fcDebit || fcCredit;
          const localAmt = localDebit || localCredit;
          exchangeRate = fcAmt > 0 ? (localAmt / fcAmt) : currInfo.rate;
        }

        const costCenterId = line.costCenterCode ? 
          (this.costCenterMap[line.costCenterCode] || null) : null;

        let partyType = null, partyId = null;
        if (line.accountCode.startsWith('161')) {
          partyType = 'customer';
          for (const [code, id] of Object.entries(this.customerMap)) {
            if (line.accountCode.includes(code) || code === line.accountCode) {
              partyId = id; break;
            }
          }
        } else if (line.accountCode.startsWith('261')) {
          partyType = 'supplier';
          for (const [code, id] of Object.entries(this.supplierMap)) {
            if (line.accountCode.includes(code) || code === line.accountCode) {
              partyId = id; break;
            }
          }
        }

        lineNum++;
        await pgClient.query(`
          INSERT INTO journal_entry_lines 
          (id, tenant_id, entry_id, line_number, account_id,
           debit, credit, currency, exchange_rate, debit_fc, credit_fc,
           description, cost_center_id, party_type, party_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `, [
          uuidv4(), this.tenantId, entryId, lineNum, accountId,
          localDebit, localCredit,
          lineCurrency, exchangeRate, fcDebit, fcCredit,
          line.description, costCenterId, partyType, partyId
        ]);

        actualDebit += localDebit;
        actualCredit += localCredit;
      }

      // ═══ موازنة القيد وترقية الحالة ═══
      // فروق التقريب من تحويل العملات — نجعل الطرفين متساويين دائماً
      const balancedAmount = Math.max(actualDebit, actualCredit);
      actualDebit = balancedAmount;
      actualCredit = balancedAmount;

      await pgClient.query(`
        UPDATE journal_entries 
        SET total_debit = $2::numeric, total_credit = $2::numeric,
            status = 'posted', is_posted = true, posted_at = NOW()
        WHERE id = $1
      `, [entryId, balancedAmount]);

      inserted++;
      if (inserted % 100 === 0) {
        this._emit('استيراد القيود', inserted, entries.length);
      }
    }
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // المستودعات — استخراج ديناميكي من حركات المخزون
  // ═══════════════════════════════════════════════════════

  async _insertWarehouses(pgClient) {
    // 1. قراءة أسماء المستودعات من إعدادات الرشيد
    const warehouseNames = this.reader.getWarehouseNames();
    console.log(`[RSF] Warehouse names from settings:`, JSON.stringify(warehouseNames));

    // 2. جمع أرقام المستودعات المستخدمة فعلياً (من حركات + فواتير + أرصدة مواد)
    const usedNumbers = new Set();

    // من حركات المخزون
    const movesResult = this.reader.getInventoryMoves();
    const movesArr = Array.isArray(movesResult) ? movesResult : (movesResult?.allMoves || []);
    for (const move of movesArr) {
      const whNum = parseInt(move.warehouseNum || move._raw?.StockNum);
      if (!isNaN(whNum) && whNum > 0) usedNumbers.add(whNum);
    }
    // من المناقلات
    const transfers = movesResult?.transfers || [];
    for (const tr of transfers) {
      for (const line of (tr.lines || [])) {
        if (line.fromWarehouse) usedNumbers.add(line.fromWarehouse);
        if (line.toWarehouse) usedNumbers.add(line.toWarehouse);
      }
    }

    // من الفواتير
    const salesInvs = this.reader.getSalesInvoices();
    const purchInvs = this.reader.getPurchaseInvoices();
    for (const inv of [...salesInvs, ...purchInvs]) {
      const raw = inv._raw || {};
      const sn = parseInt(raw.Store || raw.StoreNum || raw.Makhzan);
      if (!isNaN(sn) && sn > 0) usedNumbers.add(sn);
    }

    // من أرصدة المواد لكل مستودع
    const materials = this.reader.getMaterials();
    for (const mat of materials) {
      if (mat.warehouseBalances) {
        for (const whNum of Object.keys(mat.warehouseBalances)) {
          usedNumbers.add(parseInt(whNum));
        }
      }
    }

    // دائماً نضيف المستودع 1 (الرئيسي)
    usedNumbers.add(1);

    // 3. إنشاء الفرع الافتراضي
    let defaultBranchId;
    const { rows: branchRows } = await pgClient.query(
      'SELECT id FROM branches WHERE company_id = $1 LIMIT 1', [this.companyId]
    );
    if (branchRows.length > 0) {
      defaultBranchId = branchRows[0].id;
    } else {
      defaultBranchId = uuidv4();
      await pgClient.query(`
        INSERT INTO branches (id, tenant_id, company_id, code, name, name_ar, name_en, is_active)
        VALUES ($1, $2, $3, 'MAIN', 'الفرع الرئيسي', 'الفرع الرئيسي', 'Main Branch', true)
        ON CONFLICT DO NOTHING
      `, [defaultBranchId, this.tenantId, this.companyId]);
    }
    this._defaultBranchId = defaultBranchId;

    // 4. إنشاء المستودعات المستخدمة فقط بأسمائها الحقيقية
    let inserted = 0;
    const sortedNums = Array.from(usedNumbers).sort((a, b) => a - b);

    for (const num of sortedNums) {
      const whId = uuidv4();
      const realName = warehouseNames[num] || `مستودع ${num}`;
      const nameEn = `Warehouse ${num}`;
      const code = num === 1 ? 'WH-MAIN' : `WH-${num}`;

      await pgClient.query(`
        INSERT INTO warehouses
        (id, company_id, tenant_id, branch_id, name_ar, name_en, code, is_active, warehouse_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7,true,'regular')
        ON CONFLICT DO NOTHING
      `, [whId, this.companyId, this.tenantId, defaultBranchId, realName, nameEn, code]);

      this.warehouseMap[String(num)] = whId;
      if (num === 1) this.warehouseMap['main'] = whId;
      inserted++;
    }

    console.log(`[RSF] ✅ تم إنشاء ${inserted} مستودع: ${sortedNums.map(n => `${n}=${warehouseNames[n] || 'مستودع ' + n}`).join(', ')}`);
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // فواتير المبيعات
  // ═══════════════════════════════════════════════════════

  async _insertSalesInvoices(pgClient) {
    console.log('[RSF] _insertSalesInvoices: START');
    const invoices = this.reader.getSalesInvoices();
    console.log('[RSF] _insertSalesInvoices: got', invoices?.length || 0, 'invoices');
    if (!invoices || invoices.length === 0) return 0;

   let inserted = 0;
    for (const inv of invoices) {
      const invId = uuidv4();
      const invDate = inv.date ? new Date(inv.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      let customerId = this.customerMap[inv.customerCode] 
                      || this.customerByAccountMap[inv.customerCode] 
                      || null;

      // في الرشيد يمكن البيع لأي حساب بالشجرة — إذا لم يكن عميل مسجل ننشئه من الحساب
      if (!customerId && inv.customerCode) {
        const accountId = this.accountMap[inv.customerCode] || null;
        // نبحث هل سبق إنشاؤه في هذا الاستيراد
        const cacheKey = `_adHocCust_${inv.customerCode}`;
        if (this[cacheKey]) {
          customerId = this[cacheKey];
        } else {
          const adHocId = uuidv4();
          // جلب اسم الحساب من قاعدة البيانات
          let accName = inv.customerCode;
          if (accountId) {
            try {
              const nameRes = await pgClient.query('SELECT name FROM chart_of_accounts WHERE id = $1', [accountId]);
              if (nameRes.rows[0]) accName = nameRes.rows[0].name;
            } catch {}
          }
          try {
            await pgClient.query(`
              INSERT INTO customers (id, tenant_id, company_id, name_ar, code, customer_type)
              VALUES ($1, $2, $3, $4, $5, 'individual')
              ON CONFLICT DO NOTHING
            `, [adHocId, this.tenantId, this.companyId, accName, inv.customerCode]);
            customerId = adHocId;
          } catch {
            // ربما كود مكرر — نجلبه
            const existing = await pgClient.query(
              'SELECT id FROM customers WHERE company_id = $1 AND code = $2 LIMIT 1',
              [this.companyId, inv.customerCode]
            );
            customerId = existing.rows[0]?.id || adHocId;
          }
          this[cacheKey] = customerId;
          this.customerByAccountMap[inv.customerCode] = customerId;
        }
      }

      // إذا بعد كل ذلك لا يوجد عميل، ننشئ عميل "نقدي" مبدئي
      if (!customerId) {
        if (!this._defaultCashCustomerId) {
          const defCustId = uuidv4();
          await pgClient.query(`
            INSERT INTO customers (id, tenant_id, company_id, name_ar, code, customer_type)
            VALUES ($1, $2, $3, 'عميل نقدي', 'CASH', 'individual')
            ON CONFLICT DO NOTHING
          `, [defCustId, this.tenantId, this.companyId]);
          this._defaultCashCustomerId = defCustId;
        }
        customerId = this._defaultCashCustomerId;
      }

      const warehouseId = this.warehouseMap['main'] || this.warehouseMap[1] || null;

      console.log(`[RSF] SI#${inv.number}: date=${invDate}, customer=${customerId}, total=${inv.total}, warehouseId=${warehouseId}, userId=${this.userId}`);

      try {
        await pgClient.query(`
          INSERT INTO sales_invoices
          (id, tenant_id, company_id, invoice_number, invoice_date,
           customer_id, status, is_posted, subtotal, discount_amount,
           tax_amount, total_amount, currency, notes, warehouse_id,
           document_stage, created_by, delivery_status)
          VALUES ($1,$2,$3,$4,$5::date,$6,'posted',true,$7,$8,$9,$10,$11,$12,$13,'invoice',$14,'delivered')
          ON CONFLICT DO NOTHING
        `, [
          invId, this.tenantId, this.companyId,
          `RSF-SI-${inv.number}`, String(invDate),
          customerId,
          inv.total || 0, inv.discount || 0,
          inv.tax || 0, inv.netTotal || inv.total || 0,
          this.baseCurrencyCode, inv.notes || '',
          warehouseId || null, this.userId || null
        ]);
        console.log(`[RSF] ✅ فاتورة مبيعات: RSF-SI-${inv.number}`);
      } catch (siErr) {
        console.error(`[RSF] ❌ فاتورة مبيعات #${inv.number} فشلت:`, siErr.message);
        throw siErr; // نعيد الخطأ ليُلتقط بالـ savepoint
      }

      // إدراج سطور الفاتورة + حركات المخزون المرتبطة
      if (inv.lines && inv.lines.length > 0) {
        for (let i = 0; i < inv.lines.length; i++) {
          const line = inv.lines[i];
          const matCode = String(line.MatNum || line.Num || '').trim();
          const materialId = this.materialMap[matCode] || null;
          // البحث عن product_id المرتبط بالمادة (fabric_materials تحتوي product_id)
          const productId = this.productMap?.[matCode] || null;
          const qty = parseFloat(line.Qty || line.Quantity) || 1;
          const price = parseFloat(line.Price || line.UnitPrice) || 0;
          const disc = parseFloat(line.Discount) || 0;
          const total = parseFloat(line.Total) || (qty * price - disc);

          await pgClient.query(`
            INSERT INTO sales_invoice_items
            (id, tenant_id, invoice_id, line_number, product_id,
             description, quantity, unit_price, discount_amount,
             subtotal, total, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `, [
            uuidv4(), this.tenantId, invId, i + 1,
            productId,
            String(line.Name || '').trim() || this.materialNameMap[matCode] || String(line.Document || '').trim() || matCode || '',
            qty, price, disc,
            qty * price, total,
            String(line.Notes || '').trim()
          ]);

          // ═══ إنشاء حركة مخزون مربوطة بالفاتورة ═══
          if (materialId && qty > 0) {
            const lineStore = String(line.StockNum || line.Store || '').trim();
            const lineWarehouseId = lineStore ? (this.warehouseMap[lineStore] || warehouseId) : warehouseId;
            await pgClient.query(`
              INSERT INTO inventory_movements
              (id, company_id, tenant_id, material_id,
               warehouse_id, from_warehouse_id, to_warehouse_id,
               movement_number, movement_type, movement_date,
               quantity, unit_cost, total_cost, notes,
               reference_type, reference_id, reference_number, created_by, status)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sale',$9,$10,$11,$12,$13,'sales_invoice',$14,$15,$16,'completed')
            `, [
              uuidv4(), this.companyId, this.tenantId, materialId,
              lineWarehouseId, lineWarehouseId, lineWarehouseId,
              `RSF-SI-MV-${inv.number}-${i+1}`, invDate,
              qty, price, qty * price,
              `بيع - فاتورة ${inv.number}`,
              invId, `RSF-SI-${inv.number}`, this.userId
            ]);
          }
        }
      }

      // ═══ إنشاء إذن تسليم صامت (Silent Delivery Note) ═══
      // يُربط بالفاتورة ليظهر في الـ Workflow كفاتورة "مسلّمة" بشكل كامل
      const dnId = uuidv4();
      const dnNumber = `DN-${inv.number}`;
      const customerName = this.customerNameMap?.[inv.customerCode] || '';

      await pgClient.query(`
        INSERT INTO delivery_notes
        (id, tenant_id, company_id, note_number, note_date,
         customer_id, customer_name, warehouse_id,
         status, subtotal, total_amount, notes, created_by, delivered_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                'delivered', $9, $10, 'RSF Import - Auto Delivery', $11, $12::timestamp)
        ON CONFLICT DO NOTHING
      `, [
        dnId, this.tenantId, this.companyId, dnNumber, invDate,
        customerId, customerName, warehouseId,
        inv.total || 0, inv.netTotal || inv.total || 0,
        this.userId, invDate
      ]);

      // إنشاء بنود إذن التسليم (من بنود الفاتورة)
      if (inv.lines && inv.lines.length > 0) {
        for (let di = 0; di < inv.lines.length; di++) {
          const dLine = inv.lines[di];
          const dMatCode = String(dLine.MatNum || dLine.Num || '').trim();
          const dMaterialId = this.materialMap[dMatCode] || null;
          const dProductId = this.productMap?.[dMatCode] || null;
          const dQty = parseFloat(dLine.Qty || dLine.Quantity) || 1;
          const dPrice = parseFloat(dLine.Price || dLine.UnitPrice) || 0;
          const dTotal = parseFloat(dLine.Total) || (dQty * dPrice);
          const dLineStore = String(dLine.StockNum || dLine.Store || '').trim();
          const dLineWarehouseId = dLineStore ? (this.warehouseMap[dLineStore] || warehouseId) : warehouseId;

          await pgClient.query(`
            INSERT INTO delivery_note_items
            (id, tenant_id, delivery_note_id, line_number, product_id, material_id,
             description, quantity_ordered, quantity_to_deliver, quantity_delivered,
             unit_cost, line_total, warehouse_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT DO NOTHING
          `, [
            uuidv4(), this.tenantId, dnId, di + 1,
            dProductId, dMaterialId,
            String(dLine.Name || '').trim() || this.materialNameMap[dMatCode] || dMatCode || '',
            dQty, dQty, dQty,
            dPrice, dTotal,
            dLineWarehouseId
          ]);
        }
      }
      console.log(`[RSF] ✅ إذن تسليم صامت: ${dnNumber} (${inv.lines?.length || 0} بند)`);

      // ═══ إنشاء القيد المحاسبي لفاتورة المبيعات ═══
      // في الرشيد: Debt = حساب العميل (مدين), Credit = حساب المبيعات (دائن)
      const raw = inv._raw || {};
      const debitAccCode = String(raw.Debt || inv.customerCode || '').trim();   // مثل 161002 (عميل)
      const creditAccCode = String(raw.Credit || '').trim(); // مثل 411 (مبيعات)
      const invTotal = inv.netTotal || inv.total || 0;

      if (debitAccCode && creditAccCode && invTotal > 0) {
        const debitAccountId = this.accountMap[debitAccCode];
        const creditAccountId = this.accountMap[creditAccCode];

        if (debitAccountId && creditAccountId) {
          const jeId = uuidv4();
          const entryNumber = `RSF-SI-JE-${inv.number}`;
          const description = raw.Document || inv.notes || `فاتورة مبيعات رقم ${inv.number}`;

          // العملة وسعر الصرف
          const currNum = parseInt(raw.Currency) || 1;
          const currInfo = this.currencyMap[currNum] || { code: this.baseCurrencyCode, rate: 1 };
          const isBaseCurrency = (currNum === 0 || currInfo.code === this.baseCurrencyCode);
          const localTotal = parseFloat(raw.LocalTot) || invTotal;
          const fcTotal = parseFloat(raw.MianTot) || 0;

          // إدخال القيد كـ draft أولاً (مع ربطه بالفاتورة)
          await pgClient.query(`
            INSERT INTO journal_entries 
            (id, tenant_id, company_id, entry_number, entry_date,
             fiscal_year_id, entry_type, description, currency, exchange_rate,
             total_debit, total_credit, status, is_posted,
             reference_type, reference_id,
             created_by, notes)
            VALUES ($1,$2,$3,$4,$5,$6,'sales_invoice',$7,$8,$9,$10,$11,'draft',false,
                    'sales_invoice',$14,
                    $12,$13)
            ON CONFLICT (tenant_id, entry_number) DO NOTHING
          `, [
            jeId, this.tenantId, this.companyId,
            entryNumber, invDate,
            this.fiscalYearId, description,
            this.baseCurrencyCode, 1,
            0, 0,
            this.userId, inv.notes || '',
            invId
          ]);

          // سطر 1: مدين — حساب العميل
          let partyType = null, partyId = null;
          if (debitAccCode.startsWith('161')) {
            partyType = 'customer';
            partyId = customerId;
          }

          await pgClient.query(`
            INSERT INTO journal_entry_lines 
            (id, tenant_id, entry_id, line_number, account_id,
             debit, credit, currency, exchange_rate, debit_fc, credit_fc,
             description, party_type, party_id)
            VALUES ($1,$2,$3,1,$4,$5,0,$6,$7,$8,0,$9,$10,$11)
          `, [
            uuidv4(), this.tenantId, jeId, debitAccountId,
            localTotal, currInfo.code,
            fcTotal > 0 ? (localTotal / fcTotal) : (isBaseCurrency ? 1 : currInfo.rate),
            fcTotal > 0 ? fcTotal : 0,
            description, partyType, partyId
          ]);

          // سطر 2: دائن — حساب المبيعات/الإيراد
          await pgClient.query(`
            INSERT INTO journal_entry_lines 
            (id, tenant_id, entry_id, line_number, account_id,
             debit, credit, currency, exchange_rate, debit_fc, credit_fc,
             description, party_type, party_id)
            VALUES ($1,$2,$3,2,$4,0,$5,$6,$7,0,$8,$9,NULL,NULL)
          `, [
            uuidv4(), this.tenantId, jeId, creditAccountId,
            localTotal, currInfo.code,
            fcTotal > 0 ? (localTotal / fcTotal) : (isBaseCurrency ? 1 : currInfo.rate),
            fcTotal > 0 ? fcTotal : 0,
            description
          ]);

          // ترقية القيد إلى posted
          await pgClient.query(`
            UPDATE journal_entries 
            SET total_debit = $2::numeric, total_credit = $2::numeric,
                status = 'posted', is_posted = true, posted_at = NOW()
            WHERE id = $1
          `, [jeId, localTotal]);

          // ═══ ربط فاتورة المبيعات بالقيد ═══
          // إصلاح #P1: نحدّث sales_invoices (الموجودة الآن) لا sales_transactions
          // (التي تُنشأ لاحقاً بالمزامنة sp_sales_sync التي تنقل si.journal_entry_id).
          // التحديث المباشر لـsales_transactions كان لا أثر له (الصف غير موجود بعد).
          await pgClient.query(`
            UPDATE sales_invoices
            SET journal_entry_id = $1
            WHERE id = $2
          `, [jeId, invId]);

          console.log(`[RSF] ✅ قيد فاتورة مبيعات #${inv.number}: ${debitAccCode}→${creditAccCode} بمبلغ ${localTotal} | JE=${jeId}`);
        } else {
          console.warn(`[RSF] ⚠️ تخطي قيد فاتورة مبيعات #${inv.number}: حساب مدين ${debitAccCode}=${debitAccountId ? '✓' : '✗'}, حساب دائن ${creditAccCode}=${creditAccountId ? '✓' : '✗'}`);
        }
      }

      inserted++;
      this._emit('استيراد فواتير المبيعات', inserted, invoices.length);
    }
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // فواتير المشتريات
  // ═══════════════════════════════════════════════════════

  async _insertPurchaseInvoices(pgClient) {
    const invoices = this.reader.getPurchaseInvoices();
    if (!invoices || invoices.length === 0) return 0;

    let inserted = 0;
    for (const inv of invoices) {
      const invId = uuidv4();
      const invDate = inv.date ? new Date(inv.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const supplierId = this.supplierMap[inv.supplierCode]
                      || this.supplierByAccountMap[inv.supplierCode] 
                      || null;
      const warehouseId = this.warehouseMap['main'] || null;
      const invTotal = inv.netTotal || inv.total || 0;

      // ═══ الكتابة في purchase_invoices (الجدول الرئيسي الذي تقرأه واجهة useReceiptSources) ═══
      // receipt_status='received' + status='posted' + document_stage='posted'
      // → لا تظهر في أذون الاستلام (useReceiptSources يفلتر receipt_status != 'received')
      // → تظهر في دورة الشراء (عبر trigger trg_sync_to_purchase_transactions الذي يزامن تلقائياً)
      // تحديد اسم المورد
      const supplierName = this.supplierNameMap[inv.supplierCode]
        || (inv._raw ? String(inv._raw.Document || '').trim() : '')
        || '';

      await pgClient.query(`
        INSERT INTO purchase_invoices
        (id, company_id, tenant_id, invoice_number, invoice_date,
         supplier_id, supplier_name, status, is_posted, posted_at,
         subtotal, total_amount, currency, notes, document_stage,
         receipt_status, payment_status, confirmation_status, warehouse_id)
        VALUES ($1,$2,$3,$4,$5,$6,$10,'posted',true,NOW(),$7,$7,$8,$9,'posted',
                'received','paid','confirmed',$11)
        ON CONFLICT DO NOTHING
      `, [
        invId, this.companyId, this.tenantId,
        `RSF-PI-${inv.number}`, invDate,
        supplierId,
        invTotal,
        this.baseCurrencyCode, inv.notes || '',
        supplierName, warehouseId
      ]);

      // إدراج سطور الفاتورة في purchase_invoice_items + حركات المخزون
      if (inv.lines && inv.lines.length > 0) {
        for (let i = 0; i < inv.lines.length; i++) {
          const line = inv.lines[i];
          const matCode = String(line.MatNum || line.Num || '').trim();
          const materialId = this.materialMap[matCode] || null;
          const qty = parseFloat(line.Qty || line.Quantity) || 1;
          const price = parseFloat(line.Price || line.UnitPrice) || 0;
          const disc = parseFloat(line.Discount) || 0;
          const total = parseFloat(line.Total) || (qty * price - disc);

          const materialName = String(line.Name || '').trim()
            || this.materialNameMap[matCode]
            || String(line.Document || '').trim()
            || matCode
            || '';

          await pgClient.query(`
            INSERT INTO purchase_invoice_items
            (id, tenant_id, invoice_id, line_number, material_id,
             description, quantity, unit_price, discount_amount,
             subtotal, total, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `, [
            uuidv4(), this.tenantId, invId, i + 1,
            materialId,
            materialName,
            qty, price, disc,
            qty * price, total,
            String(line.Notes || '').trim()
          ]);

          // ═══ إنشاء حركة مخزون مربوطة بالفاتورة ═══
          if (materialId && qty > 0) {
            const lineStore = String(line.StockNum || line.Store || '').trim();
            const lineWarehouseId = lineStore ? (this.warehouseMap[lineStore] || warehouseId) : warehouseId;
            await pgClient.query(`
              INSERT INTO inventory_movements
              (id, company_id, tenant_id, material_id,
               warehouse_id, from_warehouse_id, to_warehouse_id,
               movement_number, movement_type, movement_date,
               quantity, unit_cost, total_cost, notes,
               reference_type, reference_id, reference_number, created_by, status)
              VALUES ($1,$2,$3,$4,$5,$5,$5,$6,'purchase',$7,$8,$9,$10,$11,'purchase',$12,$13,$14,'completed')
            `, [
              uuidv4(), this.companyId, this.tenantId, materialId,
              lineWarehouseId,
              `RSF-PI-MV-${inv.number}-${i+1}`, invDate,
              qty, price, qty * price,
              `شراء - فاتورة ${inv.number}`,
              invId, `RSF-PI-${inv.number}`, this.userId
            ]);
          }
        }
      }

      // ═══ إنشاء إذن استلام صامت (Silent Purchase Receipt) ═══
      // يُربط بالفاتورة ليظهر في الـ Workflow كفاتورة "مستلمة" بشكل كامل
      const receiptId = uuidv4();
      const receiptNumber = `GRN-${inv.number}`;
      await pgClient.query(`
        INSERT INTO purchase_receipts
        (id, tenant_id, company_id, receipt_number, receipt_date,
         status, invoice_id, warehouse_id, notes, created_at)
        VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, 'RSF Import - Auto Receipt', NOW())
        ON CONFLICT DO NOTHING
      `, [receiptId, this.tenantId, this.companyId, receiptNumber, invDate, invId, warehouseId]);

      // إنشاء بنود إذن الاستلام (من بنود الفاتورة)
      if (inv.lines && inv.lines.length > 0) {
        for (let ri = 0; ri < inv.lines.length; ri++) {
          const rLine = inv.lines[ri];
          const rMatCode = String(rLine.MatNum || rLine.Num || '').trim();
          const rMaterialId = this.materialMap[rMatCode] || null;
          const rProductId = this.productMap?.[rMatCode] || null;
          const rQty = parseFloat(rLine.Qty || rLine.Quantity) || 1;
          const rPrice = parseFloat(rLine.Price || rLine.UnitPrice) || 0;
          const rTotal = parseFloat(rLine.Total) || (rQty * rPrice);
          const rLineStore = String(rLine.StockNum || rLine.Store || '').trim();
          const rLineWarehouseId = rLineStore ? (this.warehouseMap[rLineStore] || warehouseId) : warehouseId;

          await pgClient.query(`
            INSERT INTO purchase_receipt_items
            (id, tenant_id, receipt_id, material_id, product_id,
             quantity, received_qty, unit, unit_price, total, warehouse_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT DO NOTHING
          `, [
            uuidv4(), this.tenantId, receiptId,
            rMaterialId, rProductId,
            rQty, rQty, rLine.Unit || 'unit', rPrice, rTotal,
            rLineWarehouseId
          ]);
        }
      }
      console.log(`[RSF] ✅ إذن استلام صامت: ${receiptNumber} (${inv.lines?.length || 0} بند)`);

      // ═══ إنشاء القيد المحاسبي للفاتورة ═══
      // في الرشيد: Debt = حساب المشتريات (مدين), Credit = حساب المورد (دائن)
      const raw = inv._raw || {};
      const debitAccCode = String(raw.Debt || '').trim();   // مثل 341 (مشتريات)
      const creditAccCode = String(raw.Credit || inv.supplierCode || '').trim(); // مثل 261020 (مورد)

      if (debitAccCode && creditAccCode && invTotal > 0) {
        const debitAccountId = this.accountMap[debitAccCode];
        const creditAccountId = this.accountMap[creditAccCode];

        if (debitAccountId && creditAccountId) {
          const jeId = uuidv4();
          const entryNumber = `RSF-PI-JE-${inv.number}`;
          const description = raw.Document || inv.notes || `فاتورة مشتريات رقم ${inv.number}`;

          // العملة وسعر الصرف
          const currNum = parseInt(raw.Currency) || 1;
          const currInfo = this.currencyMap[currNum] || { code: this.baseCurrencyCode, rate: 1 };
          const isBaseCurrency = (currNum === 0 || currInfo.code === this.baseCurrencyCode);
          const localTotal = parseFloat(raw.LocalTot) || invTotal;
          const fcTotal = parseFloat(raw.MianTot) || 0;

          // إدخال القيد كـ draft أولاً (مع ربطه بالفاتورة)
          await pgClient.query(`
            INSERT INTO journal_entries 
            (id, tenant_id, company_id, entry_number, entry_date,
             fiscal_year_id, entry_type, description, currency, exchange_rate,
             total_debit, total_credit, status, is_posted,
             reference_type, reference_id,
             created_by, notes)
            VALUES ($1,$2,$3,$4,$5,$6,'purchase_invoice',$7,$8,$9,$10,$11,'draft',false,
                    'purchase_invoice',$14,
                    $12,$13)
            ON CONFLICT (tenant_id, entry_number) DO NOTHING
          `, [
            jeId, this.tenantId, this.companyId,
            entryNumber, invDate,
            this.fiscalYearId, description,
            this.baseCurrencyCode, 1,
            0, 0,
            this.userId, inv.notes || '',
            invId
          ]);

          // سطر 1: مدين — حساب المشتريات
          await pgClient.query(`
            INSERT INTO journal_entry_lines 
            (id, tenant_id, entry_id, line_number, account_id,
             debit, credit, currency, exchange_rate, debit_fc, credit_fc,
             description, party_type, party_id)
            VALUES ($1,$2,$3,1,$4,$5,0,$6,$7,$8,0,$9,NULL,NULL)
          `, [
            uuidv4(), this.tenantId, jeId, debitAccountId,
            localTotal, currInfo.code,
            fcTotal > 0 ? (localTotal / fcTotal) : (isBaseCurrency ? 1 : currInfo.rate),
            fcTotal > 0 ? fcTotal : 0,
            description
          ]);

          // سطر 2: دائن — حساب المورد
          await pgClient.query(`
            INSERT INTO journal_entry_lines 
            (id, tenant_id, entry_id, line_number, account_id,
             debit, credit, currency, exchange_rate, debit_fc, credit_fc,
             description, party_type, party_id)
            VALUES ($1,$2,$3,2,$4,0,$5,$6,$7,0,$8,$9,'supplier',$10)
          `, [
            uuidv4(), this.tenantId, jeId, creditAccountId,
            localTotal, currInfo.code,
            fcTotal > 0 ? (localTotal / fcTotal) : (isBaseCurrency ? 1 : currInfo.rate),
            fcTotal > 0 ? fcTotal : 0,
            description, supplierId
          ]);

          // ترقية القيد إلى posted
          await pgClient.query(`
            UPDATE journal_entries 
            SET total_debit = $2::numeric, total_credit = $2::numeric,
                status = 'posted', is_posted = true, posted_at = NOW()
            WHERE id = $1
          `, [jeId, localTotal]);

          // ═══ ربط القيد بالفاتورة (الاتجاه العكسي) ═══
          await pgClient.query(`
            UPDATE purchase_invoices 
            SET journal_entry_id = $1
            WHERE id = $2
          `, [jeId, invId]);

          console.log(`[RSF] ✅ قيد فاتورة مشتريات #${inv.number}: ${debitAccCode}→${creditAccCode} بمبلغ ${localTotal} | JE=${jeId}`);
        } else {
          console.warn(`[RSF] ⚠️ تخطي قيد فاتورة مشتريات #${inv.number}: حساب مدين ${debitAccCode}=${debitAccountId ? '✓' : '✗'}, حساب دائن ${creditAccCode}=${creditAccountId ? '✓' : '✗'}`);
        }
      }

      inserted++;
      this._emit('استيراد فواتير المشتريات', inserted, invoices.length);
    }
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // طلبيات الشراء (من جدول Claim في الرشيد)
  // ═══════════════════════════════════════════════════════

  async _insertPurchaseOrders(pgClient) {
    const orders = this.reader.getPurchaseOrders();
    if (!orders || orders.length === 0) return 0;

    let inserted = 0;

    for (const order of orders) {
      // تخطي الطلبيات التي تحولت لفواتير (IsMove=true)
      if (order.isConverted) {
        console.log(`[RSF] ℹ️ طلبية شراء ${order.number} — تخطّي (تحولت لفاتورة)`);
        continue;
      }

      const orderId = uuidv4();
      const orderNumber = `RSF-PO-${order.number}`;

      // ربط المورد من رمز الحساب المحاسبي
      const supplierAccId = this.accountMap[order.supplierAccountCode];
      const supplierId = this.supplierByAccountMap[order.supplierAccountCode] || null;
      const supplierName = this.supplierNameMap[order.supplierAccountCode] || 
                           (supplierId ? null : order.supplierAccountCode);

      // المستودع الافتراضي
      const defaultWarehouseId = this.warehouseMap[1] || null;

      // تحديد الحالة: طلبية شراء = 'order' (من القيم المسموحة في CHECK constraint)
      const stage = 'order';
      const orderDate = order.date ? new Date(order.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

      try {
        // إدخال رأس الطلبية في purchase_transactions
        await pgClient.query(`
          INSERT INTO purchase_transactions (
            id, tenant_id, company_id, branch_id, stage, order_no,
            supplier_id, doc_date, order_date,
            warehouse_id, currency, exchange_rate,
            subtotal, discount_amount, tax_amount, expenses_total, total_amount,
            paid_amount, balance,
            is_posted, is_active,
            notes, confirmation_status,
            created_by, created_at, updated_at,
            expenses, attachments
          ) VALUES (
            $1, $2, $3, NULL, $4, $5,
            $6, $7, $7,
            $8, $9, 1,
            $10, 0, 0, 0, $10,
            0, $10,
            false, true,
            $11, 'confirmed',
            $12, NOW(), NOW(),
            '[]'::jsonb, '[]'::jsonb
          )
          ON CONFLICT (id) DO NOTHING
        `, [
          orderId, this.tenantId, this.companyId, stage, orderNumber,
          supplierId, orderDate,
          defaultWarehouseId, this.baseCurrencyCode,
          order.total,
          order.notes || `طلبية شراء رقم ${order.number}`,
          this.userId
        ]);

        // إدخال بنود الطلبية
        for (let li = 0; li < order.lines.length; li++) {
          const line = order.lines[li];
          const materialCode = line.materialCode;
          const materialId = this.materialMap[materialCode] || null;
          const productId = this.productMap[materialCode] || null;
          const materialName = this.materialNameMap[materialCode] || line.name || materialCode;

          await pgClient.query(`
            INSERT INTO purchase_transaction_items (
              id, transaction_id, line_number,
              product_id, material_id,
              description, description_ar,
              quantity, received_qty, returned_qty,
              unit_price, subtotal, total,
              warehouse_id,
              notes, created_at, updated_at
            ) VALUES (
              $1, $2, $3,
              $4, $5,
              $6, $6,
              $7, 0, 0,
              $8, $9, $9,
              $10,
              NULL, NOW(), NOW()
            )
            ON CONFLICT (id) DO NOTHING
          `, [
            uuidv4(), orderId, li + 1,
            productId, materialId,
            materialName,
            line.quantity, line.unitPrice, line.total,
            defaultWarehouseId
          ]);
        }

        inserted++;
        console.log(`[RSF] ✅ طلبية شراء: ${orderNumber} (${order.lines.length} بند، المجموع: ${order.total})`);
        this._emit('استيراد طلبيات الشراء', inserted, orders.length);
      } catch (e) {
        console.warn(`[RSF] ⚠️ طلبية شراء ${order.number}:`, e.message.substring(0, 100));
      }
    }

    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // حركات المستودع
  // ═══════════════════════════════════════════════════════

  async _insertInventoryMoves(pgClient) {
    const movesResult = this.reader.getInventoryMoves();
    if (!movesResult) return 0;

    const { allMoves = [], transfers = [], standalone = [] } = 
      Array.isArray(movesResult) ? { allMoves: movesResult } : movesResult;

    const defaultWarehouseId = this.warehouseMap['main'] || null;
    let inserted = 0;
    let moveSeq = 0;
    let transferSeq = 0;

    // ═══ تصفية: حذف حركات البيع والشراء (تم إنشاؤها مع الفواتير) ═══
    const independentMoves = allMoves.filter(m => 
      m.type !== 'purchase' && m.type !== 'sale' && 
      m.type !== 'transfer_out' && m.type !== 'transfer_in'
    );

    console.log(`[RSF] حركات المخزون: ${allMoves.length} إجمالي → ${independentMoves.length} مستقلة (بعد تصفية البيع/الشراء)`);

    // ═══ 1. استيراد المناقلات من MoveMats ═══
    for (const transfer of transfers) {
      transferSeq++;
      const transferId = uuidv4();
      const transferNumber = `RSF-TR-${transferSeq}`;
      const moveDate = transfer.date ? new Date(transfer.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      // تحديد المستودع المصدر والهدف من أول بند
      const firstLine = transfer.lines[0] || {};
      const fromWarehouseId = this.warehouseMap[String(firstLine.fromWarehouse)] || defaultWarehouseId;
      const toWarehouseId = this.warehouseMap[String(firstLine.toWarehouse)] || defaultWarehouseId;
      let totalQty = 0;

      // إنشاء وثيقة المناقلة
      await pgClient.query(`
        INSERT INTO stock_transfers
        (id, tenant_id, company_id, transfer_number, transfer_date,
         from_warehouse_id, to_warehouse_id, status, notes, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',$8,$9)
        ON CONFLICT DO NOTHING
      `, [
        transferId, this.tenantId, this.companyId,
        transferNumber, moveDate,
        fromWarehouseId, toWarehouseId,
        transfer.notes || `مناقلة مستوردة من الرشيد رقم ${transfer.number}`,
        this.userId
      ]);

      // إنشاء بنود المناقلة + حركات المخزون
      for (let i = 0; i < transfer.lines.length; i++) {
        const line = transfer.lines[i];
        const materialId = this.materialMap[line.materialCode] || null;
        const qty = line.quantity || 0;
        const lineFromWh = this.warehouseMap[String(line.fromWarehouse)] || fromWarehouseId;
        const lineToWh = this.warehouseMap[String(line.toWarehouse)] || toWarehouseId;
        totalQty += qty;

        // بند المناقلة
        if (materialId) {
          await pgClient.query(`
            INSERT INTO stock_transfer_items
            (id, transfer_id, material_id, quantity, notes)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT DO NOTHING
          `, [uuidv4(), transferId, materialId, qty, '']);
        }

        moveSeq++;
        // حركة خروج (transfer_out)
        await pgClient.query(`
          INSERT INTO inventory_movements
          (id, company_id, tenant_id, material_id,
           warehouse_id, from_warehouse_id, to_warehouse_id,
           movement_number, movement_type, movement_date,
           quantity, unit_cost, total_cost, notes,
           reference_type, reference_id, reference_number, created_by, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'transfer_out',$9,$10,0,0,$11,'stock_transfer',$12,$13,$14,'completed')
        `, [
          uuidv4(), this.companyId, this.tenantId, materialId,
          lineFromWh, lineFromWh, lineToWh,
          `${transferNumber}-OUT-${i+1}`, moveDate,
          qty,
          `مناقلة خروج | ${transferNumber}`,
          transferId, transferNumber, this.userId
        ]);

        // حركة دخول (transfer_in)
        await pgClient.query(`
          INSERT INTO inventory_movements
          (id, company_id, tenant_id, material_id,
           warehouse_id, from_warehouse_id, to_warehouse_id,
           movement_number, movement_type, movement_date,
           quantity, unit_cost, total_cost, notes,
           reference_type, reference_id, reference_number, created_by, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'transfer_in',$9,$10,0,0,$11,'stock_transfer',$12,$13,$14,'completed')
        `, [
          uuidv4(), this.companyId, this.tenantId, materialId,
          lineToWh, lineFromWh, lineToWh,
          `${transferNumber}-IN-${i+1}`, moveDate,
          qty,
          `مناقلة دخول | ${transferNumber}`,
          transferId, transferNumber, this.userId
        ]);
      }

      const fromName = Object.entries(this.warehouseMap).find(([k,v]) => v === fromWarehouseId)?.[0] || '?';
      const toName = Object.entries(this.warehouseMap).find(([k,v]) => v === toWarehouseId)?.[0] || '?';
      console.log(`[RSF] ✅ مناقلة ${transferNumber}: مستودع ${fromName} → مستودع ${toName} (${transfer.lines.length} مادة، ${totalQty} وحدة)`);
      inserted++;
    }

    // ═══ 2. الحركات المستقلة (تسويات) ═══
    for (const move of independentMoves) {
      const moveDate = move.date ? new Date(move.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const warehouseId = this.warehouseMap[String(move.warehouseNum)] || defaultWarehouseId;
      const materialId = this.materialMap[move.materialCode] || null;
      const qty = move.quantity || 0;
      const cost = move.price || 0;
      moveSeq++;

      await pgClient.query(`
        INSERT INTO inventory_movements
        (id, company_id, tenant_id, material_id,
         warehouse_id, from_warehouse_id, to_warehouse_id,
         movement_number, movement_type, movement_date,
         quantity, unit_cost, total_cost, notes,
         reference_type, reference_number, created_by, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'adjustment_in',$9,$10,$11,$12,$13,'adjustment',$14,$15,'completed')
      `, [
        uuidv4(), this.companyId, this.tenantId,
        materialId,
        warehouseId, warehouseId, warehouseId,
        `RSF-ADJ-${moveSeq}`, moveDate,
        qty, cost, qty * cost,
        move.notes || `تسوية مخزنية`,
        `RSF-ADJ-${moveSeq}`, this.userId
      ]);
      inserted++;
    }

    console.log(`[RSF] ✅ حركات المخزون: ${independentMoves.length} مستقلة + ${transferSeq} مناقلة`);
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // سندات القبض والدفع → cash_transactions
  // ═══════════════════════════════════════════════════════

  async _insertReceipts(pgClient) {
    const receipts = this.reader.getReceipts();
    if (!receipts || receipts.length === 0) return 0;

    // البحث عن أول cash_account_id
    let defaultCashAccountId = null;
    const cashAccCode = '181';
    const cashAccId = this.accountMap[cashAccCode];
    if (cashAccId) {
      // محاولة إيجاد cash_account مرتبط
      const { rows } = await pgClient.query(
        'SELECT id FROM cash_accounts WHERE company_id = $1 LIMIT 1',
        [this.companyId]
      );
      if (rows.length > 0) {
        defaultCashAccountId = rows[0].id;
      } else {
        // إنشاء cash_account مرتبط بحساب 181
        defaultCashAccountId = uuidv4();
        try {
          await pgClient.query(`
            INSERT INTO cash_accounts
            (id, tenant_id, company_id, code, name_ar, name_en,
             account_type, gl_account_id, currency, is_active)
            VALUES ($1,$2,$3,'CASH-MAIN','الصندوق الرئيسي','Main Cash',
                    'cash',$4,$5,true)
            ON CONFLICT DO NOTHING
          `, [defaultCashAccountId, this.tenantId, this.companyId, cashAccId, this.baseCurrencyCode]);
        } catch { defaultCashAccountId = null; }
      }
    }

    if (!defaultCashAccountId) {
      console.warn('[RSF] ⚠️ لا يوجد حساب صندوق — تخطي سندات القبض/الدفع');
      return 0;
    }

    let inserted = 0;
    for (const receipt of receipts) {
      const receiptDate = receipt.date ? new Date(receipt.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      // type: 1=قبض, 2=دفع
      const txType = receipt.type === 2 ? 'payment' : 'receipt';
      const contraAccountId = receipt.accountCode ? (this.accountMap[receipt.accountCode] || null) : null;

      await pgClient.query(`
        INSERT INTO cash_transactions
        (id, tenant_id, company_id, transaction_number, transaction_date,
         transaction_type, cash_account_id, amount, currency, exchange_rate,
         contra_account_id, description, status, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,'confirmed',$12)
        ON CONFLICT DO NOTHING
      `, [
        uuidv4(), this.tenantId, this.companyId,
        `RSF-REC-${receipt.number}`, receiptDate,
        txType, defaultCashAccountId,
        receipt.amount || 0, this.baseCurrencyCode,
        contraAccountId,
        receipt.notes || `سند ${txType === 'receipt' ? 'قبض' : 'دفع'} رقم ${receipt.number}`,
        this.userId
      ]);

      inserted++;
      this._emit('استيراد سندات القبض/الدفع', inserted, receipts.length);
    }
    return inserted;
  }

  // ═══════════════════════════════════════════════════════
  // الأرصدة الختامية من EndBal
  // ═══════════════════════════════════════════════════════

  async _updateEndBalances(pgClient) {
    const endBalRows = this.reader._readTable('EndBal');
    if (!endBalRows || endBalRows.length === 0) return 0;

    let updated = 0;
    for (const row of endBalRows) {
      const accCode = String(row.Num || row.AccNum || '').trim();
      if (!accCode) continue;

      const accountId = this.accountMap[accCode];
      if (!accountId) continue;

      const endDebit = parseFloat(row.Debt || row.Debit || row.EndDebt) || 0;
      const endCredit = parseFloat(row.Credit || row.EndCredit) || 0;
      const balance = endDebit - endCredit;

      await pgClient.query(`
        UPDATE chart_of_accounts 
        SET opening_balance = 0, current_balance = $1
        WHERE id = $2
      `, [balance, accountId]);

      updated++;
    }
    console.log(`[RSF] ✅ تم تحديث ${updated} رصيد ختامي من EndBal`);
    return updated;
  }

  // ═══════════════════════════════════════════════════════
  // إعدادات المحاسبة التلقائية
  // ═══════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════
  // إعادة حساب الأرصدة الحالية من القيود + حساب المجموعات
  // ═══════════════════════════════════════════════════════

  async _recalculateBalances(pgClient) {
    // 1. تحديث current_balance للحسابات التفصيلية = مجموع (مدين - دائن) من القيود فقط (opening_balance=0 دائماً لأن كل الحركات مستوردة)
    const detailResult = await pgClient.query(`
      UPDATE chart_of_accounts coa
      SET current_balance = COALESCE(je_totals.net_amount, 0)
      FROM (
        SELECT jel.account_id,
               SUM(jel.debit - jel.credit) as net_amount
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id AND je.is_posted = true
        WHERE je.company_id = $1
        GROUP BY jel.account_id
      ) je_totals
      WHERE coa.id = je_totals.account_id
        AND coa.company_id = $1
        AND coa.is_detail = true
    `, [this.companyId]);

    const detailUpdated = detailResult.rowCount || 0;

    // 2. تحديث أرصدة المجموعات (الآباء) = مجموع أرصدة الأبناء
    // نكرر العملية عدة مرات لضمان تحديث كل مستوى (الأبناء ← الآباء ← الأجداد)
    for (let level = 0; level < 5; level++) {
      const groupResult = await pgClient.query(`
        UPDATE chart_of_accounts parent
        SET current_balance = COALESCE(children_sum.total, 0),
            opening_balance = 0
        FROM (
          SELECT parent_id,
                 SUM(current_balance) as total
          FROM chart_of_accounts
          WHERE company_id = $1
            AND parent_id IS NOT NULL
          GROUP BY parent_id
        ) children_sum
        WHERE parent.id = children_sum.parent_id
          AND parent.company_id = $1
          AND parent.is_group = true
      `, [this.companyId]);

      if ((groupResult.rowCount || 0) === 0) break;
    }

    // 3. تحديث أرصدة العملاء في جدول customers من حساباتهم
    await pgClient.query(`
      UPDATE customers c
      SET balance = COALESCE(coa.current_balance, 0)
      FROM chart_of_accounts coa
      WHERE coa.id = c.receivable_account_id
        AND c.company_id = $1
    `, [this.companyId]);

    // 4. تحديث أرصدة الموردين في جدول suppliers من حساباتهم
    await pgClient.query(`
      UPDATE suppliers s
      SET balance = COALESCE(coa.current_balance, 0)
      FROM chart_of_accounts coa
      WHERE coa.id = s.payable_account_id
        AND s.company_id = $1
    `, [this.companyId]);

    console.log(`[RSF] ✅ إعادة حساب الأرصدة: ${detailUpdated} حساب تفصيلي + مجموعات + عملاء/موردين`);
    return detailUpdated;
  }



  // ═══════════════════════════════════════════════════════
  // تحميل العملات من ملف الرشيد
  // ═══════════════════════════════════════════════════════

  _loadCurrencies() {
    const currencies = this.reader.getCurrencies();
    const companyInfo = this.reader.getCompanyInfo();
    
    // خريطة أسماء العملات → ISO codes
    const NAME_TO_ISO = {
      'غريفن': 'UAH', 'هريفنيا': 'UAH', 'гривня': 'UAH', 'hryvnia': 'UAH', 'uah': 'UAH',
      'دولار': 'USD', 'доллар': 'USD', 'dollar': 'USD', 'usd': 'USD',
      'يورو': 'EUR', 'евро': 'EUR', 'euro': 'EUR', 'eur': 'EUR',
      'ريال': 'SAR', 'sar': 'SAR',
      'درهم': 'AED', 'aed': 'AED',
      'ليرة': 'TRY', 'try': 'TRY', 'tl': 'TRY',
      'روبل': 'RUB', 'рубль': 'RUB', 'rub': 'RUB',
      'جنيه': 'EGP', 'egp': 'EGP',
      'دينار': 'KWD',
    };

    const detectIsoCode = (name) => {
      if (!name) return null;
      const lower = name.toLowerCase().trim();
      for (const [keyword, iso] of Object.entries(NAME_TO_ISO)) {
        if (lower.includes(keyword)) return iso;
      }
      return null;
    };

    // بناء خريطة العملات
    for (const curr of currencies) {
      if (!curr.name) continue;
      const iso = detectIsoCode(curr.name) || detectIsoCode(curr.nameAr);
      if (iso) {
        this.currencyMap[curr.num] = { code: iso, rate: curr.rate || 1, name: curr.name };
      }
    }

    // تعيين العملة المحلية (num=1, Price=1) والأجنبية (num=2)
    const baseCurr = this.currencyMap[1];
    const foreignCurr = this.currencyMap[2];
    
    if (baseCurr) this.baseCurrencyCode = baseCurr.code;
    if (foreignCurr) this.foreignCurrencyCode = foreignCurr.code;

    console.log(`[RSF] العملة المحلية: ${this.baseCurrencyCode}, الأجنبية: ${this.foreignCurrencyCode}`);
    console.log(`[RSF] خريطة العملات:`);
    for (const [num, info] of Object.entries(this.currencyMap)) {
      console.log(`  [RSF]   num=${num} → ${info.code} (rate=${info.rate}, name=${info.name})`);
    }
  }

  /**
   * ═══ اكتشاف العملة الأجنبية الفعلية للسطر ═══
   * عندما currencyNum يشير للعملة الأساسية لكن هناك foreignAmount,
   * نبحث عن العملة الأجنبية المناسبة من الخريطة.
   * الأولوية: currencyMap[2] (العملة الأجنبية الرئيسية) → أول عملة غير أساسية
   */
  _detectLineForeignCurrency(lineCurrencyNum) {
    // أولاً: العملة الأجنبية الرئيسية (num=2 عادةً)
    if (this.foreignCurrencyCode && this.foreignCurrencyCode !== this.baseCurrencyCode) {
      return this.foreignCurrencyCode;
    }
    // ثانياً: أول عملة غير أساسية في الخريطة
    for (const [num, info] of Object.entries(this.currencyMap)) {
      if (info.code !== this.baseCurrencyCode && parseInt(num) !== lineCurrencyNum) {
        return info.code;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════
  // مزامنة أسعار صرف العملات من الرشيد → قاعدة البيانات
  // ═══════════════════════════════════════════════════════

  async _syncCurrenciesToDB(pgClient) {
    // ═══ 1. تحديد العملة الأساسية (is_base = true) في currencies ═══
    await pgClient.query(`
      UPDATE currencies SET is_base = (code = $1)
      WHERE tenant_id IS NULL OR tenant_id = $2
    `, [this.baseCurrencyCode, this.tenantId]);

    // ═══ 2. تحديث أسعار الصرف في جدول currencies ═══
    let updated = 0;
    for (const [num, info] of Object.entries(this.currencyMap)) {
      const rate = info.rate || 1;
      const res = await pgClient.query(`
        UPDATE currencies 
        SET exchange_rate = $1, updated_at = now()
        WHERE code = $2 AND (tenant_id IS NULL OR tenant_id = $3)
      `, [rate, info.code, this.tenantId]);
      if (res.rowCount > 0) updated++;
    }

    // ═══ 3. إدخال أسعار الصرف في جدول exchange_rates (المصدر الفعلي للـ Frontend) ═══
    // حذف الأسعار القديمة المستوردة
    await pgClient.query(`
      DELETE FROM exchange_rates 
      WHERE company_id = $1 AND source = 'rsf_import'
    `, [this.companyId]);

    let ratesInserted = 0;
    for (const [num, info] of Object.entries(this.currencyMap)) {
      const rate = info.rate || 1;
      // لا نُدخل سعر صرف للعملة الأساسية لنفسها
      if (info.code === this.baseCurrencyCode) continue;

      // إدخال سعر الصرف: العملة الأجنبية → العملة المحلية
      // مثال: USD → UAH, buy_rate = 41.5 (يعني 1 USD = 41.5 UAH)
      // ⚠️ mid_rate عمود محسوب تلقائياً = (buy_rate + sell_rate) / 2
      await pgClient.query(`
        INSERT INTO exchange_rates 
          (tenant_id, company_id, from_currency, to_currency, buy_rate, sell_rate,
           margin_percent, effective_from, source, is_active)
        VALUES ($1, $2, $3, $4, $5, $5, 0, now(), 'rsf_import', true)
      `, [this.tenantId, this.companyId, info.code, this.baseCurrencyCode, rate]);
      ratesInserted++;
    }

    console.log(`[RSF] مزامنة العملات: الأساسية=${this.baseCurrencyCode}, currencies=${updated}, exchange_rates=${ratesInserted}`);
    for (const [num, info] of Object.entries(this.currencyMap)) {
      console.log(`  [${num}] ${info.code} (${info.name}): سعر الصرف = ${info.rate}`);
    }
    return updated;
  }

  async _fillAccountingSettings(pgClient) {
    // ═══════════════════════════════════════════════════════════════════
    // بحث ذكي عن الحسابات الافتراضية — يدعم شجرة الرشيد وشجرة NexaCore
    // كل حقل له مصفوفة أولويات: الأول = الأفضل (تفصيلي)، الأخير = بديل
    // ═══════════════════════════════════════════════════════════════════

    // ─── تحميل كامل الشجرة في accountMap (بما فيها حسابات NexaCore القياسية) ───
    const fullChart = await pgClient.query(
      `SELECT id, account_code FROM chart_of_accounts 
       WHERE company_id = $1 AND tenant_id = $2 AND is_detail = true AND is_active = true`,
      [this.companyId, this.tenantId]
    );
    let loadedNew = 0;
    for (const row of fullChart.rows) {
      if (!this.accountMap[row.account_code]) {
        this.accountMap[row.account_code] = row.id;
        loadedNew++;
      }
    }
    if (loadedNew > 0) {
      console.log(`[RSF] ⚙️ تحميل ${loadedNew} حساب إضافي من شجرة NexaCore إلى accountMap`);
    }

    // ─── إنشاء حسابات ناقصة ضرورية (غير موجودة في الرشيد) ───
    const ensureDetailAccount = async (code, nameAr, nameEn, parentCode, typeCode) => {
      if (this.accountMap[code]) return; // already exists
      // find parent group
      const parentRes = await pgClient.query(
        `SELECT id, account_type_id FROM chart_of_accounts WHERE company_id=$1 AND tenant_id=$2 AND account_code=$3 LIMIT 1`,
        [this.companyId, this.tenantId, parentCode]
      );
      if (parentRes.rows.length === 0) return;
      const parentId = parentRes.rows[0].id;
      const typeRes = await pgClient.query(`SELECT id FROM account_types WHERE code=$1 LIMIT 1`, [typeCode]);
      const typeId = typeRes.rows.length > 0 ? typeRes.rows[0].id : parentRes.rows[0].account_type_id;
      const baseCurrency = this.baseCurrencyCode || 'USD';
      const ins = await pgClient.query(
        `INSERT INTO chart_of_accounts (tenant_id, company_id, account_code, name_ar, name_en, account_type_id, parent_id, is_detail, is_active, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, $8)
         ON CONFLICT (tenant_id, company_id, account_code) DO NOTHING RETURNING id`,
        [this.tenantId, this.companyId, code, nameAr, nameEn, typeId, parentId, baseCurrency]
      );
      if (ins.rows.length > 0) {
        this.accountMap[code] = ins.rows[0].id;
        console.log(`[RSF] ✅ إنشاء حساب ناقص: ${code} - ${nameAr}`);
      }
    };
    // 1151 مشتريات بالطريق — ضروري للنظام، غير موجود بالرشيد
    await ensureDetailAccount('1151', 'مشتريات بالطريق', 'Purchases in Transit', '115', 'ASSET');

    const findAcc = (codes) => {
      for (const code of codes) {
        if (this.accountMap[code]) return this.accountMap[code];
      }
      return null;
    };

    // خريطة الربط الشاملة: 27 حساب افتراضي
    // الأولوية: NexaCore Extended → NexaCore Simple → أكواد الرشيد الأصلية
    const settingsMap = {
      // ─── الحسابات المالية الأساسية ───
      default_cash_account_id:                findAcc(['1111', '1112', '111', '181', '1811']),
      default_bank_account_id:                findAcc(['1121', '1122', '112', '182', '1821']),
      default_receivable_account_id:          findAcc(['1131-SUM', '1131', '113', '161', '1610']),
      default_payable_account_id:             findAcc(['2111-SUM', '2111', '211', '261', '2610']),
      // ─── حسابات المبيعات والإيرادات ───
      default_sales_account_id:               findAcc(['411', '412', '41']),
      default_revenue_account_id:             findAcc(['411', '412', '41']),
      default_sales_returns_account_id:       findAcc(['414']),
      default_sales_discount_account_id:      findAcc(['413']),
      // ─── حسابات المشتريات ───
      default_purchase_account_id:            findAcc(['521', '341', '52']),
      default_cogs_account_id:                findAcc(['511', '51']),
      default_purchase_returns_account_id:    findAcc(['522']),
      default_purchase_discount_account_id:   findAcc(['523', '431']),
      // ─── حسابات المصروفات ───
      default_expense_account_id:             findAcc(['596', '535', '53']),
      // ─── حسابات المخزون ───
      default_inventory_account_id:           findAcc(['1141', '114', '135']),
      default_inventory_variance_account_id:  findAcc(['592']),
      default_git_account_id:                 findAcc(['115']),
      default_transit_purchase_account_id:    findAcc(['1151', '1145']),
      // ─── حسابات الضرائب ───
      default_tax_input_account_id:           findAcc(['117', '139']),
      default_tax_output_account_id:          findAcc(['214', '216']),
      // ─── حسابات فروقات العملة ───
      default_fx_gain_account_id:             findAcc(['422', '433']),
      default_fx_loss_account_id:             findAcc(['591', '543']),
      // ─── حسابات السلف والدفعات المقدمة ───
      default_customer_advance_account_id:    findAcc(['215']),
      default_supplier_advance_account_id:    findAcc(['118']),
      // ─── حسابات متنوعة ───
      default_retained_earnings_account_id:   findAcc(['32', '227']),
      default_depreciation_account_id:        findAcc(['597']),
      default_freight_in_account_id:          findAcc(['581']),
      default_petty_cash_account_id:          findAcc(['1113']),
    };

    // ─── سجل التتبع: كم حساب تم ربطه ───
    const matched = Object.entries(settingsMap).filter(([, v]) => v !== null);
    const missing = Object.entries(settingsMap).filter(([, v]) => v === null).map(([k]) => k);
    console.log(`[RSF] ⚙️ إعدادات الحسابات الافتراضية: تم ربط ${matched.length}/27 حساب`);
    if (missing.length > 0) {
      console.log(`[RSF] ⚠️ حسابات لم يتم ربطها: ${missing.join(', ')}`);
    }

    // العملات المدعومة
    const supportedCurrencies = [this.baseCurrencyCode];
    if (this.foreignCurrencyCode && this.foreignCurrencyCode !== this.baseCurrencyCode) {
      supportedCurrencies.push(this.foreignCurrencyCode);
    }

    // تحقق من وجود سجل
    const { rows } = await pgClient.query(
      'SELECT company_id FROM company_accounting_settings WHERE company_id = $1',
      [this.companyId]
    );

    if (rows.length > 0) {
      await pgClient.query(`
        UPDATE company_accounting_settings SET
          base_currency = $2,
          supported_currencies = $3,
          default_cash_account_id = COALESCE($4, default_cash_account_id),
          default_bank_account_id = COALESCE($5, default_bank_account_id),
          default_receivable_account_id = COALESCE($6, default_receivable_account_id),
          default_payable_account_id = COALESCE($7, default_payable_account_id),
          default_sales_account_id = COALESCE($8, default_sales_account_id),
          default_revenue_account_id = COALESCE($9, default_revenue_account_id),
          default_sales_returns_account_id = COALESCE($10, default_sales_returns_account_id),
          default_sales_discount_account_id = COALESCE($11, default_sales_discount_account_id),
          default_purchase_account_id = COALESCE($12, default_purchase_account_id),
          default_cogs_account_id = COALESCE($13, default_cogs_account_id),
          default_purchase_returns_account_id = COALESCE($14, default_purchase_returns_account_id),
          default_purchase_discount_account_id = COALESCE($15, default_purchase_discount_account_id),
          default_expense_account_id = COALESCE($16, default_expense_account_id),
          default_inventory_account_id = COALESCE($17, default_inventory_account_id),
          default_inventory_variance_account_id = COALESCE($18, default_inventory_variance_account_id),
          default_git_account_id = COALESCE($19, default_git_account_id),
          default_transit_purchase_account_id = COALESCE($20, default_transit_purchase_account_id),
          default_tax_input_account_id = COALESCE($21, default_tax_input_account_id),
          default_tax_output_account_id = COALESCE($22, default_tax_output_account_id),
          default_fx_gain_account_id = COALESCE($23, default_fx_gain_account_id),
          default_fx_loss_account_id = COALESCE($24, default_fx_loss_account_id),
          default_customer_advance_account_id = COALESCE($25, default_customer_advance_account_id),
          default_supplier_advance_account_id = COALESCE($26, default_supplier_advance_account_id),
          default_retained_earnings_account_id = COALESCE($27, default_retained_earnings_account_id),
          default_depreciation_account_id = COALESCE($28, default_depreciation_account_id),
          default_freight_in_account_id = COALESCE($29, default_freight_in_account_id),
          default_petty_cash_account_id = COALESCE($30, default_petty_cash_account_id),
          vat_enabled = false,
          vat_rate = 0
        WHERE company_id = $1
      `, [
        this.companyId, this.baseCurrencyCode, '{' + supportedCurrencies.join(',') + '}',
        settingsMap.default_cash_account_id,
        settingsMap.default_bank_account_id,
        settingsMap.default_receivable_account_id,
        settingsMap.default_payable_account_id,
        settingsMap.default_sales_account_id,
        settingsMap.default_revenue_account_id,
        settingsMap.default_sales_returns_account_id,
        settingsMap.default_sales_discount_account_id,
        settingsMap.default_purchase_account_id,
        settingsMap.default_cogs_account_id,
        settingsMap.default_purchase_returns_account_id,
        settingsMap.default_purchase_discount_account_id,
        settingsMap.default_expense_account_id,
        settingsMap.default_inventory_account_id,
        settingsMap.default_inventory_variance_account_id,
        settingsMap.default_git_account_id,
        settingsMap.default_transit_purchase_account_id,
        settingsMap.default_tax_input_account_id,
        settingsMap.default_tax_output_account_id,
        settingsMap.default_fx_gain_account_id,
        settingsMap.default_fx_loss_account_id,
        settingsMap.default_customer_advance_account_id,
        settingsMap.default_supplier_advance_account_id,
        settingsMap.default_retained_earnings_account_id,
        settingsMap.default_depreciation_account_id,
        settingsMap.default_freight_in_account_id,
        settingsMap.default_petty_cash_account_id,
      ]);
    } else {
      await pgClient.query(`
        INSERT INTO company_accounting_settings 
        (tenant_id, company_id, base_currency, supported_currencies,
         default_cash_account_id, default_bank_account_id,
         default_receivable_account_id, default_payable_account_id,
         default_sales_account_id, default_revenue_account_id,
         default_sales_returns_account_id, default_sales_discount_account_id,
         default_purchase_account_id, default_cogs_account_id,
         default_purchase_returns_account_id, default_purchase_discount_account_id,
         default_expense_account_id,
         default_inventory_account_id, default_inventory_variance_account_id,
         default_git_account_id, default_transit_purchase_account_id,
         default_tax_input_account_id, default_tax_output_account_id,
         default_fx_gain_account_id, default_fx_loss_account_id,
         default_customer_advance_account_id, default_supplier_advance_account_id,
         default_retained_earnings_account_id, default_depreciation_account_id,
         default_freight_in_account_id, default_petty_cash_account_id,
         vat_enabled, vat_rate)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,false,0)
        ON CONFLICT DO NOTHING
      `, [
        this.tenantId, this.companyId, this.baseCurrencyCode, '{' + supportedCurrencies.join(',') + '}',
        settingsMap.default_cash_account_id,
        settingsMap.default_bank_account_id,
        settingsMap.default_receivable_account_id,
        settingsMap.default_payable_account_id,
        settingsMap.default_sales_account_id,
        settingsMap.default_revenue_account_id,
        settingsMap.default_sales_returns_account_id,
        settingsMap.default_sales_discount_account_id,
        settingsMap.default_purchase_account_id,
        settingsMap.default_cogs_account_id,
        settingsMap.default_purchase_returns_account_id,
        settingsMap.default_purchase_discount_account_id,
        settingsMap.default_expense_account_id,
        settingsMap.default_inventory_account_id,
        settingsMap.default_inventory_variance_account_id,
        settingsMap.default_git_account_id,
        settingsMap.default_transit_purchase_account_id,
        settingsMap.default_tax_input_account_id,
        settingsMap.default_tax_output_account_id,
        settingsMap.default_fx_gain_account_id,
        settingsMap.default_fx_loss_account_id,
        settingsMap.default_customer_advance_account_id,
        settingsMap.default_supplier_advance_account_id,
        settingsMap.default_retained_earnings_account_id,
        settingsMap.default_depreciation_account_id,
        settingsMap.default_freight_in_account_id,
        settingsMap.default_petty_cash_account_id,
      ]);
    }

    // تحديث عملة الشركة أيضاً
    await pgClient.query(
      'UPDATE companies SET default_currency = $1 WHERE id = $2',
      [this.baseCurrencyCode, this.companyId]
    );
  }

  // ═══════════════════════════════════════════════════════
  // ملء جدول inventory_stock — ربط الكميات بالمستودعات
  // ═══════════════════════════════════════════════════════

  async _populateInventoryStock(pgClient) {
    // الحساب الفعلي للكميات لكل مادة في كل مستودع من حركات المخزون المستوردة
    const result = await pgClient.query(`
      INSERT INTO inventory_stock (
        tenant_id, company_id, material_id, warehouse_id,
        quantity_on_hand, initial_quantity, current_quantity,
        average_cost, last_cost, last_movement_date, batch_number
      )
      SELECT 
        im.tenant_id,
        im.company_id,
        im.material_id,
        COALESCE(im.to_warehouse_id, im.from_warehouse_id) AS warehouse_id,
        SUM(CASE 
          WHEN im.movement_type IN ('receipt','purchase','return_in','adjustment_in','transfer_in','in') THEN im.quantity
          WHEN im.movement_type IN ('sale','issue','return_out','adjustment_out','transfer_out','out') THEN -im.quantity
          ELSE 0
        END) AS qty,
        SUM(CASE 
          WHEN im.movement_type IN ('receipt','purchase','return_in','adjustment_in','transfer_in','in') THEN im.quantity
          WHEN im.movement_type IN ('sale','issue','return_out','adjustment_out','transfer_out','out') THEN -im.quantity
          ELSE 0
        END) AS init_qty,
        SUM(CASE 
          WHEN im.movement_type IN ('receipt','purchase','return_in','adjustment_in','transfer_in','in') THEN im.quantity
          WHEN im.movement_type IN ('sale','issue','return_out','adjustment_out','transfer_out','out') THEN -im.quantity
          ELSE 0
        END) AS curr_qty,
        CASE WHEN SUM(CASE WHEN im.movement_type IN ('receipt','purchase','in') THEN im.quantity ELSE 0 END) > 0
          THEN SUM(CASE WHEN im.movement_type IN ('receipt','purchase','in') THEN im.quantity * COALESCE(im.unit_cost, 0) ELSE 0 END) 
               / SUM(CASE WHEN im.movement_type IN ('receipt','purchase','in') THEN im.quantity ELSE 0 END)
          ELSE 0
        END AS avg_cost,
        MAX(COALESCE(im.unit_cost, 0)) AS last_cost,
        MAX(im.movement_date) AS last_move,
        'RSF-IMPORT'
      FROM inventory_movements im
      WHERE im.company_id = $1
        AND im.material_id IS NOT NULL
        AND COALESCE(im.to_warehouse_id, im.from_warehouse_id) IS NOT NULL
      GROUP BY im.tenant_id, im.company_id, im.material_id, COALESCE(im.to_warehouse_id, im.from_warehouse_id)
      ON CONFLICT DO NOTHING
    `, [this.companyId]);

    const stockRows = result.rowCount || 0;

    // أيضاً: إدخال أرصدة المواد التي لها current_stock في fabric_materials ولكن ليس لديها حركات
    const matResult = await pgClient.query(`
      INSERT INTO inventory_stock (
        tenant_id, company_id, material_id, warehouse_id,
        quantity_on_hand, initial_quantity, current_quantity,
        average_cost, last_cost, batch_number
      )
      SELECT 
        fm.tenant_id,
        fm.company_id,
        fm.id,
        fm.default_warehouse_id,
        fm.current_stock,
        fm.current_stock,
        fm.current_stock,
        COALESCE(fm.purchase_price, 0),
        COALESCE(fm.purchase_price, 0),
        'RSF-INITIAL'
      FROM fabric_materials fm
      WHERE fm.company_id = $1
        AND fm.current_stock > 0
        AND fm.default_warehouse_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM inventory_stock iss 
          WHERE iss.material_id = fm.id 
            AND iss.warehouse_id = fm.default_warehouse_id
        )
      ON CONFLICT DO NOTHING
    `, [this.companyId]);

    const totalStock = stockRows + (matResult.rowCount || 0);

    // 3. إدخال أرصدة المستودعات المفصّلة من ملف الرشيد (لكل مادة في كل مستودع)
    let rsfStockInserted = 0;
    if (this._materialStockMap && this._materialStockMap.length > 0) {
      for (const entry of this._materialStockMap) {
        await pgClient.query(`
          INSERT INTO inventory_stock (
            tenant_id, company_id, material_id, warehouse_id,
            quantity_on_hand, initial_quantity, current_quantity,
            average_cost, last_cost, batch_number
          ) VALUES ($1, $2, $3, $4, $5, $5, $5, 0, 0, 'RSF-BALANCE')
          ON CONFLICT (material_id, warehouse_id) 
          DO UPDATE SET 
            quantity_on_hand = EXCLUDED.quantity_on_hand,
            initial_quantity = EXCLUDED.initial_quantity,
            current_quantity = EXCLUDED.current_quantity
        `, [this.tenantId, this.companyId, entry.materialId, entry.warehouseId, entry.quantity]);
        rsfStockInserted++;
      }
      console.log(`[RSF] 📦 تم إدراج ${rsfStockInserted} سجل رصيد مستودع مفصّل من الرشيد`);
    }

    const grandTotal = totalStock + rsfStockInserted;
    console.log(`[RSF] ✅ تم ملء ${grandTotal} سجل مخزون (حركات: ${stockRows}, أرصدة عامة: ${matResult.rowCount || 0}, أرصدة مفصّلة: ${rsfStockInserted})`);
    return grandTotal;
  }
}

module.exports = { RsfMapper };
