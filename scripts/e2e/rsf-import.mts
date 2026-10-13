// Rashid (.rsf) import into a NEW company — the real importer (importData) over the real REST gateway of a running install,
// signed in as the admin the installer created. Run by scripts/e2e/launch-check.js:
//   node --import tsx --import scripts/e2e/rsf-register.mjs scripts/e2e/rsf-import.mts      (cwd = ERP checkout)
// Prints one JSON line per phase and a final summary line; exits non-zero on any failed expectation.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import pg from 'pg';
import WebSocket from 'ws';   // Node 20 has no native WebSocket; supabase-js's realtime client wants one at construction

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
const WT = env('WT_SRC'); const ERP_DIR = env('ERP_DIR'); const RSF = env('RSF'); const API = env('API_URL'); const ADMIN = env('ADMIN_URL');
const SECRET = env('ADMIN_SECRET'); const ANON = env('ANON_KEY'); const OUT = env('OUT'); const PG_PORT = Number(env('PG_PORT'));
mkdirSync(OUT, { recursive: true });
const log = (o: unknown) => console.log(JSON.stringify(o));
const fail = (m: string): never => { console.error(`RSF-CHECK FAILED: ${m}`); process.exit(1); };

const require_ = createRequire(`${ERP_DIR}/package.json`);
const { createClient } = require_('@supabase/supabase-js');

// ── parse ──
const { rsfConverter } = await import(pathToFileURL(`${WT}/features/import/core/rsf-to-unified.ts`).href);
const { detectDefaultAccounts } = await import(pathToFileURL(`${WT}/features/import/core/default-accounts-detection.ts`).href);
const { resolveChosenCode } = await import(pathToFileURL(`${WT}/features/import/wizard/defaultAccountsPanelHelpers.ts`).href);
const buf = readFileSync(RSF);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const data: any = await rsfConverter.parse(ab, { fileName: basename(RSF) });
const det = detectDefaultAccounts(data.chartOfAccounts);
const defsel = Object.fromEntries(det.map((d: any) => [d.key, resolveChosenCode(d.key, {}, d)]));
const base = data.companySettings?.baseCurrencyCode;
const parsed = { base, accounts: data.chartOfAccounts.length, entries: data.journalEntries.length, sales: data.salesInvoices.length, purchases: data.purchaseInvoices.length,
  vouchers: data.vouchers.length, currencies: data.currencies.length, supported: data.companySettings?.supportedCurrencyCodes };
log({ phase: 'parsed', ...parsed });
if (!base) fail('the file declares no base currency');

// ── the new company: the installer's own endpoint, purpose rsf_import, currency from the FILE (no default) ──
const foreign = (data.companySettings?.supportedCurrencyCodes || []).find((c: string) => c !== base) || '';
const create = await fetch(`${ADMIN}/api/create-local-company`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-texacore-local-secret': SECRET },
  body: JSON.stringify({ companyName: 'Rashid E2E', adminEmail: `rashid+${Date.now()}@e2e.test`, adminPassword: 'E2ePass#2026', localCurrency: base, mainCurrency: foreign, country: 'UA', purpose: 'rsf_import' }),
});
const co: any = await create.json();
if (!co.success) fail(`create-local-company: ${JSON.stringify(co).slice(0, 400)}`);
if (co.createdSource !== 'rsf_import' || !co.provisioningKey) fail(`rsf_import response lacks createdSource/provisioningKey: ${JSON.stringify(co).slice(0, 300)}`);
log({ phase: 'company', companyId: co.companyId, tenantId: co.tenantId, createdSource: co.createdSource });

// ── the signed-in client (real PostgREST; RLS on; max-rows 1000) ──
const sb = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as any } });
const ss = await sb.auth.setSession({ access_token: co.accessToken, refresh_token: co.refreshToken });
if (ss.error) fail(`setSession: ${ss.error.message}`);
const userId = ss.data.user!.id;
(globalThis as any).__rvSupabase = sb;
(globalThis as any).__rvTenant = co.tenantId;
(globalThis as any).__rvCompany = co.companyId;

// adopt the provisioned company exactly like the wizard (bootstrapImportTarget): the operation id lives on the company row
const row = await sb.from('companies').select('id,tenant_id,status,created_source,created_source_ref').eq('id', co.companyId).single();
if (row.error || !row.data) fail(`read provisioned company: ${row.error?.message}`);
if (row.data.status !== 'provisioning' || row.data.created_source !== 'rsf_import' || !row.data.created_source_ref) fail(`unexpected provisioned row ${JSON.stringify(row.data)}`);
const operationId = row.data.created_source_ref;

