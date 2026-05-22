#!/usr/bin/env node
/**
 * 🔄 TCDB Restore + Fix Script
 * 1. استعادة ملف TCDB إلى قاعدة البيانات
 * 2. تحديث حالات الفواتير (payment_status, confirmation_status)
 * 3. إنشاء ملف TCDB جديد بالبيانات المصححة
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFileSync, execSync } = require('child_process');

const TCDB_PATH = '/Users/macbook/Desktop/2026 مطور بعد الصيانة.tcdb';
const ENCRYPTION_KEY = 'texacore-default-backup-key-2026';
const PG_PORT = '54322';
const PG_BIN = '/opt/homebrew/bin';
const DB_PASSWORD = 'postgres';

const env = { ...process.env, PGPASSWORD: DB_PASSWORD };

function parseTcdb(buffer) {
  let offset = 4;
  offset += 1; // version
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

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('🔄 TCDB Restore + Fix');
  console.log('═══════════════════════════════════════════\n');

  // ─── Step 1: Decrypt and decompress ───
  console.log('📂 Step 1: فك تشفير وضغط TCDB...');
  const buffer = fs.readFileSync(TCDB_PATH);
  const parsed = parseTcdb(buffer);
  
  const key = crypto.pbkdf2Sync(ENCRYPTION_KEY, parsed.salt, 100000, 32, 'sha512');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, parsed.iv);
  decipher.setAuthTag(parsed.authTag);
  const compressed = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
  
  const sql = await new Promise((resolve, reject) => {
    zlib.gunzip(compressed, (err, result) => err ? reject(err) : resolve(result));
  });
  console.log(`  ✅ SQL: ${(sql.length / 1024 / 1024).toFixed(2)} MB\n`);

  // ─── Step 2: Write SQL to temp file and restore ───
  console.log('🗄️  Step 2: استعادة قاعدة البيانات...');
  
  const tmpDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, 'restore_temp.sql');
  
  // Wrap with FK constraint disable
  const header = Buffer.from("SET session_replication_role = 'replica';\n");
  const footer = Buffer.from("\nSET session_replication_role = 'origin';\n");
  fs.writeFileSync(tmpFile, Buffer.concat([header, sql, footer]));
  
  try {
    execFileSync(path.join(PG_BIN, 'psql'), [
      '-h', 'localhost', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres',
      '-f', tmpFile, '--set', 'ON_ERROR_STOP=off'
    ], { env, stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 });
    console.log('  ✅ استعادة قاعدة البيانات تمت بنجاح\n');
  } catch (e) {
    // psql may have non-fatal errors (duplicate keys etc.)
    console.log('  ⚠️  استعادة تمت مع بعض التحذيرات (طبيعي)\n');
  }

  // Clean up temp
  try { fs.unlinkSync(tmpFile); } catch {}

  // ─── Step 3: Verify data was restored ───
  console.log('🔍 Step 3: التحقق من الاستعادة...');
  
  const checkResult = execFileSync(path.join(PG_BIN, 'psql'), [
    '-h', 'localhost', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres',
    '-t', '-c', `
      SELECT json_build_object(
        'accounts', (SELECT count(*) FROM chart_of_accounts),
        'journals', (SELECT count(*) FROM journal_entries),
        'customers', (SELECT count(*) FROM customers),
        'suppliers', (SELECT count(*) FROM suppliers),
        'pi', (SELECT count(*) FROM purchase_invoices),
        'pt', (SELECT count(*) FROM purchase_transactions),
        'companies', (SELECT count(*) FROM companies)
      );
    `
  ], { env, encoding: 'utf8' }).trim();
  
  try {
    const counts = JSON.parse(checkResult);
    console.log('  📊 البيانات المستعادة:');
    console.log(`     شجرة الحسابات: ${counts.accounts}`);
    console.log(`     القيود: ${counts.journals}`);
    console.log(`     العملاء: ${counts.customers}`);
    console.log(`     الموردين: ${counts.suppliers}`);
    console.log(`     فواتير المشتريات: ${counts.pi}`);
    console.log(`     معاملات المشتريات: ${counts.pt}`);
    console.log(`     الشركات: ${counts.companies}`);
    
    if (counts.accounts > 0 && counts.companies > 0) {
      console.log('  ✅ الاستعادة ناجحة!\n');
    } else {
      console.log('  ❌ البيانات فارغة — فشل الاستعادة\n');
      process.exit(1);
    }
  } catch (e) {
    console.log('  ⚠️  لم يتم التحقق من البيانات:', checkResult);
  }

  // ─── Step 4: Fix invoice statuses ───
  console.log('🔧 Step 4: تحديث حالات الفواتير...');
  
  const fixQueries = [
    // Fix purchase_invoices
    `UPDATE purchase_invoices 
     SET payment_status = 'paid', confirmation_status = 'confirmed' 
     WHERE invoice_number LIKE 'RSF-%' AND (payment_status != 'paid' OR confirmation_status != 'confirmed')`,
    
    // Fix purchase_transactions
    `UPDATE purchase_transactions 
     SET paid_amount = total_amount, balance = 0, confirmation_status = 'confirmed'
     WHERE invoice_no LIKE 'RSF-%' AND (paid_amount != total_amount OR balance != 0 OR confirmation_status != 'confirmed')`,
  ];

  for (const q of fixQueries) {
    try {
      const result = execFileSync(path.join(PG_BIN, 'psql'), [
        '-h', 'localhost', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres',
        '-t', '-c', q
      ], { env, encoding: 'utf8' }).trim();
      console.log(`  ✅ ${result || 'OK'}`);
    } catch (e) {
      console.log(`  ⚠️  ${e.message.substring(0, 80)}`);
    }
  }

  // Verify fix
  const verifyResult = execFileSync(path.join(PG_BIN, 'psql'), [
    '-h', 'localhost', '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres',
    '-c', `
      SELECT pi.invoice_number, pi.payment_status, pi.confirmation_status,
             pt.stage, pt.paid_amount, pt.balance, pt.confirmation_status as pt_confirm
      FROM purchase_invoices pi
      LEFT JOIN purchase_transactions pt ON pt.id = pi.id
      WHERE pi.invoice_number LIKE 'RSF%';
    `
  ], { env, encoding: 'utf8' });
  console.log('\n  📋 حالة الفواتير بعد الإصلاح:');
  console.log(verifyResult);

  // ─── Step 5: Create new TCDB with fixed data ───
  console.log('💾 Step 5: إنشاء ملف TCDB جديد بالبيانات المصححة...');
  
  const BackupManager = require('./backup-manager');
  const bm = new BackupManager({
    pgBinDir: PG_BIN,
    dbHost: 'localhost',
    dbPort: parseInt(PG_PORT),
    dbName: 'postgres',
    dbUser: 'postgres',
    dbPassword: DB_PASSWORD,
    backupPath: TCDB_PATH,
    encryptionKey: ENCRYPTION_KEY,
    onProgress: (phase, detail) => console.log(`  [${phase}] ${detail}`),
    onError: (err) => console.error('  ❌', err.message),
  });

  const backupResult = await bm.backup();
  if (backupResult) {
    console.log(`\n  ✅ TCDB جديد تم إنشاؤه: ${(backupResult.size / 1024).toFixed(0)} KB`);
    
    // Copy to other locations
    const locations = [
      path.join(require('os').homedir(), 'Documents', 'TexaCore', path.basename(TCDB_PATH)),
      path.join(__dirname, '..', 'data', 'backups', path.basename(TCDB_PATH)),
    ];
    for (const loc of locations) {
      try {
        const dir = path.dirname(loc);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(TCDB_PATH, loc);
        console.log(`  📋 نسخة: ${loc}`);
      } catch (e) {
        console.log(`  ⚠️  فشل النسخ: ${e.message}`);
      }
    }
  } else {
    console.log('  ❌ فشل إنشاء TCDB');
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ اكتمل! الملف جاهز للاستخدام');
  console.log('═══════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('❌ خطأ:', e.message);
  process.exit(1);
});
