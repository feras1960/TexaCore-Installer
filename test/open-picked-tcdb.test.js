// 2.0.3: a company file picked in the native window is opened IN PLACE — the work keeps syncing into that same file (owner 15-10:
// «عند تحديد الملف تزامن معه»). 2.0.2's page uploaded a copy to /api/restore-tcdb and the live file became "<name> (2).tcdb" in Documents/TexaCore.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const routeAt = src.indexOf("case 'POST /api/open-picked-tcdb'");
const route = src.slice(routeAt, src.indexOf('return true;', routeAt));
const fnAt = src.indexOf('async function restoreTcdbFromPath(');
const fn = src.slice(fnAt, src.indexOf('\nconst httpServer', fnAt));

test('the route is behind the same-machine + secret guard of the other company-file routes', () => {
  const set = src.slice(src.indexOf('const DESTRUCTIVE_API = new Set(['), src.indexOf(']);', src.indexOf('const DESTRUCTIVE_API')));
  assert.match(set, /'\/api\/open-picked-tcdb'/);
});

test('it opens only what the user picked: a live reference to a .tcdb, read with the idle guard, a real container, phrase checked first', () => {
  assert.ok(routeAt > 0);
  assert.match(route, /pickedFiles\.get\(/);
  assert.match(route, /code: 'PICK_EXPIRED'/);
  assert.match(route, /item\.type !== 'tcdb'/);
  assert.match(route, /readFileIdle\(item\.filePath/);
  assert.match(route, /isTcdbContainer\(buf\)/);
  const probe = route.indexOf('probeAccess(buf');
  const restore = route.indexOf('restoreTcdbFromPath(item.filePath');
  assert.ok(probe > 0 && restore > probe, 'the passphrase is checked before the restore');
});

test('the company file is the opened file itself, unless it is a protected export or cannot be written', () => {
  assert.match(fn, /const liveTarget = \(!openedWithPassphrase && fileWritable && besideOk\)\s*\?\s*selectedPath/);
  assert.match(fn, /uniqueTcdbPath\(besideOk \? fileDir : companyFile\.defaultCompanyDir\(\)/, 'otherwise a FREE name beside it (or the default TexaCore folder)');
  assert.match(fn, /backupManager\.backupPath = liveTarget;/);
  assert.match(fn, /tcdbPath: liveTarget, storagePath: path\.dirname\(liveTarget\)/);
});

test('the one-off copy never overwrites another file', () => {
  assert.match(fn, /path\.join\(DATA_DIR, 'backups', `\$\{companyFile\.safeFileBase\(/);
  assert.match(fn, /\.opened-\$\{companyFile\.localDateStamp\(\)\}\.tcdb/);
  assert.match(fn, /COPYFILE_EXCL/);
  assert.doesNotMatch(fn, /path\.join\(tcdbDir, fileName\)/, 'the 1.x copy over <default folder>/<same name> is gone');
});
