/**
 * TexaCore RSF Exporter — تصدير بيانات TexaCore إلى ملف الرشيد (.rsf)
 * 
 * يعمل فقط على Windows عبر ODBC (Microsoft Access Driver)
 * يكتب فقط في الجداول الأصلية التي يعرفها الرشيد
 * لا يضيف جداول جديدة — الرشيد يعمل بسلاسة تامة
 * 
 * الاستخدام:
 *   - تلقائي: مزامنة كل 5 دقائق (background sync)
 *   - يدوي: زر "تصدير لملف الرشيد" من الداشبورد
 * 
 * @requires odbc (Windows only)
 */

const path = require('path');
const fs = require('fs');

class RsfExporter {
  /**
   * @param {object} opts
   * @param {string} opts.rsfPath — مسار ملف .rsf
   * @param {object} opts.pgClient — pg.Client متصل
   * @param {string} opts.companyId — UUID الشركة
   * @param {string} opts.tenantId — UUID المستأجر
   * @param {function} opts.onProgress — (step, current, total) => void
   */
  constructor(opts) {
    this.rsfPath = opts.rsfPath;
    this.pgClient = opts.pgClient;
    this.companyId = opts.companyId;
    this.tenantId = opts.tenantId;
    this.onProgress = opts.onProgress || (() => {});
    this.odbcConn = null;
    this.isWindows = process.platform === 'win32';
  }

  // ═══════════════════════════════════════════════════════
  // الاتصال بـ ODBC
  // ═══════════════════════════════════════════════════════

  async connect() {
    if (!this.isWindows) {
      throw new Error('تصدير RSF متاح فقط على Windows (يتطلب ODBC)');
    }

    if (!fs.existsSync(this.rsfPath)) {
      throw new Error(`ملف RSF غير موجود: ${this.rsfPath}`);
    }

    let odbc;
    try {
      odbc = require('odbc');
    } catch (e) {
      throw new Error('مكتبة odbc غير مثبتة. شغّل: npm install odbc');
    }

    // جرّب الـ drivers المتاحة
    const drivers = [
      'Microsoft Access Driver (*.mdb, *.accdb)',
      'Microsoft Access Driver (*.mdb)',
    ];

    let connected = false;
    for (const driver of drivers) {
      try {
        const connStr = `Driver={${driver}};DBQ=${this.rsfPath};`;
        this.odbcConn = await odbc.connect(connStr);
        connected = true;
        console.log('[RSF Export] Connected via:', driver);
        break;
      } catch (e) {
        continue;
      }
    }

    if (!connected) {
      throw new Error('لم يُعثر على Microsoft Access ODBC Driver. تأكد من تثبيت Access Database Engine.');
    }
  }

  async disconnect() {
    if (this.odbcConn) {
      await this.odbcConn.close();
      this.odbcConn = null;
    }
  }

  // ═══════════════════════════════════════════════════════
  // تصدير كامل
  // ═══════════════════════════════════════════════════════

