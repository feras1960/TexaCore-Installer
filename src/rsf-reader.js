/**
 * TexaCore RSF Reader — قارئ ملفات الرشيد (.rsf)
 * 
 * يقرأ ملفات Microsoft Access (MDB/JET 4.0) ويستخرج كل البيانات:
 * - شجرة الحسابات (Accounts)
 * - العملاء (Custmers) — نعم بهذا الإملاء في الرشيد
 * - الموردين (Suplyers)
 * - القيود المحاسبية (GENDAY + MoveDiffar)
 * - مراكز التكلفة (CostCenters)
 * - العملات (Currency)
 * - المواد (MAT)
 * - فواتير المبيعات (SaleBill + MoveSaleBill)
 * - فواتير المشتريات (BayBill + MoveBayBill)
 * - حركات المستودع (MOVE + MoveMats)
 * - التصنيع (ManuFact + ManuMakeFact)
 * - سندات القبض/الدفع (TakeMony + MoveTakemony)
 * - الإعدادات (Set)
 * - المستخدمين (Password)
 * 
 * @requires mdb-reader
 */

const fs = require('fs');
const path = require('path');

let MDBReader = null;

class RsfReader {
  /**
   * @param {string} filePath — المسار الكامل لملف .rsf
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.fileName = path.basename(filePath, '.rsf');
    this.db = null;
    this._cache = {};
  }

  // ═══════════════════════════════════════════════════════
  // فتح الملف
  // ═══════════════════════════════════════════════════════

  async open() {
    if (this.db) return this;

    // Load MDBReader dynamically (ESM module)
    if (!MDBReader) {
      try {
        const mod = await import('mdb-reader');
        MDBReader = mod.default || mod.MDBReader || mod;
      } catch (e) {
        throw new Error('mdb-reader not available: ' + e.message);
      }
    }

    const buffer = fs.readFileSync(this.filePath);
    
    // التحقق من أنه ملف Access — أول 4 بايت null ثم "Standard Jet DB"
    const header = buffer.slice(0, 20).toString('ascii');
    if (!header.includes('Standard Jet')) {
      throw new Error('الملف ليس ملف رشيد (.rsf) صالح');
    }

    this.db = new MDBReader(buffer);
    this.tableNames = this.db.getTableNames();

    // تصحيح الترميز: mdb-reader يفك كـ Windows-1252 لكن الرشيد يستخدم Windows-1256
    this._needsArabicFix = true;

    return this;
  }

  // ═══════════════════════════════════════════════════════
  // Windows-1256 (Arabic) decode table
  // ═══════════════════════════════════════════════════════

  static _cp1256Table = (() => {
    // CP1252 codepoints for bytes 0x80-0xFF (what mdb-reader wrongly decodes as)
    const cp1252 = [
      0x20AC,0x0081,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,0x0160,0x2039,0x0152,0x008D,0x017D,0x008F,
      0x0090,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,0x0161,0x203A,0x0153,0x009D,0x017E,0x0178,
      0x00A0,0x00A1,0x00A2,0x00A3,0x00A4,0x00A5,0x00A6,0x00A7,0x00A8,0x00A9,0x00AA,0x00AB,0x00AC,0x00AD,0x00AE,0x00AF,
      0x00B0,0x00B1,0x00B2,0x00B3,0x00B4,0x00B5,0x00B6,0x00B7,0x00B8,0x00B9,0x00BA,0x00BB,0x00BC,0x00BD,0x00BE,0x00BF,
      0x00C0,0x00C1,0x00C2,0x00C3,0x00C4,0x00C5,0x00C6,0x00C7,0x00C8,0x00C9,0x00CA,0x00CB,0x00CC,0x00CD,0x00CE,0x00CF,
      0x00D0,0x00D1,0x00D2,0x00D3,0x00D4,0x00D5,0x00D6,0x00D7,0x00D8,0x00D9,0x00DA,0x00DB,0x00DC,0x00DD,0x00DE,0x00DF,
      0x00E0,0x00E1,0x00E2,0x00E3,0x00E4,0x00E5,0x00E6,0x00E7,0x00E8,0x00E9,0x00EA,0x00EB,0x00EC,0x00ED,0x00EE,0x00EF,
      0x00F0,0x00F1,0x00F2,0x00F3,0x00F4,0x00F5,0x00F6,0x00F7,0x00F8,0x00F9,0x00FA,0x00FB,0x00FC,0x00FD,0x00FE,0x00FF,
    ];
    // CP1256 codepoints for bytes 0x80-0xFF (what the text SHOULD be)
    const cp1256 = [
      0x20AC,0x067E,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,0x0679,0x2039,0x0152,0x0686,0x0698,0x0688,
      0x06AF,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x06A9,0x2122,0x0691,0x203A,0x0153,0x200C,0x200D,0x06BA,
      0x00A0,0x060C,0x00A2,0x00A3,0x00A4,0x00A5,0x00A6,0x00A7,0x00A8,0x00A9,0x06BE,0x00AB,0x00AC,0x00AD,0x00AE,0x00AF,
      0x00B0,0x00B1,0x00B2,0x00B3,0x00B4,0x00B5,0x00B6,0x00B7,0x00B8,0x00B9,0x061B,0x00BB,0x00BC,0x00BD,0x00BE,0x061F,
      0x06C1,0x0621,0x0622,0x0623,0x0624,0x0625,0x0626,0x0627,0x0628,0x0629,0x062A,0x062B,0x062C,0x062D,0x062E,0x062F,
      0x0630,0x0631,0x0632,0x0633,0x0634,0x0635,0x0636,0x00D7,0x0637,0x0638,0x0639,0x063A,0x0640,0x0641,0x0642,0x0643,
      0x00E0,0x0644,0x00E2,0x0645,0x0646,0x0647,0x0648,0x00E7,0x00E8,0x00E9,0x00EA,0x00EB,0x0649,0x064A,0x00EE,0x00EF,
      0x064B,0x064C,0x064D,0x064E,0x00F4,0x064F,0x0650,0x00F7,0x0651,0x00F9,0x0652,0x00FB,0x00FC,0x200E,0x200F,0x06D2,
    ];
    // Build map: cp1252 unicode codepoint → cp1256 unicode codepoint
    const remap = {};
    for (let i = 0; i < 128; i++) {
      if (cp1252[i] !== cp1256[i]) {
        remap[cp1252[i]] = cp1256[i];
      }
    }
    return remap;
  })();

  /**
   * تحويل النص من Windows-1252 المفكوك خطأً → Windows-1256 العربي الصحيح
   */
  _fixArabic(str) {
    if (!str || typeof str !== 'string') return str;
    const table = RsfReader._cp1256Table;
    let result = '';
    let hasHighBytes = false;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code >= 0x80 && table[code] !== undefined) {
        result += String.fromCharCode(table[code]);
        hasHighBytes = true;
      } else {
        result += str[i];
      }
    }
    return hasHighBytes ? result : str;
  }

  /**
   * تصحيح كل النصوص في صف بيانات
   */
  _fixRow(row) {
    if (!this._needsArabicFix) return row;
    const fixed = {};
    for (const [key, val] of Object.entries(row)) {
      fixed[key] = typeof val === 'string' ? this._fixArabic(val) : val;
    }
    return fixed;
  }

  /**
   * قراءة جدول بأمان — يعيد مصفوفة فارغة إذا الجدول غير موجود
   */
  _readTable(name) {
    if (this._cache[name]) return this._cache[name];
    try {
      if (!this.tableNames.includes(name)) return [];
      const table = this.db.getTable(name);
      const data = table.getData().map(row => this._fixRow(row));
      this._cache[name] = data;
      return data;
    } catch (e) {
      console.warn(`[RSF] تحذير: تعذر قراءة جدول ${name}:`, e.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════
  // 1. معلومات الشركة
  // ═══════════════════════════════════════════════════════

  getCompanyInfo() {
    const settings = this.getSettings();
    const currencies = this.getCurrencies();
    const ver = this._readTable('Ver');

    // استخراج اسم الشركة من الإعدادات
    const companyName = settings['Company'] || settings['CompanyName'] || settings['CompName'] || this.fileName;
    const companyNameAr = settings['AHeader1'] || settings['CompanyNameAr'] || companyName;
    
    // مستويات الشجرة
    const accLevels = [
      parseInt(settings['AccLvl_0'] || '2'),
      parseInt(settings['AccLvl_1'] || '1'),
      parseInt(settings['AccLvl_2'] || '3'),
    ];

    // العملة المحلية
    const baseCurrency = currencies.find(c => c.num === 1);
    const mainCurrency = currencies.find(c => c.num === 2);

    return {
      name: companyName,
      nameAr: companyNameAr,
      fileName: this.fileName,
      filePath: this.filePath,
      accLevels,
      baseCurrencyName: baseCurrency?.name || 'العملة المحلية',
      mainCurrencyName: mainCurrency?.name || 'USD',
      mainCurrencyRate: mainCurrency?.rate || 1,
      version: ver.length > 0 ? ver[0] : null,
      tableCount: this.tableNames.length,
    };
  }

  // ═══════════════════════════════════════════════════════
  // 2. الإعدادات
  // ═══════════════════════════════════════════════════════

  getSettings() {
    if (this._settingsParsed) return this._settingsParsed;
    const rows = this._readTable('Set');
    const settings = {};
    for (const row of rows) {
      // جدول Set: عمودين (SettingName, SettingValue) أو (SetItem, SetKey)
      const key = row.SetItem || row.SettingName || row.Name || Object.values(row)[0];
      const value = row.SetKey || row.SettingValue || row.Value || Object.values(row)[1];
      if (key) settings[String(key).trim()] = value;
    }
    this._settingsParsed = settings;
    return settings;
  }

  // ═══════════════════════════════════════════════════════
  // 3. شجرة الحسابات
  // ═══════════════════════════════════════════════════════

  getAccounts() {
    const rows = this._readTable('Accounts');
    return rows.map(row => ({
      num2: row.Num2,                    // رقم تسلسلي
      code: String(row.Num || '').trim(), // رمز الحساب (مفتاح أساسي)
      ref: String(row.Ref || '').trim(),  // رمز الحساب الأب
      name: String(row.NAME || row.Name || '').trim(),
      nameAr: String(row.Name2 || row.NAME || '').trim(),
      credit: parseFloat(row.Credit) || 0,
      debit: parseFloat(row.Debt || row.Debit) || 0,
      isSub: row.IS_SUB === 1 || row.IS_SUB === true, // هل مجموعة فرعية
      currencyNum: parseInt(row.Currency) || 0,
      // حقول إضافية
      mianCredit: parseFloat(row.MianCredit) || 0,
      mianDebt: parseFloat(row.MianDebt) || 0,
      date: row.Date || null,
    }));
  }

  /**
   * تصنيف الحساب تلقائياً حسب أول رقمين
   */
  static classifyAccount(code) {
    if (!code || code.length < 2) return null;
    const prefix = parseInt(code.substring(0, 2));

    if (prefix >= 11 && prefix <= 19) {
      // أصول — تفصيل إضافي
      if (prefix === 11) return { type: 'FIXED_ASSET', classification: 'assets', normalBalance: 'debit' };
      if (prefix === 12) return { type: 'FIXED_ASSET', classification: 'assets', normalBalance: 'debit' };
      if (prefix === 13) return { type: 'CURRENT_ASSET', classification: 'assets', normalBalance: 'debit' }; // مخزون
      if (prefix >= 15 && prefix <= 17) return { type: 'CURRENT_ASSET', classification: 'assets', normalBalance: 'debit' }; // مدينون
      if (prefix === 18) return { type: 'CURRENT_ASSET', classification: 'assets', normalBalance: 'debit' }; // أموال جاهزة
      return { type: 'ASSET', classification: 'assets', normalBalance: 'debit' };
    }
    if (prefix >= 21 && prefix <= 22) return { type: 'EQUITY', classification: 'equity', normalBalance: 'credit' };
    if (prefix === 23) return { type: 'FIXED_ASSET', classification: 'assets', normalBalance: 'credit' }; // إهتلاكات
    if (prefix >= 25 && prefix <= 29) return { type: 'CURRENT_LIABILITY', classification: 'liabilities', normalBalance: 'credit' };
    if (prefix >= 31 && prefix <= 39) return { type: 'EXPENSE', classification: 'expenses', normalBalance: 'debit' };
    if (prefix === 34 || prefix === 37) return { type: 'COGS', classification: 'expenses', normalBalance: 'debit' };
    if (prefix >= 41 && prefix <= 49) return { type: 'REVENUE', classification: 'income', normalBalance: 'credit' };

    return null; // رؤوس وهمية (00, 01, 02, 03)
  }

  /**
   * تحديد الأعلام التلقائية للحساب
   */
  static getAccountFlags(code, isSub) {
    const flags = {
      is_cash_account: false,
      is_bank_account: false,
      is_receivable: false,
      is_payable: false,
      is_group: isSub, // IS_SUB=1 يعني مجموعة فرعية
      is_detail: !isSub,
    };

    const c = String(code);

    // الصندوق
    if (c === '181' || c.startsWith('181')) flags.is_cash_account = true;
    // المصرف / البنوك
    if (c === '182' || c.startsWith('182')) flags.is_bank_account = true;
    // العملاء / الزبائن
    if (c === '161' || c.startsWith('161')) flags.is_receivable = true;
    // الموردين
    if (c === '261' || c.startsWith('261')) flags.is_payable = true;

    return flags;
  }

  // ═══════════════════════════════════════════════════════
  // 4. العملاء
  // ═══════════════════════════════════════════════════════

  getCustomers() {
    const rows = this._readTable('Custmers');
    return rows.map(row => ({
      code: String(row.Num || row.Code || '').trim(),
      name: String(row.Name || row.NAME || '').trim(),
      nameAr: String(row.Name2 || row.Name || '').trim(),
      phone: String(row.Phone || row.Tel || '').trim(),
      mobile: String(row.Mobile || row.Mob || '').trim(),
      email: String(row.Email || '').trim(),
      address: String(row.Address || row.Addr || '').trim(),
      city: String(row.City || '').trim(),
      country: String(row.Country || '').trim(),
      taxNumber: String(row.TaxNum || '').trim(),
      accountCode: String(row.AccNum || row.AccNbr || '').trim(), // رمز الحساب المحاسبي
      creditLimit: parseFloat(row.CreditLimit || row.Limit) || 0,
      notes: String(row.Notes || row.Note || '').trim(),
      balance: parseFloat(row.Balance || row.Bal) || 0,
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 5. الموردين
  // ═══════════════════════════════════════════════════════

  getSuppliers() {
    const rows = this._readTable('Suplyers');
    return rows.map(row => ({
      code: String(row.Num || row.Code || '').trim(),
      name: String(row.Name || row.NAME || '').trim(),
      nameAr: String(row.Name2 || row.Name || '').trim(),
      phone: String(row.Phone || row.Tel || '').trim(),
      mobile: String(row.Mobile || row.Mob || '').trim(),
      email: String(row.Email || '').trim(),
      address: String(row.Address || row.Addr || '').trim(),
      city: String(row.City || '').trim(),
      country: String(row.Country || '').trim(),
      taxNumber: String(row.TaxNum || '').trim(),
      accountCode: String(row.AccNum || row.AccNbr || '').trim(),
      notes: String(row.Notes || row.Note || '').trim(),
      balance: parseFloat(row.Balance || row.Bal) || 0,
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 6. القيود المحاسبية
  // ═══════════════════════════════════════════════════════

  getJournalHeaders() {
    const rows = this._readTable('GENDAY');
    return rows.map(row => ({
      nrs: parseInt(row.NRS || row.Nrs || row.Num) || 0, // رقم القيد
      date: row.Date || row.DATE || null,
      type: parseInt(row.Type) || 0,
      notes: String(row.Notes || row.Note || row.Document || '').trim(),
      totalDebit: parseFloat(row.TotalDebt || row.TotalDebit) || 0,
      totalCredit: parseFloat(row.TotalCredit) || 0,
      userId: parseInt(row.UserID || row.UserId) || 0,
      isPosted: row.Posted === 1 || row.Posted === true || true, // نعتبرها مرحّلة
    }));
  }

  getJournalLines() {
    const rows = this._readTable('MoveDiffar');
    return rows.map(row => ({
      nrs: parseInt(row.Num || row.NBRREC || row.NRS) || 0, // رقم القيد (FK → GENDAY.NRS)
      lineOrder: parseInt(row.Order || row.LineNum) || 0,
      accountCode: String(row.Accnbr || row.AccNum || '').trim(),
      debit: parseFloat(row.Total) || 0,   // في الرشيد: Total = مدين (بالعملة الأصلية)
      credit: parseFloat(row.Total1) || 0, // Total1 = دائن (بالعملة الأصلية)
      description: String(row.Document || row.Desc || '').trim(),
      date: row.Date || null,
      costCenterCode: String(row.CostCenter || '').trim(),
      currencyNum: parseInt(row.Currency) || 0,
      localAmount: parseFloat(row.LocalTot) || 0,    // المبلغ بالعملة المحلية
      foreignAmount: parseFloat(row.MianTot) || 0,   // المبلغ بالعملة الأجنبية (= Total)
      isCash: row.IsCash === true || row.IsCash === 1,
      docNumber: String(row.DocumNo || '').trim(),
      detailDesc: String(row.Description || '').trim(),
    }));
  }

  /**
   * دمج رؤوس القيود مع السطور
   */
  getJournalEntries() {
    const headers = this.getJournalHeaders();
    const lines = this.getJournalLines();

    // تجميع السطور حسب رقم القيد
    const linesByNrs = {};
    for (const line of lines) {
      if (!linesByNrs[line.nrs]) linesByNrs[line.nrs] = [];
      linesByNrs[line.nrs].push(line);
    }

    return headers.map(h => ({
      ...h,
      lines: (linesByNrs[h.nrs] || []).sort((a, b) => a.lineOrder - b.lineOrder),
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 7. مراكز التكلفة
  // ═══════════════════════════════════════════════════════

  getCostCenters() {
    const rows = this._readTable('CostCenters');
    return rows.map(row => ({
      code: String(row.Num || row.Code || '').trim(),
      name: String(row.Name || row.NAME || '').trim(),
      nameAr: String(row.Name2 || row.Name || '').trim(),
      type: parseInt(row.Type) || 0, // 0 = رئيسي (group), 1 = فرعي
      ref: String(row.Ref || '').trim(), // الأب
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 8. العملات
  // ═══════════════════════════════════════════════════════

  getCurrencies() {
    const rows = this._readTable('Currency');
    return rows.map(row => ({
      num: parseInt(row.Num || row.Code) || 0,
      name: String(row.Name || row.NAME || '').trim(),
      nameAr: String(row.Name2 || row.Name || '').trim(),
      rate: parseFloat(row.Price || row.Rate || row.ExRate) || 1,
      symbol: String(row.Symbol || row.Sym || '').trim(),
      isActive: row.Active !== 0 && row.Active !== false,
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 9. المواد
  // ═══════════════════════════════════════════════════════

  getMaterials() {
    const rows = this._readTable('MAT');
    return rows.map(row => ({
      code: String(row.Num || row.Code || '').trim(),
      name: String(row.Name || row.NAME || '').trim(),
      nameAr: String(row.Name2 || row.Name || '').trim(),
      unit: String(row.Unit || '').trim(),
      buyPrice: parseFloat(row.BayPrice || row.BuyPrice) || 0,
      sellPrice: parseFloat(row.LastPrice || row.SellPrice) || 0,
      minPrice: parseFloat(row.MinPrice) || 0,
      balance: parseFloat(row.Balance || row.Bal) || 0,
      isSub: row.IsSub === 1 || row.IsSub === true, // مجموعة
      ref: String(row.Ref || '').trim(),
      barcode: String(row.Barcode || '').trim(),
      notes: String(row.Notes || '').trim(),
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 10. فواتير المبيعات
  // ═══════════════════════════════════════════════════════

  getSalesInvoices() {
    const saleBillHeaders = this._readTable('SaleBill');
    const moveSaleBill = this._readTable('MoveSaleBill');
    
    // ── البنية 1: SaleBill (headers) + MoveSaleBill (lines) ──
    if (saleBillHeaders.length > 0) {
      const linesByBill = {};
      for (const line of moveSaleBill) {
        const key = line.BillNum || line.Num || 0;
        if (!linesByBill[key]) linesByBill[key] = [];
        linesByBill[key].push(line);
      }
      return saleBillHeaders.map(h => ({
        number: h.Num || h.BillNum,
        date: h.Date,
        customerCode: String(h.CustNum || h.CustomerNum || '').trim(),
        total: parseFloat(h.Total) || 0,
        discount: parseFloat(h.Discount) || 0,
        tax: parseFloat(h.Tax) || 0,
        netTotal: parseFloat(h.NetTotal || h.Total) || 0,
        notes: String(h.Notes || '').trim(),
        lines: linesByBill[h.Num || h.BillNum] || [],
        _raw: h,
      }));
    }

    // ── البنية 2: MoveSaleBill (headers) + MOVE (lines SWAY='O' مرتبطة بـ SERNRO) ──
    if (moveSaleBill.length > 0) {
      const moveRows = this._readTable('MOVE');
      // فقط الحركات الصادرة (بيع)
      const salesMoves = moveRows.filter(m => m.SWAY === 'O' || m.SWay === 'O');
      
      const linesByInvoice = {};
      for (const m of salesMoves) {
        const invNum = m.SERNRO || m.Claim || 0;
        if (!linesByInvoice[invNum]) linesByInvoice[invNum] = [];
        linesByInvoice[invNum].push({
          MatNum: m['SACC-NR'] || m.MatNum || '',
          Qty: m.SQUANT || m.Qty || 0,
          Price: m.SPRICE || m.Price || 0,
          UnitPrice: m.SPRICE || m.Price || 0,
          Total: (parseFloat(m.SQUANT) || 0) * (parseFloat(m.SPRICE) || 0),
          Discount: parseFloat(m.Dis) || 0,
          Name: m.FreeName || '',
          Order: m.Order || 0,
          Notes: m.SREM || '',
        });
      }

      return moveSaleBill.map(h => {
        const invNum = h.Num || 0;
        const customerAccCode = String(h.Debt || h.Credit || '').trim();
        return {
          number: invNum,
          date: h.Date,
          customerCode: customerAccCode,
          total: parseFloat(h.Total) || 0,
          discount: 0,
          tax: parseFloat(h.Tax) || 0,
          netTotal: parseFloat(h.Total) || 0,
          notes: String(h.Notes || h.Document || '').trim(),
          lines: (linesByInvoice[invNum] || []).sort((a, b) => a.Order - b.Order),
          _raw: h,
        };
      });
    }

    return [];
  }

  // ═══════════════════════════════════════════════════════
  // 11. فواتير المشتريات
  // ═══════════════════════════════════════════════════════

  getPurchaseInvoices() {
    const bayBillHeaders = this._readTable('BayBill');
    const moveBayBill = this._readTable('MoveBayBill');

    // ── البنية 1: BayBill (headers) + MoveBayBill (lines) ──
    if (bayBillHeaders.length > 0) {
      const linesByBill = {};
      for (const line of moveBayBill) {
        const key = line.BillNum || line.Num || 0;
        if (!linesByBill[key]) linesByBill[key] = [];
        linesByBill[key].push(line);
      }
      return bayBillHeaders.map(h => ({
        number: h.Num || h.BillNum,
        date: h.Date,
        supplierCode: String(h.SupNum || h.SupplierNum || '').trim(),
        total: parseFloat(h.Total) || 0,
        discount: parseFloat(h.Discount) || 0,
        tax: parseFloat(h.Tax) || 0,
        netTotal: parseFloat(h.NetTotal || h.Total) || 0,
        notes: String(h.Notes || '').trim(),
        lines: linesByBill[h.Num || h.BillNum] || [],
        _raw: h,
      }));
    }

    // ── البنية 2: MoveBayBill (headers) + MOVE (lines مرتبطة بـ SERNRI) ──
    if (moveBayBill.length > 0) {
      const moveRows = this._readTable('MOVE');
      // فقط الحركات الواردة (شراء)
      const purchaseMoves = moveRows.filter(m => m.SWAY === 'I' || m.SWay === 'I');
      
      // تجميع سطور المواد حسب رقم الفاتورة (SERNRI)
      const linesByInvoice = {};
      for (const m of purchaseMoves) {
        const invNum = m.SERNRI || m.Claim || 0;
        if (!linesByInvoice[invNum]) linesByInvoice[invNum] = [];
        linesByInvoice[invNum].push({
          MatNum: m['SACC-NR'] || m.MatNum || '',
          Qty: m.SQUANT || m.Qty || 0,
          Price: m.SPRICE || m.Price || 0,
          UnitPrice: m.SPRICE || m.Price || 0,
          Total: (parseFloat(m.SQUANT) || 0) * (parseFloat(m.SPRICE) || 0),
          Discount: parseFloat(m.Dis) || 0,
          Name: m.FreeName || '',
          Order: m.Order || 0,
          StockNum: m.StockNum || 1,
          Currency: m.Currency || 1,
          Notes: m.SREM || '',
        });
      }

      return moveBayBill.map(h => {
        const invNum = h.Num || 0;
        const supplierAccCode = String(h.Credit || h.Claim || '').trim();
        return {
          number: invNum,
          date: h.Date,
          supplierCode: supplierAccCode,
          total: parseFloat(h.Total) || 0,
          discount: 0,
          tax: parseFloat(h.Tax) || 0,
          netTotal: parseFloat(h.Total) || 0,
          notes: String(h.Notes || h.Document || '').trim(),
          lines: (linesByInvoice[invNum] || []).sort((a, b) => a.Order - b.Order),
          _raw: h,
        };
      });
    }

    return [];
  }

  // ═══════════════════════════════════════════════════════
  // 12. حركات المستودع
  // ═══════════════════════════════════════════════════════

  getInventoryMoves() {
    const moves = this._readTable('MOVE');
    const details = this._readTable('MoveMats');

    if (moves.length === 0) return [];

    const detailsByMove = {};
    for (const d of details) {
      const key = d.Num || d.MoveNum || 0;
      if (!detailsByMove[key]) detailsByMove[key] = [];
      detailsByMove[key].push(d);
    }

    return moves.map(m => ({
      number: m.Num,
      date: m.Date,
      type: m.Type, // نوع الحركة
      notes: String(m.Notes || '').trim(),
      details: detailsByMove[m.Num] || [],
      _raw: m,
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 13. التصنيع
  // ═══════════════════════════════════════════════════════

  getManufacturing() {
    const orders = this._readTable('ManuFact');
    const makeDetails = this._readTable('ManuMakeFact');

    if (orders.length === 0) return [];

    return orders.map(o => ({
      ...o,
      details: makeDetails.filter(d => d.Num === o.Num || d.FactNum === o.Num),
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 14. سندات القبض والدفع
  // ═══════════════════════════════════════════════════════

  getReceipts() {
    const headers = this._readTable('TakeMony');
    const lines = this._readTable('MoveTakemony');

    if (headers.length === 0) return [];

    const linesByReceipt = {};
    for (const l of lines) {
      const key = l.Num || l.TakeNum || 0;
      if (!linesByReceipt[key]) linesByReceipt[key] = [];
      linesByReceipt[key].push(l);
    }

    return headers.map(h => ({
      number: h.Num,
      date: h.Date,
      type: h.Type, // قبض أو دفع
      amount: parseFloat(h.Total) || 0,
      accountCode: String(h.AccNum || '').trim(),
      notes: String(h.Notes || '').trim(),
      lines: linesByReceipt[h.Num] || [],
      _raw: h,
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 15. المستخدمين
  // ═══════════════════════════════════════════════════════

  getUsers() {
    const rows = this._readTable('Password');
    return rows.map(row => ({
      name: String(row.Name || row.UserName || '').trim(),
      level: parseInt(row.Level || row.UserLevel) || 0,
      permissions: parseInt(row.Permision || row.Permission) || 0,
      // كلمة المرور مشفرة بخوارزمية خاصة — لا تُنقل
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 16. ملخص شامل
  // ═══════════════════════════════════════════════════════

  getSummary() {
    const accounts = this.getAccounts();
    const customers = this.getCustomers();
    const suppliers = this.getSuppliers();
    const journalHeaders = this.getJournalHeaders();
    const journalLines = this.getJournalLines();
    const costCenters = this.getCostCenters();
    const currencies = this.getCurrencies();
    const materials = this.getMaterials();
    const salesInvoices = this.getSalesInvoices();
    const purchaseInvoices = this.getPurchaseInvoices();
    const inventoryMoves = this.getInventoryMoves();
    const manufacturing = this.getManufacturing();
    const receipts = this.getReceipts();
    const users = this.getUsers();
    const companyInfo = this.getCompanyInfo();

    // حساب الأرصدة
    const totalDebit = journalLines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = journalLines.reduce((sum, l) => sum + l.credit, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    // عدد الحسابات حسب المستوى
    const accountsByLevel = {};
    for (const acc of accounts) {
      const len = acc.code.length;
      accountsByLevel[len] = (accountsByLevel[len] || 0) + 1;
    }

    // عدد حسابات العملاء والموردين
    const customerAccounts = accounts.filter(a => a.code.startsWith('161') && a.code.length > 3);
    const supplierAccounts = accounts.filter(a => a.code.startsWith('261') && a.code.length > 3);

    return {
      company: companyInfo,
      counts: {
        accounts: accounts.length,
        customers: customers.length,
        customerAccounts: customerAccounts.length,
        suppliers: suppliers.length,
        supplierAccounts: supplierAccounts.length,
        journalEntries: journalHeaders.length,
        journalLines: journalLines.length,
        costCenters: costCenters.length,
        currencies: currencies.length,
        materials: materials.length,
        salesInvoices: salesInvoices.length,
        purchaseInvoices: purchaseInvoices.length,
        inventoryMoves: inventoryMoves.length,
        manufacturingOrders: manufacturing.length,
        receipts: receipts.length,
        users: users.length,
      },
      accountsByLevel,
      balance: {
        totalDebit,
        totalCredit,
        difference: Math.abs(totalDebit - totalCredit),
        isBalanced,
      },
      hasData: {
        accounting: journalHeaders.length > 0,
        sales: salesInvoices.length > 0,
        purchases: purchaseInvoices.length > 0,
        inventory: inventoryMoves.length > 0,
        manufacturing: manufacturing.length > 0,
        receipts: receipts.length > 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════
  // 17. إغلاق
  // ═══════════════════════════════════════════════════════

  close() {
    this.db = null;
    this._cache = {};
    this._settingsParsed = null;
  }
}

/**
 * كشف نوع الملف من أول 16 بايت
 * @param {string} filePath
 * @returns {'rsf'|'tcdb'|'unknown'}
 */
function detectFileType(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(20);
    fs.readSync(fd, buf, 0, 20, 0);
    fs.closeSync(fd);

    const header = buf.toString('ascii', 0, 20);
    if (header.includes('Standard Jet')) return 'rsf';
    if (header.includes('TCDB')) return 'tcdb';
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

module.exports = { RsfReader, detectFileType };
