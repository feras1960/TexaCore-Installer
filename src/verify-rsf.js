/**
 * TexaCore RSF Verification Script
 * يقرأ ملف الرشيد ويتحقق من كل البيانات وتطابقها مع حقول TexaCore
 */
const { RsfReader } = require('./rsf-reader');
const path = require('path');

const RSF_FILE = process.argv[2] || path.join(__dirname, '..', '..', 'temp', '2023 مطور بعد الصيانة.rsf');

const OK = '✅', WARN = '⚠️', FAIL = '❌', INFO = 'ℹ️';
let totalIssues = 0, totalWarnings = 0;

function check(label, condition, detail = '') {
  if (condition) { console.log(`  ${OK} ${label}${detail ? ' — ' + detail : ''}`); }
  else { console.log(`  ${FAIL} ${label}${detail ? ' — ' + detail : ''}`); totalIssues++; }
}
function warn(label, detail = '') { console.log(`  ${WARN} ${label}${detail ? ' — ' + detail : ''}`); totalWarnings++; }
function info(label, detail = '') { console.log(`  ${INFO} ${label}${detail ? ' — ' + detail : ''}`); }

function section(title) { console.log(`\n${'═'.repeat(60)}\n  ${title}\n${'═'.repeat(60)}`); }

// Field coverage check
function checkFields(label, items, requiredFields) {
  if (!items || items.length === 0) { warn(`${label}: لا توجد بيانات`); return; }
  const sample = items[0];
  const missing = [], empty = [], present = [];
  for (const f of requiredFields) {
    if (!(f in sample)) { missing.push(f); }
    else {
      const nonEmpty = items.filter(i => {
        const v = i[f];
        return v !== null && v !== undefined && v !== '' && v !== 0;
      }).length;
      if (nonEmpty === 0) empty.push(f);
      else present.push(`${f}(${nonEmpty}/${items.length})`);
    }
  }
  if (missing.length) warn(`${label} — حقول مفقودة من الكود: ${missing.join(', ')}`);
  if (empty.length) info(`${label} — حقول فارغة بالكامل: ${empty.join(', ')}`);
  check(`${label} — حقول متوفرة: ${present.length}/${requiredFields.length}`, missing.length === 0);
}

