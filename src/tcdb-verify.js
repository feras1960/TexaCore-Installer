#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * 🧪 TCDB Verification Script — تحقق شامل من ملف النسخة الاحتياطية
 * ═══════════════════════════════════════════════════════════════
 * 
 * يقوم بـ:
 * 1. التحقق من وجود ملف TCDB بعد الاستيراد
 * 2. التحقق من صحة الهيكل (Magic, Version, Checksum)
 * 3. فك التشفير والضغط
 * 4. التحقق من محتوى SQL (جداول، بيانات)
 * 5. اختبار الاستعادة (يدوي — يحتاج تأكيد)
 * 
 * Usage: node tcdb-verify.js [path-to-tcdb]
 *        إذا لم يُحدد المسار، يبحث تلقائياً في المواقع المعروفة
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');

// ─── Constants (must match backup-manager.js) ───
const TCDB_MAGIC = Buffer.from('TCDB');
const TCDB_VERSION = 2;
const ENCRYPTION_KEY = 'texacore-default-backup-key-2026';
const KEY_ITERATIONS = 100000;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// ─── Colors ───
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};
const ok  = (msg) => console.log(`${C.green}  ✅ ${msg}${C.reset}`);
const err = (msg) => console.log(`${C.red}  ❌ ${msg}${C.reset}`);
const warn = (msg) => console.log(`${C.yellow}  ⚠️  ${msg}${C.reset}`);
const info = (msg) => console.log(`${C.cyan}  ℹ️  ${msg}${C.reset}`);
const header = (msg) => console.log(`\n${C.bold}${C.cyan}═══ ${msg} ═══${C.reset}`);
const sep = () => console.log(`${C.dim}────────────────────────────────────────────${C.reset}`);

// ─── Find TCDB files ───
function findTcdbFiles() {
  const locations = [
    path.join(os.homedir(), 'Documents', 'TexaCore'),
    path.join(os.homedir(), 'Desktop'),
    path.join(__dirname, '..', 'data', 'backups'),
    path.join(__dirname, '..', '..', 'data', 'backups'),
  ];

  const found = [];
  for (const dir of locations) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.tcdb'));
      for (const f of files) {
        found.push({
          path: path.join(dir, f),
          name: f,
          location: dir,
          size: fs.statSync(path.join(dir, f)).size,
          mtime: fs.statSync(path.join(dir, f)).mtime,
        });
      }
    } catch (e) { /* skip */ }
  }
  return found;
}

// ─── Parse TCDB Header ───
function parseTcdbHeader(buffer) {
  const magic = buffer.subarray(0, 4);
  if (!magic.equals(TCDB_MAGIC)) {
    throw new Error('Not a valid TCDB file (magic mismatch)');
  }

  let offset = 4;
  const version = buffer.readUInt8(offset); offset += 1;
  const timestamp = Number(buffer.readBigUInt64LE(offset)); offset += 8;
  const originalSize = buffer.readUInt32LE(offset); offset += 4;
  const compressedSize = buffer.readUInt32LE(offset); offset += 4;
  const encryptedSize = buffer.readUInt32LE(offset); offset += 4;
  const salt = buffer.subarray(offset, offset + 32); offset += 32;
  const iv = buffer.subarray(offset, offset + 16); offset += 16;
  const authTag = buffer.subarray(offset, offset + 16); offset += 16;
  const checksum = buffer.subarray(offset, offset + 64); offset += 64;
  const ciphertext = buffer.subarray(offset, offset + encryptedSize);

  return {
    version, timestamp, originalSize, compressedSize, encryptedSize,
    salt, iv, authTag, checksum, ciphertext,
    headerSize: 153,
    totalSize: buffer.length,
  };
}

