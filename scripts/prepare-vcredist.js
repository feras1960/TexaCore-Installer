#!/usr/bin/env node
'use strict';
// prepare-vcredist — put Microsoft's vc_redist.x64.exe into build/vcredist so the Windows installer carries it
// (build/installer.nsh runs it silently when the PC lacks the Visual C++ 2015-2022 x64 runtime that PostgreSQL needs).
//   node scripts/prepare-vcredist.js <vc_redist.x64.exe>      source: https://aka.ms/vs/17/release/vc_redist.x64.exe  (~18-25 MB)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('usage: node scripts/prepare-vcredist.js <vc_redist.x64.exe>'); process.exit(2); }
const buf = fs.readFileSync(src);
if (buf.readUInt16LE(0) !== 0x5a4d || buf.length < 5e6 || buf.length > 6e7) { console.error('this does not look like vc_redist.x64.exe (a Windows executable of 5-60 MB)'); process.exit(2); }
if (!buf.toString('latin1').includes('Microsoft Corporation')) { console.error('no "Microsoft Corporation" in the file — refusing'); process.exit(2); }
const dest = path.join(__dirname, '..', 'build', 'vcredist', 'vc_redist.x64.exe');
fs.copyFileSync(src, dest);
console.log(`  OK: ${path.relative(path.join(__dirname, '..'), dest)} (${buf.length} bytes, sha256 ${crypto.createHash('sha256').update(buf).digest('hex')})`);