  async exportAll() {
    const results = { success: true, errors: [], counts: {} };

    try {
      await this.connect();

      // 1. شجرة الحسابات
      this.onProgress('تصدير شجرة الحسابات', 0, 1);
      results.counts.accounts = await this._exportAccounts();

      // 2. العملاء
      this.onProgress('تصدير العملاء', 0, 1);
      results.counts.customers = await this._exportCustomers();

      // 3. الموردين
      this.onProgress('تصدير الموردين', 0, 1);
      results.counts.suppliers = await this._exportSuppliers();

      // 4. مراكز التكلفة
      this.onProgress('تصدير مراكز التكلفة', 0, 1);
      results.counts.costCenters = await this._exportCostCenters();

      // 5. القيود المحاسبية
      this.onProgress('تصدير القيود', 0, 1);
      results.counts.journalEntries = await this._exportJournalEntries();

      // 6. الإعدادات
      this.onProgress('تصدير الإعدادات', 0, 1);
      results.counts.settings = await this._exportSettings();

      this.onProgress('تم التصدير بنجاح!', 1, 1);

    } catch (err) {
      results.success = false;
      results.errors.push(err.message);
      console.error('[RSF Export] Error:', err);
    } finally {
      await this.disconnect();
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════
  // تصدير تحديثات فقط (المزامنة التلقائية)
  // ═══════════════════════════════════════════════════════

  async exportUpdates(since) {
    const results = { success: true, errors: [], counts: {} };

    try {
      await this.connect();

      // تصدير القيود الجديدة فقط (بعد تاريخ معين)
      results.counts.journalEntries = await this._exportJournalEntries(since);

      // تحديث أرصدة الحسابات
      results.counts.accounts = await this._updateAccountBalances();

    } catch (err) {
      results.success = false;
      results.errors.push(err.message);
    } finally {
      await this.disconnect();
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════
  // Helper: تنفيذ SQL على Access
  // ═══════════════════════════════════════════════════════

  async _exec(sql, params = []) {
    try {
      return await this.odbcConn.query(sql, params);
    } catch (e) {
      console.warn('[RSF Export] SQL Error:', e.message, '| SQL:', sql.substring(0, 100));
      throw e;
    }
  }

  /**
   * حذف وإعادة إدراج (أبسط وأكثر أماناً من UPDATE)
   */
  async _upsert(table, keyField, keyValue, data) {
    try {
      await this._exec(`DELETE FROM [${table}] WHERE [${keyField}] = ?`, [keyValue]);
    } catch (e) {
      // الصف غير موجود — عادي
    }
    
    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(', ');
    const values = cols.map(c => data[c]);
    
    await this._exec(
      `INSERT INTO [${table}] (${cols.map(c => `[${c}]`).join(', ')}) VALUES (${placeholders})`,
      values
    );
  }

  // ═══════════════════════════════════════════════════════
  // 1. شجرة الحسابات
  // ═══════════════════════════════════════════════════════

  async _exportAccounts() {
    const { rows } = await this.pgClient.query(`
      SELECT account_code, name_ar, name_en, 
             is_group, is_cash_account, is_bank_account,
             current_balance, opening_balance, parent_id,
             (SELECT account_code FROM chart_of_accounts p WHERE p.id = c.parent_id) as parent_code
      FROM chart_of_accounts c
      WHERE company_id = $1
      ORDER BY length(account_code), account_code
    `, [this.companyId]);

    let count = 0;
    for (const row of rows) {
      const debit = row.current_balance > 0 ? row.current_balance : 0;
      const credit = row.current_balance < 0 ? Math.abs(row.current_balance) : 0;

      await this._upsert('Accounts', 'Num', row.account_code, {
        Num: row.account_code,
        NAME: row.name_ar || row.name_en || '',
        Name2: row.name_en || row.name_ar || '',
        Ref: row.parent_code || '0',
        IS_SUB: row.is_group ? 1 : 0,
        Debt: debit,
        Credit: credit,
        MianDebt: 0,
        MianCredit: 0,
        Currency: 0,
      });
      count++;
      if (count % 50 === 0) this.onProgress('تصدير شجرة الحسابات', count, rows.length);
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════
  // 2. العملاء
  // ═══════════════════════════════════════════════════════

  async _exportCustomers() {
    const { rows } = await this.pgClient.query(`
      SELECT code, name_ar, name_en, phone, mobile, email,
             address, city, country, tax_number, credit_limit, notes, balance
      FROM customers
      WHERE company_id = $1
    `, [this.companyId]);

    let count = 0;
    for (const row of rows) {
      await this._upsert('Custmers', 'Num', row.code, {
        Num: row.code,
        Name: row.name_ar || row.name_en || '',
        Name2: row.name_en || '',
        Phone: row.phone || '',
        Mobile: row.mobile || '',
        Email: row.email || '',
        Address: row.address || '',
        City: row.city || '',
        Country: row.country || '',
        TaxNum: row.tax_number || '',
        CreditLimit: row.credit_limit || 0,
        Notes: row.notes || '',
        Balance: row.balance || 0,
      });
      count++;
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════
  // 3. الموردين
  // ═══════════════════════════════════════════════════════

  async _exportSuppliers() {
    const { rows } = await this.pgClient.query(`
      SELECT code, name_ar, name_en, phone, mobile, email,
             address, city, country, tax_number, notes, balance
      FROM suppliers
      WHERE company_id = $1
    `, [this.companyId]);

    let count = 0;
    for (const row of rows) {
      await this._upsert('Suplyers', 'Num', row.code, {
        Num: row.code,
        Name: row.name_ar || row.name_en || '',
        Name2: row.name_en || '',
        Phone: row.phone || '',
        Mobile: row.mobile || '',
        Email: row.email || '',
        Address: row.address || '',
        City: row.city || '',
        Country: row.country || '',
        TaxNum: row.tax_number || '',
        Notes: row.notes || '',
        Balance: row.balance || 0,
      });
      count++;
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════
  // 4. مراكز التكلفة
  // ═══════════════════════════════════════════════════════

  async _exportCostCenters() {
    const { rows } = await this.pgClient.query(`
      SELECT code, name_ar, name_en, is_group,
             (SELECT code FROM cost_centers p WHERE p.id = c.parent_id) as parent_code
      FROM cost_centers c
      WHERE company_id = $1
      ORDER BY length(code), code
    `, [this.companyId]);

    let count = 0;
    for (const row of rows) {
      await this._upsert('CostCenters', 'Num', row.code, {
        Num: row.code,
        Name: row.name_ar || row.name_en || '',
        Name2: row.name_en || '',
        Type: row.is_group ? 0 : 1,
        Ref: row.parent_code || '0',
      });
      count++;
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════
  // 5. القيود المحاسبية
  // ═══════════════════════════════════════════════════════

  async _exportJournalEntries(since = null) {
    let query = `
      SELECT je.id, je.entry_number, je.entry_date, je.description, je.notes,
             je.total_debit, je.total_credit, je.created_at
      FROM journal_entries je
      WHERE je.company_id = $1 AND je.status = 'posted'
    `;
    const params = [this.companyId];
    
    if (since) {
      query += ` AND je.created_at > $2`;
      params.push(since);
    }
    query += ` ORDER BY je.entry_date, je.entry_number`;

    const { rows: entries } = await this.pgClient.query(query, params);

    let count = 0;
    for (const entry of entries) {
      // استخراج الرقم من entry_number (مثل RSF-123 → 123)
      const nrs = parseInt(String(entry.entry_number).replace(/[^0-9]/g, '')) || (count + 1);
      const entryDate = entry.entry_date 
        ? new Date(entry.entry_date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      // رأس القيد → GENDAY
      await this._upsert('GENDAY', 'NRS', nrs, {
        NRS: nrs,
        Date: entryDate,
        Type: 0,
        Notes: entry.description || entry.notes || '',
        TotalDebt: entry.total_debit || 0,
        TotalCredit: entry.total_credit || 0,
        UserID: 1,
        Posted: 1,
      });

      // سطور القيد → MoveDiffar
      const { rows: lines } = await this.pgClient.query(`
        SELECT jel.line_number, jel.debit, jel.credit, jel.description,
               coa.account_code,
               cc.code as cost_center_code
        FROM journal_entry_lines jel
        JOIN chart_of_accounts coa ON coa.id = jel.account_id
        LEFT JOIN cost_centers cc ON cc.id = jel.cost_center_id
        WHERE jel.entry_id = $1
        ORDER BY jel.line_number
      `, [entry.id]);

      // حذف السطور القديمة
      try {
        await this._exec('DELETE FROM [MoveDiffar] WHERE [Num] = ?', [nrs]);
      } catch (e) { /* ignore */ }

      for (const line of lines) {
        await this._exec(`
          INSERT INTO [MoveDiffar] 
          ([Total], [Total1], [Date], [Accnbr], [NBRREC], [Document], [Currency], [LocalTot], [MianTot], [Order], [Num], [CostCenter])
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          line.debit || 0,          // Total = مدين
          line.credit || 0,         // Total1 = دائن
          entryDate,
          line.account_code,
          nrs,                      // NBRREC = رقم القيد
          line.description || '',
          0,                        // Currency = عملة محلية
          line.debit || line.credit || 0,  // LocalTot
          line.debit || line.credit || 0,  // MianTot
          line.line_number,
          nrs,
          line.cost_center_code || '',
        ]);
      }

      count++;
      if (count % 100 === 0) this.onProgress('تصدير القيود', count, entries.length);
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════
  // 6. تحديث أرصدة الحسابات فقط
  // ═══════════════════════════════════════════════════════

  async _updateAccountBalances() {
    const { rows } = await this.pgClient.query(`
      SELECT account_code, current_balance
      FROM chart_of_accounts
      WHERE company_id = $1 AND is_group = false
    `, [this.companyId]);

    let count = 0;
    for (const row of rows) {
      const debit = row.current_balance > 0 ? row.current_balance : 0;
      const credit = row.current_balance < 0 ? Math.abs(row.current_balance) : 0;

      try {
        await this._exec(
          'UPDATE [Accounts] SET [Debt] = ?, [Credit] = ? WHERE [Num] = ?',
          [debit, credit, row.account_code]
        );
        count++;
      } catch (e) { /* account may not exist in RSF */ }
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════
  // 7. الإعدادات
  // ═══════════════════════════════════════════════════════

  async _exportSettings() {
    const { rows } = await this.pgClient.query(`
      SELECT c.name_ar, c.name_en
      FROM companies c WHERE c.id = $1
    `, [this.companyId]);

    if (rows.length === 0) return 0;
    const company = rows[0];

    const settings = {
      CompanyName: company.name_en || company.name_ar || '',
      CompanyNameAr: company.name_ar || company.name_en || '',
      LastExportDate: new Date().toISOString(),
      ExportedBy: 'TexaCore ERP',
    };

    let count = 0;
    for (const [key, value] of Object.entries(settings)) {
      try {
        await this._upsert('Set', 'SetItem', key, {
          SetItem: key,
          SetKey: String(value),
        });
        count++;
      } catch (e) { /* ignore */ }
    }
    return count;
  }
}

// ═══════════════════════════════════════════════════════
// Background Sync Manager
// ═══════════════════════════════════════════════════════

class RsfSyncManager {
  /**
   * @param {object} opts
   * @param {string} opts.rsfPath
   * @param {object} opts.pgClient  
   * @param {string} opts.companyId
   * @param {string} opts.tenantId
   * @param {number} opts.intervalMs — default 5 minutes
   * @param {function} opts.onProgress
   * @param {function} opts.onError
   */
  constructor(opts) {
    this.exporter = new RsfExporter(opts);
    this.intervalMs = opts.intervalMs || 5 * 60 * 1000;
    this.onError = opts.onError || console.error;
    this.timer = null;
    this.lastSyncTime = null;
    this.syncing = false;
  }

  startSync() {
    if (this.timer) return;
    if (!this.exporter.isWindows) {
      console.log('[RSF Sync] Skipped — not on Windows');
      return;
    }

    console.log(`[RSF Sync] Started — interval: ${this.intervalMs / 1000}s`);
    this.timer = setInterval(() => this._doSync(), this.intervalMs);
    
    // أول مزامنة بعد 30 ثانية
    setTimeout(() => this._doSync(), 30000);
  }

  stopSync() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[RSF Sync] Stopped');
    }
  }

  async _doSync() {
    if (this.syncing) return;
    this.syncing = true;

    try {
      const result = await this.exporter.exportUpdates(this.lastSyncTime);
      this.lastSyncTime = new Date().toISOString();

      if (result.success) {
        console.log(`[RSF Sync] Done — ${result.counts.journalEntries || 0} entries, ${result.counts.accounts || 0} balances`);
      } else {
        console.warn('[RSF Sync] Errors:', result.errors);
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.syncing = false;
    }
  }

  getStatus() {
    return {
      syncing: this.syncing,
      lastSync: this.lastSyncTime,
      isWindows: this.exporter.isWindows,
      rsfPath: this.exporter.rsfPath,
    };
  }
}

module.exports = { RsfExporter, RsfSyncManager };
