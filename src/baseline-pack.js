'use strict';
// ════════════════════════════════════════════════════════════════
// baseline-pack — the container the packaged app carries INSTEAD of plain SQL files.
//
//   "TXB1" | iv(12) | auth tag(16) | AES-256-GCM( gzip( u32 indexLength | index JSON | file bodies … ) )
//
// Compress first, then encrypt (GCM authenticates the whole thing and the magic as AAD). The index lists every file with its size and
// sha256, so a successful unpack is also a proof that each file is exactly what was packed. The key is derived at build time into
// src/baseline-key.generated.js (random fragments, never committed) — see scripts/pack-baseline.js.
// Pure functions: used by the build script, the runtime store, the afterPack gate and the tests.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const zlib = require('zlib');

const MAGIC = Buffer.from('TXB1');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** entries: [{ name, data: Buffer }] → Buffer (the blob) */
function pack(entries, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('baseline key must be 32 bytes');
  const names = new Set();
  for (const e of entries) { if (names.has(e.name)) throw new Error(`duplicate entry ${e.name}`); names.add(e.name); }
  const index = Buffer.from(JSON.stringify(entries.map((e) => ({ name: e.name, bytes: e.data.length, sha256: sha256(e.data) }))));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(index.length);
  const plain = zlib.gzipSync(Buffer.concat([head, index, ...entries.map((e) => e.data)]), { level: 9 });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

/** blob + key → Map(name → Buffer). Throws on a wrong key, a tampered byte, or any entry whose sha256 differs from the index. */
function unpack(blob, key) {
  if (!Buffer.isBuffer(blob) || blob.length < 40 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('not a TexaCore baseline container');
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  d.setAAD(MAGIC);
  d.setAuthTag(blob.subarray(16, 32));
  let plain;
  try { plain = zlib.gunzipSync(Buffer.concat([d.update(blob.subarray(32)), d.final()])); }
  catch { throw new Error('the baseline container does not decrypt (wrong key or damaged file)'); }
  const n = plain.readUInt32LE(0);
  const index = JSON.parse(plain.subarray(4, 4 + n).toString('utf8'));
  const out = new Map();
  let off = 4 + n;
  for (const e of index) {
    const data = plain.subarray(off, off + e.bytes);
    off += e.bytes;
    if (data.length !== e.bytes || sha256(data) !== e.sha256) throw new Error(`entry ${e.name} fails its checksum`);
    out.set(e.name, Buffer.from(data));
  }
  return out;
}

module.exports = { MAGIC, pack, unpack, sha256 };
