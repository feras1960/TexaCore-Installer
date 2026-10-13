'use strict';
// Static guard for the 1.x local security gap: the startup code must never again widen anon's access or switch row level security off,
// never fall back to the shared 1.x secrets, and never look users up through GoTrue's ignored ?email= filter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() ? files(f) : (/\.(js|sql)$/.test(e.name) ? [f] : []);
  });
}
const all = files(SRC).map((f) => ({ f: path.relative(SRC, f), text: fs.readFileSync(f, 'utf8') }));
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '');   // comments may TALK about the old behaviour

test('no source file grants table/function access to anon or disables RLS', () => {
  for (const { f, text } of all) {
    // the one sanctioned grant to anon: the admin-portal gate, which only answers true/false (see local_extras.sql)
    const c = code(text).replace(/GRANT EXECUTE ON FUNCTION public\.verify_admin_password\(text\) TO anon[^;]*;/g, '');
    assert.doesNotMatch(c, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i, `${f} disables RLS`);
    assert.doesNotMatch(c, /GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE|EXECUTE)[^;]{0,80}\bTO\b[^;]*\banon\b/i, `${f} grants to anon`);
    assert.doesNotMatch(c, /NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i, `${f} relaxes RLS`);
  }
});

test('the shared 1.x secrets are only referenced by secrets.js (to reject them)', () => {
  const legacy = require('../src/secrets').LEGACY;
  for (const { f, text } of all) {
    if (f === 'secrets.js') continue;
    for (const v of [legacy.jwtSecret, legacy.dbPassword, legacy.anonKey, legacy.serviceKey]) assert.ok(!text.includes(v), `${f} embeds a legacy secret`);
  }
});

test('GoTrue users are never looked up with ?email= / ?filter= (GoTrue ignores them and returns everybody)', () => {
  for (const { f, text } of all) {
    const c = code(text);
    assert.doesNotMatch(c, /admin\/users\?(email|filter)=/, `${f} looks users up through GoTrue`);
  }
});

test('the web server has no unauthenticated route that reaches the admin API from the tunnel except /api/ping', () => {
  const sm = all.find((x) => x.f === 'service-manager.js').text;
  assert.match(sm, /REMOTE_API_ALLOW = new Set\(\['\/api\/ping'\]\)/);
  assert.match(sm, /GOTRUE_DISABLE_SIGNUP: 'true'/);
  assert.doesNotMatch(sm, /GOTRUE_DISABLE_SIGNUP: 'false'/);
  assert.match(sm, /listen_addresses = '127\.0\.0\.1'/);
});

test('the DB roles are created without login superusers and PostgREST runs as the anon role under production grants', () => {
  const sm = all.find((x) => x.f === 'service-manager.js').text;
  assert.match(sm, /db-anon-role = "anon"/);
  const b = all.find((x) => x.f === 'bootstrap.js').text;
  assert.doesNotMatch(b, /LOGIN[^;]*SUPERUSER|SUPERUSER[^;]*LOGIN/);
});

// full-line comments only: a block-comment regex would swallow code after a '/_supabase/*' string literal
const lineCode = (t) => t.replace(/^\s*(\/\/|--).*$/gm, '');

test('LAN exposure: the admin secret and /api/* are decided by net-guard (loopback Host + peer), never by "not a .texacore.ai host"', () => {
  const sm = all.find((x) => x.f === 'service-manager.js').text;
  const c = lineCode(sm);
  assert.doesNotMatch(c, /isCloudAccess/, 'a substring test on the Host header decides nothing');
  assert.doesNotMatch(c, /\.includes\('\.texacore\.(ai|com)'\)/);
  assert.match(c, /adminBits = \(isLocal && sameOrigin\)/);
  assert.match(c, /!netGuard\.isLocalRequest\(req\) && !REMOTE_API_ALLOW\.has\(urlPath\)/);
  // the API proxy is loopback-only; the one 0.0.0.0 listener is the UI server (the office PCs open the ERP from it)
  assert.match(c, /proxyServer\.listen\(this\.activeApiPort, '127\.0\.0\.1'/);
  assert.equal((c.match(/'0\.0\.0\.0'/g) || []).length, 2, 'only the UI server (and its port-80 fallback) listens on all interfaces');
  const main = lineCode(all.find((x) => x.f === 'main.js').text);
  assert.match(main, /adminRequestIsLocal/);
  assert.match(main, /httpServer\.listen\(ServiceManager\.ADMIN_PORT, '127\.0\.0\.1'/);
});

test('no wildcard CORS anywhere in the installer', () => {
  for (const { f, text } of all) {
    const c = lineCode(text);
    assert.doesNotMatch(c, /Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/i, `${f} sends Access-Control-Allow-Origin: *`);
    assert.doesNotMatch(c, /\['access-control-allow-origin'\]\s*=\s*['"]\*['"]/i, `${f} forces CORS *`);
  }
});

test('restore-tcdb: the multipart file name is validated and the bytes checked BEFORE anything is written; write is temp + rename', () => {
  const main = lineCode(all.find((x) => x.f === 'main.js').text);
  const i = main.indexOf("req.url === '/api/restore-tcdb'");
  assert.ok(i > 0);
  const block = main.slice(i, i + 9000);
  const iName = block.indexOf('safeUploadName');
  const iMagic = block.indexOf('isTcdbContainer(fileData)');
  const iWrite = block.indexOf('writeFileSync');
  assert.ok(iName > 0 && iMagic > 0 && iWrite > 0, 'validation and write both present');
  assert.ok(iName < iWrite && iMagic < iWrite, 'validation precedes the write');
  assert.match(block, /renameSync\(tmpPath, tcdbPath\)/);
  assert.doesNotMatch(block, /writeFileSync\(tcdbPath/, 'never writes straight to the caller-named path');
});