// ─── Decrypt ───
function decrypt(salt, iv, authTag, ciphertext) {
  const key = crypto.pbkdf2Sync(ENCRYPTION_KEY, salt, KEY_ITERATIONS, 32, 'sha512');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Decompress ───
function decompress(data) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// ─── Analyze SQL Content ───
function analyzeSql(sql) {
  const text = sql.toString('utf8');
  const lines = text.split('\n');
  
  // Count COPY/INSERT statements
  const copyStatements = lines.filter(l => l.startsWith('COPY ')).map(l => {
    const match = l.match(/COPY\s+(\w+\.)?(\w+)\s/);
    return match ? match[2] : 'unknown';
  });
  
  // Count CREATE TABLE
  const createTables = lines.filter(l => l.match(/^CREATE TABLE/i)).map(l => {
    const match = l.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+\.)?(\w+)/i);
    return match ? match[2] : 'unknown';
  });
  
  // Check for critical tables
  const criticalTables = [
    'chart_of_accounts', 'journal_entries', 'journal_entry_lines',
    'customers', 'suppliers', 'cost_centers', 'warehouses',
    'purchase_invoices', 'purchase_transactions', 'purchase_invoice_items',
    'sales_invoices', 'sales_transactions', 'sales_invoice_items',
    'inventory_movements', 'inventory_stock',
    'user_profiles', 'companies', 'tenants',
    'fiscal_years', 'company_accounting_settings',
  ];

  const foundTables = {};
  for (const table of criticalTables) {
    // Check COPY or CREATE TABLE
    const hasCopy = copyStatements.includes(table);
    const hasCreate = createTables.includes(table);
    foundTables[table] = { copy: hasCopy, create: hasCreate, present: hasCopy || hasCreate };
  }

  // Count auth schema items
  const hasAuthUsers = text.includes('auth.users') || text.includes('COPY auth.users');
  
  return {
    totalLines: lines.length,
    totalBytes: text.length,
    copyStatements: copyStatements.length,
    copyTables: copyStatements,
    createTables: createTables.length,
    criticalTables: foundTables,
    hasAuthSchema: hasAuthUsers,
    hasPublicSchema: text.includes('SET search_path') || createTables.length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log(`${C.bold}${C.cyan}`);
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║   🔐 TexaCore TCDB Verification Script v1.0     ║`);
  console.log(`║   سكريبت التحقق من ملف النسخة الاحتياطية       ║`);
  console.log(`╚══════════════════════════════════════════════════╝${C.reset}`);

  let tcdbPath = process.argv[2];

  // ─── Step 1: Find TCDB Files ───
  header('Step 1: البحث عن ملفات TCDB');

  if (tcdbPath) {
    if (!fs.existsSync(tcdbPath)) {
      err(`الملف غير موجود: ${tcdbPath}`);
      process.exit(1);
    }
    info(`ملف محدد يدوياً: ${tcdbPath}`);
  } else {
    const files = findTcdbFiles();
    if (files.length === 0) {
      err('لم يتم العثور على أي ملف TCDB!');
      info('المواقع المفحوصة:');
      info(`  ~/Documents/TexaCore/`);
      info(`  ~/Desktop/`);
      info(`  texacore-installer/data/backups/`);
      process.exit(1);
    }

    console.log(`\n  وُجدت ${files.length} ملف(ات) TCDB:\n`);
    files.forEach((f, i) => {
      const sizeKB = (f.size / 1024).toFixed(0);
      const age = ((Date.now() - f.mtime.getTime()) / 60000).toFixed(0);
      console.log(`  ${C.bold}[${i + 1}]${C.reset} ${f.name}`);
      console.log(`      📁 ${f.location}`);
      console.log(`      📏 ${sizeKB} KB | 🕐 ${age} دقيقة مضت`);
      console.log();
    });

    // Use the most recent file
    files.sort((a, b) => b.mtime - a.mtime);
    tcdbPath = files[0].path;
    ok(`استخدام الأحدث: ${files[0].name}`);
  }

  sep();

  // ─── Step 2: Parse Header ───
  header('Step 2: تحليل هيكل الملف');

  const buffer = fs.readFileSync(tcdbPath);
  let parsed;
  try {
    parsed = parseTcdbHeader(buffer);
    ok(`Magic: TCDB ✓`);
    ok(`Version: ${parsed.version} (supported: ≤${TCDB_VERSION})`);
    ok(`Timestamp: ${new Date(parsed.timestamp).toLocaleString('ar-u-nu-latn')}`);
    ok(`Original SQL: ${(parsed.originalSize / 1024 / 1024).toFixed(2)} MB`);
    ok(`Compressed: ${(parsed.compressedSize / 1024 / 1024).toFixed(2)} MB (${((1 - parsed.compressedSize / parsed.originalSize) * 100).toFixed(1)}% compression)`);
    ok(`Encrypted payload: ${(parsed.encryptedSize / 1024 / 1024).toFixed(2)} MB`);
    ok(`File size: ${(parsed.totalSize / 1024 / 1024).toFixed(2)} MB`);

    if (parsed.version > TCDB_VERSION) {
      err(`إصدار الملف (${parsed.version}) أحدث من المدعوم (${TCDB_VERSION})`);
      process.exit(1);
    }
  } catch (e) {
    err(`فشل تحليل الملف: ${e.message}`);
    process.exit(1);
  }

  sep();

  // ─── Step 3: Verify Checksum ───
  header('Step 3: التحقق من سلامة البيانات');

  const actualChecksum = crypto.createHash('sha256').update(parsed.ciphertext).digest();
  const storedChecksum = parsed.checksum.subarray(0, 32);
  if (actualChecksum.equals(storedChecksum)) {
    ok('Checksum مطابق — الملف سليم');
  } else {
    warn('Checksum غير مطابق — قد يكون الملف معدّلاً');
  }

  sep();

  // ─── Step 4: Decrypt ───
  header('Step 4: فك التشفير');

  let compressed;
  try {
    compressed = decrypt(parsed.salt, parsed.iv, parsed.authTag, parsed.ciphertext);
    ok(`فك التشفير نجح — ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    err(`فشل فك التشفير: ${e.message}`);
    err('قد يكون مفتاح التشفير مختلفاً');
    process.exit(1);
  }

  sep();

  // ─── Step 5: Decompress ───
  header('Step 5: فك الضغط');

  let sql;
  try {
    sql = await decompress(compressed);
    ok(`فك الضغط نجح — ${(sql.length / 1024 / 1024).toFixed(2)} MB (${sql.toString('utf8').split('\n').length.toLocaleString()} سطر)`);
  } catch (e) {
    err(`فشل فك الضغط: ${e.message}`);
    process.exit(1);
  }

  sep();

  // ─── Step 6: Analyze SQL ───
  header('Step 6: تحليل محتوى SQL');

  const analysis = analyzeSql(sql);
  
  info(`إجمالي الأسطر: ${analysis.totalLines.toLocaleString()}`);
  info(`عدد COPY statements: ${analysis.copyStatements}`);
  info(`عدد CREATE TABLE: ${analysis.createTables}`);
  info(`Auth schema: ${analysis.hasAuthSchema ? '✅ موجود' : '❌ مفقود'}`);
  info(`Public schema: ${analysis.hasPublicSchema ? '✅ موجود' : '❌ مفقود'}`);

  console.log(`\n  ${C.bold}الجداول الحرجة:${C.reset}\n`);

  let missingCount = 0;
  for (const [table, status] of Object.entries(analysis.criticalTables)) {
    if (status.present) {
      const hasData = status.copy ? ' (مع بيانات)' : ' (هيكل فقط)';
      console.log(`    ${C.green}✅${C.reset} ${table}${C.dim}${hasData}${C.reset}`);
    } else {
      console.log(`    ${C.red}❌${C.reset} ${table} — ${C.red}مفقود!${C.reset}`);
      missingCount++;
    }
  }

  sep();

  // ─── Step 7: Summary ───
  header('الملخص النهائي');

  const allCriticalPresent = missingCount === 0;
  const checksumOk = actualChecksum.equals(storedChecksum);

  console.log(`\n  ${C.bold}النتيجة:${C.reset}\n`);
  
  if (allCriticalPresent && checksumOk) {
    console.log(`  ${C.green}${C.bold}╔══════════════════════════════════════╗`);
    console.log(`  ║  ✅ الملف سليم وجاهز للاستخدام!    ║`);
    console.log(`  ╚══════════════════════════════════════╝${C.reset}`);
  } else {
    console.log(`  ${C.yellow}${C.bold}╔══════════════════════════════════════╗`);
    console.log(`  ║  ⚠️  الملف يحتاج مراجعة             ║`);
    console.log(`  ╚══════════════════════════════════════╝${C.reset}`);
    if (missingCount > 0) warn(`${missingCount} جدول(ات) حرجة مفقودة`);
    if (!checksumOk) warn('Checksum غير مطابق');
  }

  console.log(`\n  📂 الملف: ${tcdbPath}`);
  console.log(`  📏 الحجم: ${(parsed.totalSize / 1024).toFixed(0)} KB`);
  console.log(`  📅 التاريخ: ${new Date(parsed.timestamp).toLocaleString('ar-u-nu-latn')}`);
  console.log(`  🗃️  SQL: ${(sql.length / 1024 / 1024).toFixed(2)} MB (${analysis.totalLines.toLocaleString()} سطر)`);
  console.log(`  🔢 COPY: ${analysis.copyStatements} جدول | CREATE: ${analysis.createTables} جدول`);
  console.log();

  // Also check if TCDB copies exist in expected locations
  header('التحقق من النسخ الإضافية');
  const expectedLocations = [
    { name: 'Documents', path: path.join(os.homedir(), 'Documents', 'TexaCore') },
    { name: 'Desktop', path: path.join(os.homedir(), 'Desktop') },
    { name: 'Installer', path: path.join(__dirname, '..', 'data', 'backups') },
  ];

  const baseName = path.basename(tcdbPath);
  for (const loc of expectedLocations) {
    const checkPath = path.join(loc.path, baseName);
    if (fs.existsSync(checkPath)) {
      const stat = fs.statSync(checkPath);
      ok(`${loc.name}: ${checkPath} (${(stat.size / 1024).toFixed(0)} KB)`);
    } else {
      warn(`${loc.name}: غير موجود (${checkPath})`);
    }
  }

  console.log();
}

main().catch(e => {
  err(`خطأ غير متوقع: ${e.message}`);
  process.exit(1);
});
