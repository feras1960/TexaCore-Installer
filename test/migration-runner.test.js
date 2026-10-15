'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const MigrationRunner = require('../src/migration-runner');
const { mkdtemp, sha } = require('./helpers');

// a migrations folder + a fake database: psqlExec records every script and answers the "applied" query from `state.applied`
function setup(files, { failOn = null, applied = [] } = {}) {
  const dir = mkdtemp('mig-');
  const list = files.map((f, i) => {
    fs.writeFileSync(path.join(dir, f.file), f.sql);
    return { order: i + 1, name: f.name, file: f.file, sha256: f.sha256 === undefined ? sha(Buffer.from(f.sql)) : f.sha256 };
  });
  fs.writeFileSync(path.join(dir, 'migrations.json'), JSON.stringify({ baselineSha256: 'x', migrations: list }));
  const state = { ran: [], recorded: [...applied], logs: [] };
  const psqlExec = async (sql) => {
    if (/SELECT name FROM public\._texacore_migrations/.test(sql)) return ` name \n------\n${state.recorded.join('\n')}\n(${state.recorded.length} rows)\n`;
    const ins = /INSERT INTO public\._texacore_migrations \(name[^]*?VALUES \('([^']+)'/.exec(sql);
    if (ins) { state.recorded.push(ins[1]); return ''; }
    if (/IF NOT EXISTS public\._texacore_migrations/.test(sql)) return '';
    state.ran.push(sql);
    if (failOn && sql.includes(failOn)) throw new Error('psql(3): ERROR:  relation "nope" does not exist');
    return '';
  };
  const runner = new MigrationRunner({ psqlExec, migrationsDir: dir, log: (level, msg) => state.logs.push(`${level}: ${msg}`) });
  return { runner, state, dir };
}

const F = (n, body = 'BEGIN;\nSELECT 1;\nCOMMIT;') => ({ name: `20270210${n}_x`, file: `20270210${n}_x.sql`, sql: `-- ${n}\n${body}\n` });

test('applies the pending migrations in MANIFEST order and records each name', async () => {
  const { runner, state } = setup([F('i'), F('q'), F('m')]);
  const r = await runner.runAll();
  assert.equal(r.applied, 3); assert.equal(r.failed, 0);
  assert.deepEqual(state.recorded, ['20270210i_x', '20270210q_x', '20270210m_x']);
  assert.deepEqual(state.ran.map((s) => s.split('\n')[0]), ['-- i', '-- q', '-- m']);
});

test('skips what is already recorded; a second run applies nothing', async () => {
  const { runner, state } = setup([F('i'), F('q')], { applied: ['20270210i_x'] });
  const r1 = await runner.runAll();
  assert.equal(r1.applied, 1);
  assert.deepEqual(state.ran.map((s) => s.split('\n')[0]), ['-- q']);
  const r2 = await runner.runAll();
  assert.equal(r2.applied, 0); assert.equal(r2.skipped, 2);
});