const { importData, completeCompanyProvisioning } = await import(pathToFileURL(`${WT}/features/import/core/cloud-importer.ts`).href);
const selections = (resume: boolean): any => ({
  mode: 'full', chartOption: 'standard', operationId, resume, materialType: 'standard',
  include: { purchaseOrders: true, chartOfAccounts: true, costCenters: true, currencies: true, warehouses: true, companySettings: true, customers: true, suppliers: true,
    materials: true, journalEntries: true, purchaseInvoices: true, salesInvoices: true, vouchers: true, inventoryMovements: true, priceLists: true, exchangeRates: true, stockTransfers: true },
  accountMapping: {}, defaultAccountSelections: defsel,
});
const t0 = Date.now();
let lastPhase = '';
const r1: any = await importData(data, selections(false), co.tenantId, co.companyId, userId, (p: any) => {
  const ph = typeof p === 'string' ? p : (p && (p.phase || p.stage)) || '';
  if (ph && ph !== lastPhase) { lastPhase = ph; log({ phase: 'import', at: ph, sec: Math.round((Date.now() - t0) / 1000) }); }
});
const sec = Math.round((Date.now() - t0) / 1000);
const errorsByPhase: Record<string, number> = {};
for (const e of r1.errors || []) errorsByPhase[e.phase] = (errorsByPhase[e.phase] || 0) + 1;
log({ phase: 'imported', success: r1.success, sec, counts: r1.counts, errorsByPhase, warnings: [...new Set((r1.warnings || []).map((w: any) => w.type))] });
writeFileSync(`${OUT}/import-result.json`, JSON.stringify({ parsed, counts: r1.counts, errors: r1.errors, warnings: (r1.warnings || []).map((w: any) => ({ type: w.type, message: String(w.message).slice(0, 300) })) }, null, 1));

const done: any = await completeCompanyProvisioning(co.companyId, operationId);
log({ phase: 'completed', done: done?.success ?? done });

// ── verify independently, straight from the database ──
const pool = new pg.Pool({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', database: 'postgres', max: 2 });
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;
const cid = co.companyId;
const entries = (await q(`SELECT count(*)::int n FROM public.journal_entries WHERE company_id=$1 AND COALESCE(is_deleted,false)=false`, [cid]))[0].n;
const accounts = (await q(`SELECT count(*)::int n FROM public.chart_of_accounts WHERE company_id=$1 AND external_code IS NOT NULL AND btrim(external_code) <> ''`, [cid]))[0].n;
const accountsAll = (await q(`SELECT count(*)::int n FROM public.chart_of_accounts WHERE company_id=$1`, [cid]))[0].n;
const cs = (await q(`SELECT cas.base_currency, c.default_currency, c.status FROM public.companies c JOIN public.company_accounting_settings cas ON cas.company_id=c.id WHERE c.id=$1`, [cid]))[0];
const bal = (await q(`SELECT round(sum(l.debit)::numeric,2) d, round(sum(l.credit)::numeric,2) c, count(*)::int lines FROM public.journal_entry_lines l JOIN public.journal_entries e ON e.id=l.entry_id WHERE e.company_id=$1 AND COALESCE(e.is_deleted,false)=false`, [cid]))[0];
const parties = (await q(`SELECT (SELECT count(*) FROM public.customers WHERE company_id=$1)::int customers, (SELECT count(*) FROM public.suppliers WHERE company_id=$1)::int suppliers`, [cid]))[0];
await pool.end();
const srcD = Math.round(data.journalEntries.reduce((a: number, e: any) => a + (Number(e.totalDebit) || 0), 0) * 100) / 100;
const srcC = Math.round(data.journalEntries.reduce((a: number, e: any) => a + (Number(e.totalCredit) || 0), 0) * 100) / 100;
const groups = Number(r1.counts?.externalChartGroups ?? 0);
const leafExpected = parsed.accounts - groups;               // the file's chart = account GROUPS + postable accounts; "matched" = the postable ones
const summary = { sourceDebit: srcD, sourceCredit: srcC, accountsImported: r1.counts?.accounts, accountsExpected: leafExpected, externalChartAccounts: r1.counts?.externalChartAccounts, parsedEntries: parsed.entries, importedEntries: entries, parsedAccounts: parsed.accounts, accountsWithSourceCode: accounts, accountsTotal: accountsAll,
  baseCurrency: cs.base_currency, companyCurrency: cs.default_currency, companyStatus: cs.status, lines: bal.lines, debit: bal.d, credit: bal.c, ...parties, importSeconds: sec, importSuccess: r1.success, errors: (r1.errors || []).length };
log({ phase: 'verified', ...summary });
if (!r1.success) fail(`importData reported failure: ${JSON.stringify(r1.errors?.slice(0, 3))}`);
if (cs.base_currency !== base) fail(`base currency ${cs.base_currency}, file says ${base}`);
if (entries !== parsed.entries) fail(`journal entries: imported ${entries} of ${parsed.entries}`);
if (r1.counts?.accounts !== leafExpected || r1.counts?.externalChartAccounts !== leafExpected) fail(`accounts matched ${r1.counts?.accounts}/${leafExpected} (externalChartAccounts ${r1.counts?.externalChartAccounts})`);
// header totals are rounded per entry, lines per account (the known one-cent carry): allow 2 cents over ~191 million
if (Math.abs(Number(bal.d) - srcD) > 0.02 || Math.abs(Number(bal.c) - srcC) > 0.02) fail(`imported ledger totals ${bal.d}/${bal.c} differ from the file's ${srcD}/${srcC}`);
if (cs.status !== 'active') fail(`company status ${cs.status} after completion`);
console.log(`Rashid import OK: ${entries}/${parsed.entries} entries, ${r1.counts.accounts}/${leafExpected} accounts matched, base ${cs.base_currency}, ledger debit ${bal.d} credit ${bal.c} (= the file's ${srcD}/${srcC}), ${r1.counts.customers ?? ''} customers ${r1.counts.suppliers ?? ''} suppliers, ${sec}s`);
