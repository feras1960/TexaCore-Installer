/**
 * إصلاح نهائي — تحديث payable_account_id و receivable_account_id مباشرة في DB
 */
const { Client } = require('pg');

async function main() {
  const pgClient = new Client({
    host: 'localhost',
    port: 54322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });
  await pgClient.connect();

  // إصلاح الموردين: ربط payable_account_id بالحساب المطابق لكود المورد
  const supResult = await pgClient.query(`
    UPDATE suppliers s
    SET payable_account_id = ca.id
    FROM chart_of_accounts ca
    WHERE ca.account_code = s.code
      AND ca.tenant_id = s.tenant_id
      AND ca.company_id = s.company_id
      AND (s.payable_account_id IS NULL OR s.payable_account_id != ca.id)
  `);
  console.log(`✅ Suppliers fixed: ${supResult.rowCount} rows updated`);

  // إصلاح العملاء: ربط receivable_account_id بالحساب المطابق لكود العميل
  const custResult = await pgClient.query(`
    UPDATE customers c
    SET receivable_account_id = ca.id
    FROM chart_of_accounts ca
    WHERE ca.account_code = c.code
      AND ca.tenant_id = c.tenant_id
      AND ca.company_id = c.company_id
      AND (c.receivable_account_id IS NULL OR c.receivable_account_id != ca.id)
  `);
  console.log(`✅ Customers fixed: ${custResult.rowCount} rows updated`);

  // التحقق
  console.log(`\n=== التحقق من الموردين ===`);
  const { rows: sups } = await pgClient.query(`
    SELECT s.code, s.name_ar, ca.account_code as linked
    FROM suppliers s LEFT JOIN chart_of_accounts ca ON ca.id = s.payable_account_id
    ORDER BY s.code LIMIT 5
  `);
  sups.forEach(s => console.log(`  ${s.code} → ${s.linked} ${s.linked === s.code ? '✅' : '❌'}`));

  console.log(`\n=== التحقق من العملاء ===`);
  const { rows: custs } = await pgClient.query(`
    SELECT c.code, c.name_ar, ca.account_code as linked
    FROM customers c LEFT JOIN chart_of_accounts ca ON ca.id = c.receivable_account_id
    WHERE c.code LIKE '161%'
    ORDER BY c.code LIMIT 5
  `);
  custs.forEach(c => console.log(`  ${c.code} → ${c.linked} ${c.linked === c.code ? '✅' : '❌'}`));

  await pgClient.end();
}

main().catch(e => console.error(e));