async function main() {
  console.log(`\n🔍 TexaCore RSF Verification\n   File: ${RSF_FILE}\n`);

  const reader = new RsfReader(RSF_FILE);
  await reader.open();

  // ════════════════ 1. الجداول المتاحة ════════════════
  section('1. جداول ملف الرشيد المتاحة');
  const tables = reader.tableNames;
  console.log(`   عدد الجداول: ${tables.length}`);
  const expected = ['Accounts','Custmers','Suplyers','GENDAY','MoveDiffar','CostCenters',
    'Currency','MAT','SaleBill','MoveSaleBill','BayBill','MoveBayBill',
    'MOVE','MoveMats','ManuFact','ManuMakeFact','TakeMony','MoveTakemony',
    'Password','Set','EndBal','Ver'];
  for (const t of expected) {
    const exists = tables.includes(t);
    const rows = exists ? reader._readTable(t).length : 0;
    if (exists) info(`${t}: ${rows} سجل`);
    else warn(`${t}: غير موجود في الملف`);
  }
  const extra = tables.filter(t => !expected.includes(t) && !t.startsWith('MSys'));
  if (extra.length) info(`جداول إضافية: ${extra.join(', ')}`);

  // ════════════════ 2. الإعدادات ════════════════
  section('2. الإعدادات (Set)');
  const settings = reader.getSettings();
  const settingsCount = Object.keys(settings).length;
  check(`إعدادات محمّلة: ${settingsCount}`, settingsCount > 0);
  const companyInfo = reader.getCompanyInfo();
  info(`اسم الشركة: ${companyInfo.nameAr || companyInfo.name}`);
  info(`مستويات الشجرة: ${companyInfo.accLevels.join('-')}`);
  info(`العملة المحلية: ${companyInfo.baseCurrencyName}`);
  info(`العملة الأجنبية: ${companyInfo.mainCurrencyName} (سعر: ${companyInfo.mainCurrencyRate})`);
  const whNames = reader.getWarehouseNames();
  info(`المستودعات من الإعدادات: ${JSON.stringify(whNames)}`);

  // ════════════════ 3. العملات ════════════════
  section('3. العملات (Currency)');
  const currencies = reader.getCurrencies();
  check(`عدد العملات: ${currencies.length}`, currencies.length > 0);
  checkFields('Currency', currencies, ['num','name','nameAr','rate','symbol']);
  for (const c of currencies) info(`  [${c.num}] ${c.name} / ${c.nameAr} — سعر: ${c.rate}`);

  // ════════════════ 4. شجرة الحسابات ════════════════
  section('4. شجرة الحسابات (Accounts)');
  const accounts = reader.getAccounts();
  check(`عدد الحسابات: ${accounts.length}`, accounts.length > 0);
  checkFields('Accounts', accounts, ['code','name','nameAr','ref','isSub','credit','debit','currencyNum']);
  
  // تحليل مستويات الشجرة
  const byLen = {};
  for (const a of accounts) { const l = a.code.length; byLen[l] = (byLen[l]||0)+1; }
  info(`توزيع المستويات: ${Object.entries(byLen).map(([k,v])=>`طول ${k}: ${v}`).join(' | ')}`);
  
  // تصنيف
  const classified = accounts.filter(a => RsfReader.classifyAccount(a.code));
  const unclassified = accounts.filter(a => !RsfReader.classifyAccount(a.code));
  check(`حسابات مصنّفة: ${classified.length}/${accounts.length}`, classified.length > 0);
  if (unclassified.length) info(`حسابات غير مصنّفة (رؤوس وهمية): ${unclassified.map(a=>a.code).join(', ')}`);
  
  // فحص الأبناء بلا آباء
  const allCodes = new Set(accounts.map(a=>a.code));
  let orphans = 0;
  for (const a of accounts) {
    if (a.ref && a.ref !== '0' && a.ref !== '' && !allCodes.has(a.ref)) {
      // محاولة البحث بـ prefix
      let found = false;
      for (let l = a.code.length-1; l >= 1; l--) {
        if (allCodes.has(a.code.substring(0,l))) { found = true; break; }
      }
      if (!found) orphans++;
    }
  }
  check(`حسابات يتيمة (بدون أب): ${orphans}`, orphans === 0, orphans > 0 ? 'سيتم إنشاء رؤوس تلقائية' : '');

  // ════════════════ 5. العملاء ════════════════
  section('5. العملاء (Custmers)');
  const customers = reader.getCustomers();
  check(`عدد العملاء: ${customers.length}`, customers.length >= 0);
  if (customers.length > 0) {
    checkFields('Custmers', customers, ['code','name','nameAr','phone','mobile','email','address','accountCode','balance']);
    const withAccCode = customers.filter(c => c.accountCode);
    info(`عملاء مع رمز حساب محاسبي: ${withAccCode.length}/${customers.length}`);
    const custAccounts = accounts.filter(a => a.code.startsWith('161') && a.code.length > 3);
    info(`حسابات عملاء في الشجرة (161xxx): ${custAccounts.length}`);
    if (custAccounts.length !== customers.length) {
      warn(`فرق بين عدد العملاء وحسابات 161: ${Math.abs(custAccounts.length - customers.length)}`);
    }
  }

  // ════════════════ 6. الموردين ════════════════
  section('6. الموردين (Suplyers)');
  const suppliers = reader.getSuppliers();
  check(`عدد الموردين: ${suppliers.length}`, suppliers.length >= 0);
  if (suppliers.length > 0) {
    checkFields('Suplyers', suppliers, ['code','name','nameAr','phone','mobile','email','address','accountCode','balance']);
    const supAccounts = accounts.filter(a => a.code.startsWith('261') && a.code.length > 3);
    info(`حسابات موردين في الشجرة (261xxx): ${supAccounts.length}`);
  }

  // ════════════════ 7. مراكز التكلفة ════════════════
  section('7. مراكز التكلفة (CostCenters)');
  const costCenters = reader.getCostCenters();
  check(`عدد مراكز التكلفة: ${costCenters.length}`, true);
  if (costCenters.length > 0) {
    checkFields('CostCenters', costCenters, ['code','name','nameAr','type','ref']);
    const groups = costCenters.filter(c => c.type === 0);
    const details = costCenters.filter(c => c.type !== 0);
    info(`مجموعات: ${groups.length}, فرعية: ${details.length}`);
  }

  // ════════════════ 8. المواد ════════════════
  section('8. المواد (MAT)');
  const materials = reader.getMaterials();
  check(`عدد المواد: ${materials.length}`, materials.length > 0);
  if (materials.length > 0) {
    checkFields('MAT', materials, ['code','name','nameAr','unit','buyPrice','sellPrice','balance','isSub','ref','barcode']);
    
    // تحليل المجموعات vs المواد
    const matCodes = materials.map(m=>m.code).filter(c=>c.length>0);
    const parentPrefixes = new Set();
    for (const code of matCodes) {
      for (const other of matCodes) {
        if (other.length > code.length && other.startsWith(code)) { parentPrefixes.add(code); break; }
      }
    }
    const groupLens = new Set([...parentPrefixes].map(p=>p.length));
    const isGroup = c => parentPrefixes.has(c) || (groupLens.has(c.length) && matCodes.some(o=>o.length>c.length));
    const groupCount = materials.filter(m => isGroup(m.code)).length;
    const itemCount = materials.length - groupCount;
    info(`مجموعات (auto-detected): ${groupCount}, مواد فعلية: ${itemCount}`);
    
    // وحدات القياس
    const units = {};
    for (const m of materials) { const u = (m.unit||'').trim(); if(u) units[u] = (units[u]||0)+1; }
    info(`وحدات القياس: ${Object.entries(units).map(([k,v])=>`${k}(${v})`).join(', ')}`);
    
    // أرصدة المستودعات
    const withWhBal = materials.filter(m => m.warehouseBalances && Object.keys(m.warehouseBalances).length > 0);
    info(`مواد مع أرصدة مستودعات مفصّلة: ${withWhBal.length}`);
    const whNums = new Set();
    for (const m of withWhBal) for (const n of Object.keys(m.warehouseBalances)) whNums.add(n);
    info(`مستودعات مستخدمة في أرصدة المواد: ${[...whNums].sort().join(', ')}`);
  }

  // ════════════════ 9. القيود المحاسبية ════════════════
  section('9. القيود المحاسبية (GENDAY + MoveDiffar)');
  const journalHeaders = reader.getJournalHeaders();
  const journalLines = reader.getJournalLines();
  check(`رؤوس القيود: ${journalHeaders.length}`, journalHeaders.length > 0);
  check(`سطور القيود: ${journalLines.length}`, journalLines.length > 0);
  
  if (journalHeaders.length > 0) {
    checkFields('GENDAY', journalHeaders, ['nrs','date','type','notes','totalDebit','totalCredit']);
  }
  if (journalLines.length > 0) {
    checkFields('MoveDiffar', journalLines, ['nrs','accountCode','debit','credit','description','currencyNum','localAmount','foreignAmount','costCenterCode']);
  }
  
  // التوازن
  const totalDebit = journalLines.reduce((s,l) => s + (l.localAmount || l.debit), 0);
  const totalCredit = journalLines.reduce((s,l) => s + (l.localAmount || l.credit), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  check(`ميزان القيود متوازن (فرق: ${diff.toFixed(2)})`, diff < 1);
  info(`إجمالي مدين: ${totalDebit.toFixed(2)} | إجمالي دائن: ${totalCredit.toFixed(2)}`);
  
  // أكواد حسابات مستخدمة في القيود لكنها غير موجودة في شجرة الحسابات
  const accCodes = new Set(accounts.map(a=>a.code));
  const missingAccInJE = new Set();
  for (const l of journalLines) {
    if (l.accountCode && !accCodes.has(l.accountCode)) missingAccInJE.add(l.accountCode);
  }
  check(`حسابات مفقودة في القيود: ${missingAccInJE.size}`, missingAccInJE.size === 0, 
    missingAccInJE.size > 0 ? [...missingAccInJE].slice(0,10).join(', ') : '');

  // ════════════════ 10. فواتير المبيعات ════════════════
  section('10. فواتير المبيعات');
  const salesInvs = reader.getSalesInvoices();
  check(`عدد فواتير المبيعات: ${salesInvs.length}`, true);
  if (salesInvs.length > 0) {
    checkFields('SalesInvoices', salesInvs, ['number','date','customerCode','total','lines']);
    const withLines = salesInvs.filter(i => i.lines && i.lines.length > 0);
    const totalLines = salesInvs.reduce((s,i) => s + (i.lines?.length || 0), 0);
    info(`فواتير مع بنود: ${withLines.length}/${salesInvs.length} | إجمالي بنود: ${totalLines}`);
    
    // تحقق من _raw fields
    const rawSample = salesInvs[0]._raw || {};
    const rawKeys = Object.keys(rawSample);
    info(`حقول _raw متاحة: ${rawKeys.slice(0,15).join(', ')}${rawKeys.length > 15 ? '...' : ''}`);
    
    const withDebtCredit = salesInvs.filter(i => (i._raw?.Debt || i._raw?.Credit));
    info(`فواتير مع Debt/Credit (للقيود): ${withDebtCredit.length}/${salesInvs.length}`);
    
    const totalSales = salesInvs.reduce((s,i) => s + (i.netTotal || i.total || 0), 0);
    info(`إجمالي المبيعات: ${totalSales.toFixed(2)}`);
  }

  // ════════════════ 11. فواتير المشتريات ════════════════
  section('11. فواتير المشتريات');
  const purchInvs = reader.getPurchaseInvoices();
  check(`عدد فواتير المشتريات: ${purchInvs.length}`, true);
  if (purchInvs.length > 0) {
    checkFields('PurchaseInvoices', purchInvs, ['number','date','supplierCode','total','lines']);
    const withLines = purchInvs.filter(i => i.lines && i.lines.length > 0);
    const totalLines = purchInvs.reduce((s,i) => s + (i.lines?.length || 0), 0);
    info(`فواتير مع بنود: ${withLines.length}/${purchInvs.length} | إجمالي بنود: ${totalLines}`);
    
    const rawSample = purchInvs[0]._raw || {};
    const rawKeys = Object.keys(rawSample);
    info(`حقول _raw متاحة: ${rawKeys.slice(0,15).join(', ')}${rawKeys.length > 15 ? '...' : ''}`);
    
    const withDebtCredit = purchInvs.filter(i => (i._raw?.Debt || i._raw?.Credit));
    info(`فواتير مع Debt/Credit (للقيود): ${withDebtCredit.length}/${purchInvs.length}`);
    
    const totalPurch = purchInvs.reduce((s,i) => s + (i.netTotal || i.total || 0), 0);
    info(`إجمالي المشتريات: ${totalPurch.toFixed(2)}`);
  }

  // ════════════════ 12. حركات المستودع ════════════════
  section('12. حركات المستودع (MOVE)');
  const invMoves = reader.getInventoryMoves();
  check(`عدد حركات المخزون: ${invMoves.length}`, true);
  if (invMoves.length > 0) {
    // تصنيف الحركات
    const byType = { 'O(بيع)':0, 'I(شراء)':0, 'مناقلة':0, 'أخرى':0 };
    for (const m of invMoves) {
      const raw = m._raw || {};
      const sway = String(raw.SWAY || raw.SWay || '').trim();
      const toStore = String(raw.ToStore || raw.ToMakhzan || '').trim();
      const fromStore = String(raw.FromStore || raw.Store || '').trim();
      if (sway === 'O') byType['O(بيع)']++;
      else if (sway === 'I') byType['I(شراء)']++;
      else if (toStore && fromStore && toStore !== fromStore) byType['مناقلة']++;
      else byType['أخرى']++;
    }
    info(`تصنيف الحركات: ${Object.entries(byType).map(([k,v])=>`${k}:${v}`).join(' | ')}`);
    
    // تحقق: هل عدد حركات البيع = عدد بنود فواتير المبيعات
    const salesMoveCount = byType['O(بيع)'];
    const salesLineCount = salesInvs.reduce((s,i) => s + (i.lines?.length || 0), 0);
    check(`حركات بيع (${salesMoveCount}) ≈ بنود فواتير مبيعات (${salesLineCount})`, 
      Math.abs(salesMoveCount - salesLineCount) <= salesLineCount * 0.1,
      `فرق: ${Math.abs(salesMoveCount - salesLineCount)}`);
    
    const purchMoveCount = byType['I(شراء)'];
    const purchLineCount = purchInvs.reduce((s,i) => s + (i.lines?.length || 0), 0);
    check(`حركات شراء (${purchMoveCount}) ≈ بنود فواتير مشتريات (${purchLineCount})`,
      Math.abs(purchMoveCount - purchLineCount) <= purchLineCount * 0.1,
      `فرق: ${Math.abs(purchMoveCount - purchLineCount)}`);
    
    // الحركات المستقلة (بعد التصفية)
    const standalone = invMoves.filter(m => {
      const sway = String((m._raw||{}).SWAY || (m._raw||{}).SWay || '').trim();
      return sway !== 'O' && sway !== 'I';
    });
    info(`حركات مستقلة (تسوية + مناقلة): ${standalone.length}`);
    
    // حركات مع تفاصيل MoveMats
    const withDetails = invMoves.filter(m => m.details && m.details.length > 0);
    info(`حركات مع تفاصيل MoveMats: ${withDetails.length}/${invMoves.length}`);
    
    // المستودعات المستخدمة
    const whUsed = new Set();
    for (const m of invMoves) {
      const raw = m._raw || {};
      for (const f of [raw.Store, raw.FromStore, raw.ToStore, raw.StoreNum]) {
        const n = parseInt(f); if (!isNaN(n) && n > 0) whUsed.add(n);
      }
    }
    info(`مستودعات مستخدمة في الحركات: ${[...whUsed].sort().join(', ')}`);
  }

  // ════════════════ 13. سندات القبض/الدفع ════════════════
  section('13. سندات القبض والدفع (TakeMony)');
  const receipts = reader.getReceipts();
  check(`عدد السندات: ${receipts.length}`, true);
  if (receipts.length > 0) {
    checkFields('TakeMony', receipts, ['number','date','type','amount','accountCode','notes']);
    const rxCount = receipts.filter(r => r.type !== 2).length;
    const payCount = receipts.filter(r => r.type === 2).length;
    info(`قبض: ${rxCount} | دفع: ${payCount}`);
    const totalRx = receipts.filter(r=>r.type!==2).reduce((s,r)=>s+r.amount,0);
    const totalPay = receipts.filter(r=>r.type===2).reduce((s,r)=>s+r.amount,0);
    info(`إجمالي قبض: ${totalRx.toFixed(2)} | إجمالي دفع: ${totalPay.toFixed(2)}`);
    
    // تحقق من وجود حسابات السندات في الشجرة
    const rxAccMissing = new Set();
    for (const r of receipts) {
      if (r.accountCode && !accCodes.has(r.accountCode)) rxAccMissing.add(r.accountCode);
    }
    check(`حسابات سندات مفقودة: ${rxAccMissing.size}`, rxAccMissing.size === 0,
      rxAccMissing.size > 0 ? [...rxAccMissing].slice(0,5).join(', ') : '');
  }

  // ════════════════ 14. التصنيع ════════════════
  section('14. التصنيع (ManuFact)');
  const manufacturing = reader.getManufacturing();
  info(`أوامر تصنيع: ${manufacturing.length}`);

  // ════════════════ 15. الأرصدة الختامية ════════════════
  section('15. الأرصدة الختامية (EndBal)');
  const endBal = reader._readTable('EndBal');
  check(`سجلات EndBal: ${endBal.length}`, true);
  if (endBal.length > 0) {
    const sample = endBal[0];
    info(`حقول EndBal: ${Object.keys(sample).join(', ')}`);
  }

  // ════════════════ 16. المستخدمين ════════════════
  section('16. المستخدمين (Password)');
  const users = reader.getUsers();
  check(`عدد المستخدمين: ${users.length}`, true);
  for (const u of users) info(`  ${u.name} — مستوى: ${u.level}`);

  // ════════════════ 17. ملخص نهائي ════════════════
  section('17. ملخص الربط (Mapper Coverage)');
  const summary = reader.getSummary();
  console.log(`\n  ${'─'.repeat(40)}`);
  console.log(`  │ البيان              │ العدد     │`);
  console.log(`  ${'─'.repeat(40)}`);
  for (const [k,v] of Object.entries(summary.counts)) {
    console.log(`  │ ${k.padEnd(20)} │ ${String(v).padStart(9)} │`);
  }
  console.log(`  ${'─'.repeat(40)}`);
  
  // TexaCore target tables
  console.log(`\n  الربط مع جداول TexaCore:`);
  const mappingTable = [
    ['Accounts → chart_of_accounts', summary.counts.accounts, 'account_code, name_ar, parent_id, opening_balance'],
    ['Custmers → customers', summary.counts.customers, 'code, name_ar, receivable_account_id, balance'],
    ['Suplyers → suppliers', summary.counts.suppliers, 'code, name_ar, payable_account_id, balance'],
    ['CostCenters → cost_centers', summary.counts.costCenters, 'code, name_ar, parent_id, is_group'],
    ['Currency → currencies + exchange_rates', summary.counts.currencies, 'code, exchange_rate, is_base'],
    ['MAT → fabric_materials + products + fabric_groups', summary.counts.materials, 'code, name_ar, unit, purchase_price, group_id'],
    ['GENDAY → journal_entries', summary.counts.journalEntries, 'entry_number, entry_date, total_debit, status'],
    ['MoveDiffar → journal_entry_lines', summary.counts.journalLines, 'account_id, debit, credit, currency, exchange_rate'],
    ['SaleBill → sales_invoices + sales_invoice_items', summary.counts.salesInvoices, 'invoice_number, customer_id, warehouse_id'],
    ['BayBill → purchase_transactions + purchase_transaction_items', summary.counts.purchaseInvoices, 'invoice_no, supplier_id, warehouse_id'],
    ['MOVE → inventory_movements + stock_transfers', summary.counts.inventoryMoves, 'material_id, movement_type, reference_id'],
    ['TakeMony → cash_transactions', summary.counts.receipts, 'transaction_type, cash_account_id, amount'],
    ['Password → user_profiles', summary.counts.users, 'email, full_name, role'],
    ['EndBal → chart_of_accounts (update)', endBal.length, 'current_balance'],
    ['Set → company_accounting_settings', settingsCount, 'base_currency, default_cash_account_id'],
    ['(auto) → warehouses', Object.keys(whNames).length || 'auto', 'code, name, branch_id'],
    ['(auto) → fiscal_years', 1, 'start_date, end_date, is_current'],
    ['(auto) → inventory_stock', 'computed', 'material_id, warehouse_id, quantity_on_hand'],
  ];
  
  for (const [mapping, count, fields] of mappingTable) {
    console.log(`  ${OK} ${mapping}`);
    console.log(`     عدد: ${count} | حقول: ${fields}`);
  }

  // ════════════════ النتيجة ════════════════
  section('النتيجة النهائية');
  console.log(`  مشاكل حرجة: ${totalIssues}`);
  console.log(`  تحذيرات: ${totalWarnings}`);
  if (totalIssues === 0) console.log(`\n  ${OK} جميع البيانات جاهزة للاستيراد!`);
  else console.log(`\n  ${FAIL} يوجد ${totalIssues} مشكلة تحتاج إصلاح`);

  reader.close();
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
