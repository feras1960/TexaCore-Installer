#!/usr/bin/env node
'use strict';
// Stand-alone runner of the final-build checks 9.1-9.4 (multi-company-checks.js) on an isolated app instance (own userData, ports 47391-47396 only) - the same checks launch-check.js runs at its end.
//   node scripts/e2e/multi-company-run.js --workdir <empty dir> --erp <ERP checkout> [--app <packaged .app>] [--license free|trial]
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { PORTS, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions } = require('./lib');
const { multiCompanyChecks } = require('./multi-company-checks');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const ERP = arg('erp', '');
const APP = arg('app', '');
const LICENSE = arg('license', 'free');
if (!arg('workdir') || !ERP) { console.error('--workdir <dir> and --erp <ERP checkout> are required'); process.exit(2); }

(async () => {
  const R = new Results();
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} is in use`); process.exit(2); }
  const userData = path.join(WORK, 'userdata');
  const appBinary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
  const { child, ready } = startApp({ userData, license: LICENSE, logFile: path.join(WORK, 'app.log'), appBinary, extraEnv: { HOME: path.join(WORK, 'home') } });
  try {
    await ready;
    const secrets = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'secrets.json'), 'utf8'));
    setPgPassword(secrets.dbPassword);
    const pg = async (sql, params = []) => { const c = new Client(pgOptions()); await c.connect(); try { return await c.query(sql, params); } finally { await c.end(); } };
    await multiCompanyChecks(R, { request, ADMIN: `http://127.0.0.1:${PORTS.admin}`, API: `http://127.0.0.1:${PORTS.api}`, UI: `http://127.0.0.1:${PORTS.ui}`, H: { 'x-texacore-local-secret': secrets.localApiSecret },
      anonKey: secrets.anonKey, ERP, WORK, pg });
  } catch (e) { R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 }); console.log(`  FAIL  harness - ${e.message}`); }
  finally { await stopApp(child, userData); }
  console.log(`\nmulti-company-run: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
})();
