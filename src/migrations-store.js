'use strict';
// ════════════════════════════════════════════════════════════════
// migrations-store — where the installer reads the incremental migrations (2.0.2+) from.
//
//   packaged build : resources/baseline/migrations.bin — the SAME encrypted TXB1 container format and the SAME per-build key as the baseline
//                    (src/baseline-pack.js, src/baseline-key.generated.js); entries: migrations.json + every <file>.sql. Decrypted IN MEMORY, handed to psql over stdin,
//                    never written to disk, never logged; release() drops the copies. The package carries NO plaintext migration.
//   development    : the git-ignored build output ./migrations (scripts/sync-migrations.js) — plain files, nothing encrypted.
// A separate (small) container, not part of baseline.bin: the migrations are consulted on EVERY start, the baseline only on a first run.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { unpack, sha256 } = require('./baseline-pack');

const BLOB = 'migrations.bin';
const META = 'MIGRATIONS_PACKED.json';
const FILE_RE = /^[A-Za-z0-9_.-]+\.sql$/;

function safeName(file) {
  if (typeof file !== 'string' || !FILE_RE.test(file) || file.includes('..')) throw new Error(`not a migration file name: ${String(file).slice(0, 80)}`);
  return file;
}

/** The plain-files store: a folder with migrations.json and the .sql files (development, and the unit tests' fake folders). */
function dirStore(dir) {
  return {
    packed: false,
    available() { return !!dir && fs.existsSync(path.join(dir, 'migrations.json')); },
    manifest() {
      if (!this.available()) return null;
      return JSON.parse(fs.readFileSync(path.join(dir, 'migrations.json'), 'utf8'));
    },
    read(file) {
      const f = path.join(dir, safeName(file));
      if (!fs.existsSync(f)) throw new Error(`File not found: ${file}`);
      return fs.readFileSync(f);
    },
    release() { /* nothing held */ },
  };
}

/**
 * @param {string}   o.packedDir    the folder holding migrations.bin + MIGRATIONS_PACKED.json (resources/baseline)
 * @param {string}   [o.devDir]     the plain folder to fall back to when nothing is packed (development only; pass null in a packaged app)
 * @param {Function} [o.keyProvider] () => Buffer(32); default: the build's generated key module (the one the baseline uses)
 */
function openMigrationsStore({ packedDir, devDir = null, keyProvider = null }) {
  const blobPath = path.join(packedDir, BLOB);
  if (!fs.existsSync(blobPath)) return dirStore(devDir);
  let entries = null;

  function load() {
    if (entries) return entries;
    const meta = JSON.parse(fs.readFileSync(path.join(packedDir, META), 'utf8'));
    const blob = fs.readFileSync(blobPath);
    if (blob.length !== meta.blobBytes || sha256(blob) !== meta.blobSha256) throw new Error(`${BLOB} differs from ${META}`);
    const key = (keyProvider || require('./baseline-key.generated'))();
    entries = unpack(blob, key);
    return entries;
  }

  return {
    packed: true,
    available() { return true; },
    manifest() {
      const b = load().get('migrations.json');
      if (!b) throw new Error('the migrations container carries no migrations.json');
      return JSON.parse(b.toString('utf8'));
    },
    read(file) {
      const b = load().get(safeName(file));
      if (!b) throw new Error(`File not found: ${file}`);
      return b;
    },
    /** Drop the decrypted copies (the next read decrypts again). */
    release() { entries = null; },
  };
}

module.exports = { openMigrationsStore, dirStore, BLOB, META, FILE_RE };
