'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EXPECTED } = require('../scripts/e2e/catalog-parity');

test('g3-expected.json: production\'s global row counts of the catalogs the desktop reads (counts only, no data), each with the count a desktop must hold', () => {
  const t = EXPECTED.tables;
  assert.ok(Object.keys(t).length >= 30, 'the catalogs of the desktop data-parity set');
  for (const [name, v] of Object.entries(t)) {
    assert.match(name, /^[a-z_]+$/, name);
    assert.ok(Number.isInteger(v.prod) && Number.isInteger(v.desktop) && v.prod >= 0 && v.desktop >= 0, name);
    assert.ok(['whole', 'tenant', 'company', 'tenant+company'].includes(v.scope), name);
    if (v.desktop !== v.prod) assert.ok(v.note, `${name}: a desktop count that differs from production's carries the reason`);
  }
  // the catalogs whose absence broke printing on the build-3 desktop (every document open: fn_document_qr_link -> 400 «unknown entity_type»; the statement preview said «0 pages»)
  assert.ok(t.print_entity_types.prod >= 43 && t.print_entity_types.desktop === t.print_entity_types.prod);
  assert.ok(t.print_templates.prod >= 70 && t.print_templates.desktop === t.print_templates.prod);
  assert.ok(t.print_template_known_variables.desktop > 500);
  // the only two intended differences: the installer's own platform_admin role, and the FX engine's single flag out of production's per-company markers
  assert.equal(t.roles.desktop, t.roles.prod + 1);
  assert.equal(t.fx_platform_state.desktop, 1);
  assert.deepEqual(Object.entries(t).filter(([, v]) => v.desktop !== v.prod).map(([k]) => k).sort(), ['fx_platform_state', 'roles']);
});

test('the launch-check and migrations-check carry the data-parity checks (fresh install, upgrade, real page)', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'scripts', 'e2e', f), 'utf8');
  assert.match(read('migrations-check.js'), /catalogParity\(pg\)/);
  assert.match(read('multi-company-checks.js'), /9\.5 the global catalogs/);
  assert.match(read('multi-company-checks.js'), /fn_document_qr_link/);
  assert.match(read('multi-company-checks.js'), /LAN/);
  assert.match(read('browser-final-checks.cjs'), /fn_issue_document_token/);
  assert.match(read('browser-final-checks.cjs'), /company_sidebar_collapsed/);
});
