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
  assert.match(sm, /CLOUD_API_ALLOW = new Set\(\['\/api\/ping'\]\)/);
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
