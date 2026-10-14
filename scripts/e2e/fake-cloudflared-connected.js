#!/usr/bin/env node
'use strict';
// A stand-in for cloudflared that REGISTERS tunnel connections like the real one (TEXACORE_CLOUDFLARED_BIN, isolated harness runs only): the connector is "healthy" and
// the launcher sees «Registered tunnel connection» — exactly the situation of the 2.0.1 field bug (cloudflared connected for hours while the public name answered Cloudflare 1033).
// It records how it was started (the token arrives in the environment, never in argv). Nothing here talks to Cloudflare.
const fs = require('fs');
if (process.argv.includes('--version')) { console.log('cloudflared version 2026.10.0 (stand-in, registers connections)'); process.exit(0); }
const out = process.env.FAKE_CF_OUT;
if (out) {
  let runs = [];
  try { runs = JSON.parse(fs.readFileSync(out, 'utf8')).runs || []; } catch { /* first run */ }
  runs.push({ at: Date.now(), argv: process.argv.slice(2), tunnelToken: process.env.TUNNEL_TOKEN || null, pid: process.pid });
  fs.writeFileSync(out, JSON.stringify({ runs }));
}
const ts = () => new Date().toISOString();
for (let i = 0; i < 4; i++) console.log(`${ts()} INF Registered tunnel connection connIndex=${i} connection=00000000-0000-4000-8000-00000000000${i} event=0 ip=198.41.200.${10 + i} location=fra0${i} protocol=quic`);
setInterval(() => {}, 1 << 30);
process.on('SIGTERM', () => process.exit(0));
