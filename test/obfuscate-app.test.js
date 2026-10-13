'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { obfuscateAppCode } = require('../scripts/lib/obfuscate-app');
const { verifyPacked } = require('../scripts/lib/verify-packed');
const { mkdtemp, sha } = require('./helpers');

function tree() {
  const root = mkdtemp('obf-');
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'bootstrap'), { recursive: true });
  fs.writeFileSync(path.join(src, 'main.js'), `'use strict';
const helper = require('./helper');
const SECRET_QUERY = \`SELECT id FROM public.tenants WHERE owner_email = $1\`;
function handleCreateLocalCompany(name) { return helper.up(name) + ' ' + SECRET_QUERY.length; }
class ServiceManager { constructor() { this.n = 3; } go() { return handleCreateLocalCompany('acme') + this.n; } }
module.exports = { run: () => new ServiceManager().go(), PLAN: 'PLAN_LIMIT_EXCEEDED' };
`);
  fs.writeFileSync(path.join(src, 'helper.js'), `exports.up = (s) => s.toUpperCase();\n`);
  fs.writeFileSync(path.join(src, 'renderer.js'), `function onClickThing() { return 1; }\n`);
  fs.writeFileSync(path.join(src, 'i18n.js'), `const I18N = { ar: {} };\n`);
  return { root, src };
}

test('main-process files are obfuscated in place and still behave the same; browser-side files are untouched; a manifest of the ORIGINAL sources is written', () => {
  const { root, src } = tree();
  const mainBefore = fs.readFileSync(path.join(src, 'main.js'), 'utf8');
  const expected = require(path.join(src, 'main.js')).run();
  delete require.cache[require.resolve(path.join(src, 'main.js'))]; delete require.cache[require.resolve(path.join(src, 'helper.js'))];
  const r = obfuscateAppCode(root);
  assert.equal(r.files, 2);
  const after = fs.readFileSync(path.join(src, 'main.js'), 'utf8');
  for (const readable of ['handleCreateLocalCompany', 'ServiceManager', 'SELECT id FROM public.tenants', 'PLAN_LIMIT_EXCEEDED']) assert.ok(!after.includes(readable), `${readable} is still readable`);
  assert.equal(require(path.join(src, 'main.js')).run(), expected, 'same behaviour');
  assert.equal(fs.readFileSync(path.join(src, 'renderer.js'), 'utf8'), 'function onClickThing() { return 1; }\n');
  assert.equal(fs.readFileSync(path.join(src, 'i18n.js'), 'utf8'), 'const I18N = { ar: {} };\n');
  const man = JSON.parse(fs.readFileSync(path.join(root, 'src-manifest.json'), 'utf8'));
  assert.equal(man.obfuscated, true);
  assert.equal(man.files['main.js'], sha(Buffer.from(mainBefore)));
});

test('the gate (expectObfuscated) refuses readable code, a missing manifest, and code built from other sources than the repo', () => {
  const { root, src } = tree();
  const repo = mkdtemp('repo-obf-');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.js'))) fs.copyFileSync(path.join(src, f), path.join(repo, 'src', f));
  const problemsOf = () => verifyPacked({ resourcesDir: root, appCodeDir: root, repoRoot: repo, platform: 'darwin', expectObfuscated: true }).filter((p) => /manifest|readable|formatted|different source/.test(p));
  assert.match(problemsOf().join(), /src-manifest\.json is missing/);
  obfuscateAppCode(root);
  assert.deepEqual(problemsOf(), []);
  fs.appendFileSync(path.join(repo, 'src', 'helper.js'), '// edited after the build\n');
  assert.match(problemsOf().join(), /built from different source/);
});
