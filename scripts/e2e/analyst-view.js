#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// analyst-view — what a person (or an AI) who opens the packaged app finds, plus bundle size and start-up time.
//
//   node scripts/e2e/analyst-view.js --app "<…/TexaCore ERP.app>" [--userdata <dir of an install>] [--timing --erp <ERP checkout>] [--out file.json]
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { PORTS, startApp, stopApp, portFree } = require('./lib');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const APP = path.resolve(arg('app', ''));
const USERDATA = arg('userdata', '');
const ERP = arg('erp', '');
const TIMING = process.argv.includes('--timing');
const OUT = arg('out', '');
if (!arg('app')) { console.error('--app is required'); process.exit(2); }
const RES = fs.existsSync(path.join(APP, 'Contents', 'Resources')) ? path.join(APP, 'Contents', 'Resources') : path.join(APP, 'resources');

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}
const LITERALS = ['CREATE OR REPLACE FUNCTION public.', 'CREATE FUNCTION public.', 'CREATE TABLE public.', 'CREATE TRIGGER trg_', 'ALTER TABLE ONLY public.'].map((s) => Buffer.from(s));

const all = walk(APP);
const res = { app: APP, files: all.length };
// 1. plaintext SQL anywhere in the package
const pgDir = path.join(RES, 'bin', 'pg') + path.sep;
const sqlHits = [];
for (const f of all) {
  if (f.startsWith(pgDir)) continue;                    // PostgreSQL's own share/*.sql (information_schema, extensions) legitimately contain DDL
  const st = fs.statSync(f);
  if (st.size > 300e6 || st.size === 0) continue;
  const buf = fs.readFileSync(f);
  if (LITERALS.some((l) => buf.indexOf(l) >= 0)) sqlHits.push(path.relative(APP, f));
}
res.plaintextBaselineFiles = all.filter((f) => /production_baseline\.sql$|production_baseline\.inventory\.json$/.test(f)).map((f) => path.relative(APP, f));
res.plaintextSqlDdlFiles = sqlHits;
res.plaintextSql = sqlHits.length > 0 || res.plaintextBaselineFiles.length > 0;
// 2. readable main-process code
const code = path.join(RES, 'app', 'src');
const readableProbe = ['handleCreateLocalCompany', 'adminRequestIsLocal', 'enforce_plan_limit', 'class ServiceManager', 'getOrCreateSecrets'];
const mainFiles = ['main.js', 'service-manager.js', 'provisioning.js', 'plan-sync.js', 'preload.js'].filter((f) => fs.existsSync(path.join(code, f)));
res.mainProcessReadable = mainFiles.map((f) => {
  const t = fs.readFileSync(path.join(code, f), 'utf8');
  const lines = t.split('\n');
  const avg = Math.round(t.length / Math.max(1, lines.length));
  const hits = readableProbe.filter((p) => t.includes(p)).length;
  return { file: f, bytes: t.length, lines: lines.length, avgLineLength: avg, readableIdentifiers: hits, readable: hits > 0 && avg < 120 };
});
res.mainJsReadable = res.mainProcessReadable.some((x) => x.readable);
// 3. source maps
const maps = all.filter((f) => f.endsWith('.map') && !f.includes(`${path.sep}node_modules${path.sep}`));
const mapComments = all.filter((f) => /[\\/](frontend|app[\\/]src)[\\/].*\.js$/.test(f) && fs.readFileSync(f, 'latin1').includes('sourceMappingURL='));
res.sourceMapFiles = maps.length; res.sourceMapComments = mapComments.length; res.sourceMaps = maps.length > 0 || mapComments.length > 0;
// 4. frontend bundle
const fe = path.join(RES, 'frontend');
if (fs.existsSync(fe)) {
  const files = walk(fe);
  const js = files.filter((f) => f.endsWith('.js'));
  const sum = (a) => a.reduce((n, f) => n + fs.statSync(f).size, 0);
  const descriptive = js.filter((f) => /(vendor-|app-core|i18n-|index-|Page|Sheet|Dashboard)/.test(path.basename(f)));
  let consoleCalls = 0;
  for (const f of js) { const t = fs.readFileSync(f, 'latin1'); consoleCalls += (t.match(/console\.(log|warn|error|debug|info)\(/g) || []).length; }
  const legal = js.filter((f) => /\/\*!|@license|@preserve/.test(fs.readFileSync(f, 'latin1').slice(0, 4000)));
  res.frontend = { totalBytes: sum(files), jsBytes: sum(js), jsFiles: js.length, descriptiveChunkNames: descriptive.length, consoleCalls, jsWithLegalComments: legal.length,
    sampleChunkNames: js.slice(0, 4).map((f) => path.basename(f)) };
}
// 5. secrets file
if (USERDATA) {
  const sf = path.join(USERDATA, 'texacore-data', 'secrets.json');
  const enc = path.join(USERDATA, 'texacore-data', 'secrets.enc');
  const f = fs.existsSync(sf) ? sf : fs.existsSync(enc) ? enc : '';
  let plain = false; let mode = '';
  if (f) { const t = fs.readFileSync(f, 'utf8'); try { plain = !!JSON.parse(t).jwtSecret; } catch { plain = false; } mode = (fs.statSync(f).mode & 0o777).toString(8); }
  res.secretsFile = { file: f ? path.basename(f) : 'none', plaintext: plain, mode, bytes: f ? fs.statSync(f).size : 0, plainFileAlsoPresent: fs.existsSync(sf) && fs.existsSync(enc) };
}
// 6. timing
(async () => {
  if (TIMING && USERDATA) {
    for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
    const bin = path.join(APP, 'Contents', 'MacOS', path.basename(APP, '.app'));
    const starts = [];
    const loads = [];
    for (let i = 0; i < 3; i++) {
      const logFile = path.join(path.dirname(USERDATA), `timing-${Date.now()}.log`);
      const t0 = Date.now();
      const { child, ready } = startApp({ userData: USERDATA, license: 'free', logFile, appBinary: bin });
      try {
        await ready; starts.push(Date.now() - t0);
        if (ERP) {
          const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));
          const browser = await chromium.launch({ channel: 'chrome', headless: true });
          try {
            const ctx = await browser.newContext(); const page = await ctx.newPage();
            const t1 = Date.now();
            await page.goto(`http://127.0.0.1:${PORTS.ui}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
            const dcl = Date.now() - t1;
            await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
            loads.push({ domContentLoadedMs: dcl, networkIdleMs: Date.now() - t1 });
          } finally { await browser.close(); }
        }
      } finally { await stopApp(child, USERDATA); }
      await new Promise((r) => setTimeout(r, 1500));
    }
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    res.timing = { appRestartToReadyMs: starts, medianAppRestartToReadyMs: med(starts), pageLoad: loads, medianDomContentLoadedMs: loads.length ? med(loads.map((l) => l.domContentLoadedMs)) : null, medianNetworkIdleMs: loads.length ? med(loads.map((l) => l.networkIdleMs)) : null };
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
})();