test('the FIRST failure stops the chain: later files are not run, nothing is recorded for the failed one (no __FAILED marker), the next run retries it', async () => {
  const { runner, state } = setup([F('i'), F('q', 'BEGIN;\nSELECT nope;\nCOMMIT;'), F('m')], { failOn: 'SELECT nope' });
  const r = await runner.runAll();
  assert.equal(r.applied, 1); assert.equal(r.failed, 1); assert.equal(r.stoppedAt, '20270210q_x');
  assert.deepEqual(state.recorded, ['20270210i_x'], 'only the file that succeeded is recorded');
  assert.ok(!state.recorded.some((n) => n.includes('__FAILED')));
  assert.ok(!state.ran.some((s) => s.startsWith('-- m')), 'the chain stopped: the third file never ran');
  assert.match(state.logs.join('\n'), /error: .*20270210q_x — FAILED/);
  assert.match(state.logs.join('\n'), /stopped at 20270210q_x; 1 later migration/);
  // fixed (the failure no longer triggers): the next run picks up exactly where it stopped
  const state2 = state;
  const again = await new MigrationRunner({ psqlExec: async (sql) => { if (/SELECT name FROM/.test(sql)) return ` name \n----\n${state2.recorded.join('\n')}\n(1 row)\n`; const m = /VALUES \('([^']+)'/.exec(sql); if (m) state2.recorded.push(m[1]); return ''; }, store: runner.store, log: () => {} }).runAll();
  assert.equal(again.applied, 2);
});

test('a file that differs from the manifest sha256 is refused and never executed', async () => {
  const { runner, state } = setup([F('i'), { ...F('q'), sha256: 'deadbeef' }]);
  const r = await runner.runAll();
  assert.equal(r.applied, 1); assert.equal(r.stoppedAt, '20270210q_x');
  assert.match(r.errors[0].error, /differs from the manifest/);
  assert.equal(state.ran.length, 1);
});

test('a listed file that is missing stops the chain', async () => {
  const { runner, state, dir } = setup([F('i'), F('q')]);
  fs.rmSync(path.join(dir, '20270210q_x.sql'));
  const r = await runner.runAll();
  assert.equal(r.applied, 1); assert.equal(r.failed, 1); assert.match(r.errors[0].error, /File not found/);
  assert.deepEqual(state.recorded, ['20270210i_x']);
});

// the >100 KB path runs a dedicated psql fed over STDIN (`-f -`): a failing psql (non-zero exit) must be a FAILURE (2.0.1's code ran it with ON_ERROR_STOP=0 and counted it a success),
// and the SQL must never be written to a temp file
const big = 'BEGIN;\n' + '-- padding\n'.repeat(12000) + 'SELECT 1;\nCOMMIT;';
function fakePsql(code, stderr, capture = null) {
  const bin = mkdtemp('fakepg-');
  fs.writeFileSync(path.join(bin, 'psql'), `#!/bin/sh\n${capture ? `echo "$@" > '${capture}.args'\ncat > '${capture}.stdin'\n` : ''}${stderr ? `echo '${stderr}' >&2\n` : ''}exit ${code}\n`, { mode: 0o755 });
  return bin;
}
test('a big file (psql over stdin): a non-zero psql exit is a failure with the ERROR line in the message; exit 0 is success', { skip: process.platform === 'win32' }, async () => {
  for (const [code, ok] of [[3, false], [0, true]]) {
    const { state, dir } = setup([{ ...F('r', big) }]);
    const runner = new MigrationRunner({ psqlExec: async (sql) => { const m = /VALUES \('([^']+)'/.exec(sql); if (m) state.recorded.push(m[1]); if (/SELECT name FROM/.test(sql)) return ''; return ''; },
      pgBin: fakePsql(code, 'psql:<stdin>:42: ERROR:  column "q" does not exist'), migrationsDir: dir, log: (l, m) => state.logs.push(m) });
    const r = await runner.runAll();
    if (ok) { assert.equal(r.applied, 1); assert.deepEqual(state.recorded, ['20270210r_x']); }
    else { assert.equal(r.applied, 0); assert.equal(r.failed, 1); assert.match(r.errors[0].error, /psql\(3\).*column "q" does not exist/); assert.deepEqual(state.recorded, []); }
  }
});
test('a big file: the SQL reaches psql over stdin (-f -), byte for byte, and no temp file with it is ever written', { skip: process.platform === 'win32' }, async () => {
  const os = require('os');
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => /^texacore_migration_/.test(n)));
  const cap = path.join(mkdtemp('cap-'), 'c');
  const { state, dir } = setup([{ ...F('r', big) }]);
  const runner = new MigrationRunner({ psqlExec: async (sql) => { const m = /VALUES \('([^']+)'/.exec(sql); if (m) state.recorded.push(m[1]); return ''; }, pgBin: fakePsql(0, '', cap), migrationsDir: dir, log: () => {} });
  const r = await runner.runAll();
  assert.equal(r.applied, 1);
  assert.match(fs.readFileSync(`${cap}.args`, 'utf8'), /ON_ERROR_STOP=1.* -f -\s*$/);
  assert.equal(fs.readFileSync(`${cap}.stdin`, 'utf8'), `-- r\n${big}\n`);
  const after = fs.readdirSync(os.tmpdir()).filter((n) => /^texacore_migration_/.test(n) && !before.has(n));
  assert.deepEqual(after, [], 'no temp file with migration SQL');
});

test('a failure message carries psql\'s ERROR lines only - never the quoted statement', async () => {
  const { runner, state } = setup([F('i', 'BEGIN;\nSELECT 1;\nCOMMIT;')], { failOn: 'SELECT 1' });
  runner.psqlExec = async (sql) => { if (/SELECT name FROM/.test(sql)) return ' name \n---\n(0 rows)\n'; if (/_texacore_migrations/.test(sql)) return ''; throw new Error('psql(3): psql:<stdin>:3: ERROR:  syntax error at or near "x"\nLINE 1: SELECT secret_table_name FROM hidden_schema.t\n               ^'); };
  const r = await runner.runAll();
  assert.equal(r.failed, 1);
  assert.match(r.errors[0].error, /psql\(3\): psql:<stdin>:3: ERROR: syntax error/);
  assert.doesNotMatch(r.errors[0].error + state.logs.join('\n'), /secret_table_name|hidden_schema/);
});

test('the runner source has no "continue after a failed migration" path, never writes a __FAILED marker and never writes the SQL to disk', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'migration-runner.js'), 'utf8');
  assert.doesNotMatch(src, /__FAILED/);
  assert.doesNotMatch(src, /ON_ERROR_STOP=0/);
  assert.match(src, /ON_ERROR_STOP=1/);
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /writeFileSync|tmpdir|createWriteStream/, 'the decrypted SQL is never written to a file');
});

