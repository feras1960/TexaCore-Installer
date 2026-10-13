'use strict';
// ════════════════════════════════════════════════════════════════
// baseline-store — where the installer reads the database baseline and its installer-owned SQL from.
//
//   packaged build : resources/baseline/baseline.bin (encrypted, src/baseline-pack.js) — decrypted IN MEMORY, handed to psql over stdin,
//                    never written to disk, never logged, dropped from memory when the install is done (release()).
//   development    : the plain files (baseline/*.sql|json in the repo, src/bootstrap/*.sql) — nothing is encrypted in git.
// The pin (BASELINE_PIN.json, plain: names, sizes, plaintext sha256) is checked against what the store actually holds.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { unpack, sha256 } = require('./baseline-pack');

const BOOTSTRAP_FILES = new Set(['local_extras.sql', 'reference_seed.sql']);

function openBaselineStore({ baselineDir, bootstrapDir, keyProvider = null }) {
  const blobPath = path.join(baselineDir, 'baseline.bin');
  const packed = fs.existsSync(blobPath);
  let entries = null;

  function load() {
    if (entries) return entries;
    const meta = JSON.parse(fs.readFileSync(path.join(baselineDir, 'PACKED.json'), 'utf8'));
    const blob = fs.readFileSync(blobPath);
    if (blob.length !== meta.blobBytes || sha256(blob) !== meta.blobSha256) throw new Error('baseline.bin differs from PACKED.json');
    const key = (keyProvider || require('./baseline-key.generated'))();
    entries = unpack(blob, key);
    return entries;
  }

  return {
    packed,
    has(name) {
      if (packed) return load().has(name);
      return fs.existsSync(path.join(BOOTSTRAP_FILES.has(name) ? bootstrapDir : baselineDir, name));
    },
    read(name) {
      if (packed) {
        const b = load().get(name);
        if (!b) throw new Error(`baseline entry ${name} is missing`);
        return b;
      }
      return fs.readFileSync(path.join(BOOTSTRAP_FILES.has(name) ? bootstrapDir : baselineDir, name));
    },
    /** Every file the pin lists is present with the pinned size and sha256. Returns problems[]. */
    verify(pin) {
      const problems = [];
      try {
        for (const [name, meta] of Object.entries((pin && pin.files) || {})) {
          if (!this.has(name)) { problems.push(`${name} missing`); continue; }
          const b = this.read(name);
          if (b.length !== meta.bytes) problems.push(`${name}: size ${b.length} != ${meta.bytes}`);
          else if (sha256(b) !== meta.sha256) problems.push(`${name}: sha256 differs from the pin`);
        }
        if (!pin || !pin.files || !pin.files['production_baseline.sql']) problems.push('pin does not list production_baseline.sql');
        for (const f of BOOTSTRAP_FILES) if (!this.has(f)) problems.push(`${f} missing`);
      } catch (e) { problems.push(e.message); }
      return problems;
    },
    /** Drop the decrypted copies (the next read decrypts again). */
    release() { entries = null; },
  };
}

module.exports = { openBaselineStore, BOOTSTRAP_FILES };
