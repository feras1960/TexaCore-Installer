'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const BackupManager = require('../src/backup-manager');

test('dumpedFromMajor reads the PostgreSQL major that wrote a plain dump', () => {
  assert.equal(BackupManager.dumpedFromMajor('--\n-- PostgreSQL database dump\n--\n\n-- Dumped from database version 15.17\n-- Dumped by pg_dump version 15.17\n'), 15);
  assert.equal(BackupManager.dumpedFromMajor('-- Dumped from database version 17.6\n'), 17);
  assert.equal(BackupManager.dumpedFromMajor('-- Dumped from database version 16.2 (Homebrew)\n'), 16);
  assert.equal(BackupManager.dumpedFromMajor('SELECT 1;'), null);
  assert.equal(BackupManager.dumpedFromMajor(Buffer.from('-- Dumped from database version 15.4\n')), 15);
});

test('legacyFileError: a coded, bilingual refusal (the windows translate by code)', () => {
  const e = BackupManager.legacyFileError(15);
  assert.equal(e.code, 'LEGACY_TCDB'); assert.equal(e.dumpedFromMajor, 15);
  assert.match(e.message, /1\.x/); assert.match(e.message, /PostgreSQL 15/); assert.match(e.message, /cannot be opened in 2\.0/); assert.match(e.message, /لا يمكن فتحه في 2\.0/);
});
