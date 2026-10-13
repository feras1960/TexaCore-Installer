#!/usr/bin/env node
'use strict';
// make-eula — ONE source text per language (build/eula/eula.en.txt, eula.ar.txt) → the three files electron-builder uses:
//   build/license_en.txt, build/license_ar.txt   the dmg's licence screen (shown in the user's language; English otherwise)
//   build/eula.rtf                                the NSIS installer's licence page (English, then Arabic right-to-left, Unicode)
// Run by prebuild-checks (and committed, so the text can be read in git). The two mandated clauses are verified verbatim.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

const CLAUSE_EN = 'You may not decompile, disassemble or reverse engineer the software or any part of it, extract its code, database structure or logic, or copy, modify, redistribute or use it to build a competing product, except to the extent expressly permitted by applicable law.';
const CLAUSE_AR = 'لا يجوز فكّ البرنامج أو تفكيكه أو عكس هندسته، كلّه أو أي جزء منه، ولا استخراج شيفرته أو هيكل قاعدة بياناته أو منطقه، ولا نسخه أو تعديله أو إعادة توزيعه أو استخدامه لبناء منتج منافس، إلا بالقدر الذي يسمح به القانون صراحةً.';

const rtfEscape = (s) => Array.from(s).map((ch) => {
  const c = ch.codePointAt(0);
  if (ch === '\\' || ch === '{' || ch === '}') return `\\${ch}`;
  if (c < 128) return ch;
  const n = c > 0xffff ? null : (c > 32767 ? c - 65536 : c);
  if (n === null) return Array.from(Buffer.from(ch, 'utf16le')).length ? ch : '?';   // not used in this text (BMP only)
  return `\\u${n}?`;
}).join('');

function paragraphsOf(text) { return text.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean); }

function build() {
  const en = fs.readFileSync(path.join(BUILD, 'eula', 'eula.en.txt'), 'utf8');
  const ar = fs.readFileSync(path.join(BUILD, 'eula', 'eula.ar.txt'), 'utf8');
  if (!en.includes(CLAUSE_EN)) throw new Error('the English source lacks the mandated clause verbatim');
  if (!ar.includes(CLAUSE_AR)) throw new Error('the Arabic source lacks the mandated clause verbatim');
  fs.writeFileSync(path.join(BUILD, 'license_en.txt'), en);
  fs.writeFileSync(path.join(BUILD, 'license_ar.txt'), ar);
  const rtf = ['{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Segoe UI;}{\\f1\\fnil\\fcharset178 Segoe UI;}}\\fs20'];
  paragraphsOf(en).forEach((p, i) => rtf.push(`\\pard\\ltrpar\\ql${i === 0 ? '\\b' : ''}\\f0 ${rtfEscape(p)}${i === 0 ? '\\b0' : ''}\\par\\par`));
  rtf.push('\\pard\\ql\\f0 ------------------------------------------------------------\\par\\par');
  paragraphsOf(ar).forEach((p, i) => rtf.push(`\\pard\\rtlpar\\qr${i === 0 ? '\\b' : ''}\\f1 ${rtfEscape(p)}${i === 0 ? '\\b0' : ''}\\par\\par`));
  rtf.push('}');
  fs.writeFileSync(path.join(BUILD, 'eula.rtf'), rtf.join('\n') + '\n');
  return { en: en.length, ar: ar.length };
}

module.exports = { build, CLAUSE_EN, CLAUSE_AR, rtfEscape, paragraphsOf };
if (require.main === module) { const r = build(); console.log(`make-eula: license_en.txt (${r.en} chars), license_ar.txt (${r.ar}), eula.rtf written`); }
