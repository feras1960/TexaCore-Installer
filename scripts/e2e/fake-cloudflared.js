#!/usr/bin/env node
'use strict';
// A stand-in for cloudflared in the release check (TEXACORE_CLOUDFLARED_BIN, isolated harness runs only): records how it was started, then idles like a tunnel.
// The check asserts that the tunnel token arrives through the environment (TUNNEL_TOKEN) and is NOT in the command line.
const fs = require('fs');
// the launcher asks every cloudflared for its version before starting it (2.0.1: «does the binary run here?»): answer like the real one and exit, record nothing
if (process.argv.includes('--version')) { console.log('cloudflared version 2026.10.0 (stand-in, built from none)'); process.exit(0); }
const out = process.env.FAKE_CF_OUT;
if (out) fs.writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2), tunnelTokenInEnv: process.env.TUNNEL_TOKEN || null, pid: process.pid }));
setInterval(() => {}, 1 << 30);
process.on('SIGTERM', () => process.exit(0));
