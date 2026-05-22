#!/usr/bin/env node
/**
 * 🧪 TCDB Deep Data Verification — تحقق عميق من البيانات داخل TCDB
 * يفتح الملف ويتحقق من البيانات المحاسبية المستوردة من الرشيد
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ENCRYPTION_KEY = 'texacore-default-backup-key-2026';
const TCDB_MAGIC = Buffer.from('TCDB');

function parseTcdb(buffer) {
  let offset = 4; // skip magic
  const version = buffer.readUInt8(offset); offset += 1;
  offset += 8; // timestamp
  offset += 4; // originalSize
  offset += 4; // compressedSize
  const encryptedSize = buffer.readUInt32LE(offset); offset += 4;
  const salt = buffer.subarray(offset, offset + 32); offset += 32;
  const iv = buffer.subarray(offset, offset + 16); offset += 16;
  const authTag = buffer.subarray(offset, offset + 16); offset += 16;
  offset += 64; // checksum
  const ciphertext = buffer.subarray(offset, offset + encryptedSize);
  return { salt, iv, authTag, ciphertext };
}

function decrypt(salt, iv, authTag, ciphertext) {
  const key = crypto.pbkdf2Sync(ENCRYPTION_KEY, salt, 100000, 32, 'sha512');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function main() {
  const tcdbPath = '/Users/macbook/Desktop/2026 مطور بعد الصيانة.tcdb';
  console.log('📂 فتح:', tcdbPath);
  
  const buffer = fs.readFileSync(tcdbPath);
  const parsed = parseTcdb(buffer);
  const compressed = decrypt(parsed.salt, parsed.iv, parsed.authTag, parsed.ciphertext);
  const sql = (await new Promise((resolve, reject) => {
    zlib.gunzip(compressed, (err, result) => err ? reject(err) : resolve(result));
  })).toString('utf8');

  console.log(`\n📊 SQL: ${(sql.length / 1024 / 1024).toFixed(2)} MB\n`);

  // ─── Count data rows in COPY blocks ───
  const lines = sql.split('\n');
  let currentTable = null;
  let rowCounts = {};
  let inCopy = false;

  for (const line of lines) {
    if (line.startsWith('COPY ')) {
      const match = line.match(/COPY\s+(?:public\.)?(\w+)\s/);
      if (match) {
        currentTable = match[1];
        rowCounts[currentTable] = 0;
        inCopy = true;
      }
      continue;
    }
    if (line === '\\.' && inCopy) {
      inCopy = false;
      currentTable = null;
      continue;
    }
    if (inCopy && currentTable && line.trim()) {
      rowCounts[currentTable]++;
    }
  }

  // ─── Critical table counts ───
  const critical = [
    'chart_of_accounts', 'journal_entries', 'journal_entry_lines',
    'customers', 'suppliers', 'cost_centers', 'warehouses',
    'purchase_invoices', 'purchase_invoice_items',
    'purchase_transactions', 'purchase_transaction_items',
    'sales_invoices', 'sales_invoice_items',
    'sales_transactions', 'sales_transaction_items',
    'inventory_movements', 'inventory_stock',
    'products', 'fabric_materials', 'fabric_groups',
    'exchange_rates', 'fiscal_years',
    'tenants', 'companies', 'user_profiles',
    'roles', 'user_roles',
    'company_accounting_settings',
    'price_lists', 'price_list_items',
    'cash_accounts',
  ];

  console.log('═══ عدد السجلات في الجداول الحرجة ═══\n');
  
  let totalRows = 0;
  for (const table of critical) {
    const count = rowCounts[table] || 0;
    totalRows += count;
    const icon = count > 0 ? '✅' : '⚠️ ';
    const pad = table.padEnd(35, ' ');
    console.log(`  ${icon} ${pad} ${count.toLocaleString().padStart(8)} صف`);
  }

  console.log(`\n  ─────────────────────────────────────────────`);
  console.log(`  📊 إجمالي السجلات الحرجة: ${totalRows.toLocaleString()} صف`);
  
  // Total across all tables
  const grandTotal = Object.values(rowCounts).reduce((s, v) => s + v, 0);
  console.log(`  📊 إجمالي كل الجداول: ${grandTotal.toLocaleString()} صف (${Object.keys(rowCounts).length} جدول)`);

  // ─── Check for purchase invoice statuses in SQL ───
  console.log('\n═══ التحقق من حالات الفواتير داخل SQL ═══\n');
  
  // Search for purchase_invoices COPY block and extract status columns
  let inPurchaseInvoices = false;
  let piColumns = [];
  let piData = [];
  
  for (const line of lines) {
    if (line.startsWith('COPY') && line.includes('purchase_invoices')) {
      inPurchaseInvoices = true;
      // Extract column names
      const colMatch = line.match(/\(([^)]+)\)/);
      if (colMatch) piColumns = colMatch[1].split(',').map(c => c.trim());
      continue;
    }
    if (inPurchaseInvoices && line === '\\.') {
      inPurchaseInvoices = false;
      continue;
    }
    if (inPurchaseInvoices && line.trim()) {
      piData.push(line.split('\t'));
    }
  }

  if (piColumns.length > 0 && piData.length > 0) {
    const statusIdx = piColumns.indexOf('status');
    const receiptIdx = piColumns.indexOf('receipt_status');
    const paymentIdx = piColumns.indexOf('payment_status');
    const confirmIdx = piColumns.indexOf('confirmation_status');
    const invoiceNumIdx = piColumns.indexOf('invoice_number');
    
    for (const row of piData) {
      const inv = invoiceNumIdx >= 0 ? row[invoiceNumIdx] : '?';
      console.log(`  📄 فاتورة: ${inv}`);
      if (statusIdx >= 0) console.log(`     status: ${row[statusIdx]}`);
      if (receiptIdx >= 0) console.log(`     receipt_status: ${row[receiptIdx]}`);
      if (paymentIdx >= 0) console.log(`     payment_status: ${row[paymentIdx]}`);
      if (confirmIdx >= 0) console.log(`     confirmation_status: ${row[confirmIdx]}`);
    }
  } else {
    console.log('  ℹ️  لا يوجد فواتير مشتريات في TCDB');
  }

  // Similarly check purchase_transactions
  console.log('\n═══ purchase_transactions في TCDB ═══\n');
  
  let inPT = false;
  let ptColumns = [];
  let ptData = [];
  
  for (const line of lines) {
    if (line.startsWith('COPY') && line.includes('purchase_transactions') && !line.includes('items')) {
      inPT = true;
      const colMatch = line.match(/\(([^)]+)\)/);
      if (colMatch) ptColumns = colMatch[1].split(',').map(c => c.trim());
      continue;
    }
    if (inPT && line === '\\.') {
      inPT = false;
      continue;
    }
    if (inPT && line.trim()) {
      ptData.push(line.split('\t'));
    }
  }

  if (ptColumns.length > 0 && ptData.length > 0) {
    const stageIdx = ptColumns.indexOf('stage');
    const paidIdx = ptColumns.indexOf('paid_amount');
    const balIdx = ptColumns.indexOf('balance');
    const invNoIdx = ptColumns.indexOf('invoice_no');
    const confirmIdx2 = ptColumns.indexOf('confirmation_status');
    
    for (const row of ptData) {
      const inv = invNoIdx >= 0 ? row[invNoIdx] : '?';
      console.log(`  📄 Transaction: ${inv}`);
      if (stageIdx >= 0) console.log(`     stage: ${row[stageIdx]}`);
      if (paidIdx >= 0) console.log(`     paid_amount: ${row[paidIdx]}`);
      if (balIdx >= 0) console.log(`     balance: ${row[balIdx]}`);
      if (confirmIdx2 >= 0) console.log(`     confirmation_status: ${row[confirmIdx2]}`);
    }
  } else {
    console.log('  ℹ️  لا يوجد purchase_transactions في TCDB');
  }

  console.log('\n✅ التحقق اكتمل بنجاح!\n');
}

main().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