// the packaged app reads the migrations from the encrypted container (src/migrations-store.js): the same runner, the same sha256 check
test('the runner applies migrations from the ENCRYPTED container; a manifest sha256 that does not match the container\'s file is refused; release() is called', async () => {
  const crypto = require('crypto');
  const { pack } = require('../src/baseline-pack');
  const { openMigrationsStore } = require('../src/migrations-store');
  const key = crypto.randomBytes(32);
  const files = [F('i'), F('q'), F('m')];
  const man = (bad) => ({ baselineSha256: 'x', migrations: files.map((f, i) => ({ order: i + 1, name: f.name, file: f.file, sha256: bad && i === 1 ? 'deadbeef' : sha(Buffer.from(f.sql)) })) });
  for (const bad of [false, true]) {
    const dir = mkdtemp('packed-');
    const blob = pack([{ name: 'migrations.json', data: Buffer.from(JSON.stringify(man(bad))) }, ...files.map((f) => ({ name: f.file, data: Buffer.from(f.sql) }))], key);
    fs.writeFileSync(path.join(dir, 'migrations.bin'), blob);
    fs.writeFileSync(path.join(dir, 'MIGRATIONS_PACKED.json'), JSON.stringify({ blobBytes: blob.length, blobSha256: sha(blob) }));
    for (const f of fs.readdirSync(dir)) assert.doesNotMatch(f, /\.sql$/, 'no plain SQL file beside the container');
    const state = { ran: [], recorded: [] };
    const psqlExec = async (sql) => {
      if (/SELECT name FROM public\._texacore_migrations/.test(sql)) return ` name \n-----\n${state.recorded.join('\n')}\n`;
      const ins = /VALUES \('([^']+)'/.exec(sql); if (ins) { state.recorded.push(ins[1]); return ''; }
      if (/_texacore_migrations/.test(sql)) return '';
      state.ran.push(sql); return '';
    };
    const store = openMigrationsStore({ packedDir: dir, keyProvider: () => key });
    assert.equal(store.packed, true);
    const r = await new MigrationRunner({ psqlExec, store, log: () => {} }).runAll();
    if (!bad) { assert.equal(r.applied, 3); assert.deepEqual(state.recorded, ['20270210i_x', '20270210q_x', '20270210m_x']); }
    else { assert.equal(r.applied, 1); assert.equal(r.stoppedAt, '20270210q_x'); assert.match(r.errors[0].error, /differs from the manifest/); assert.equal(state.ran.length, 1); }
  }
});
