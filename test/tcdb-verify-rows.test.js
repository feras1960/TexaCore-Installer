'use strict';
// tcdb-verify: an empty table (pg_dump still writes its COPY block) is reported as empty, not "with data".
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSql, describeTableData } = require('../src/tcdb-verify');

const dump = [
  'CREATE TABLE public.customers (id uuid);',
  'CREATE TABLE public.suppliers (id uuid);',
  'CREATE TABLE public.companies (id uuid);',
  'COPY public.customers (id) FROM stdin;',
  'a1',
  'a2',
  'a3',
  '\\.',
  '',
  'COPY public.suppliers (id) FROM stdin;',
  '\\.',
  '',
].join('\n');

test('rows are counted per COPY block; an empty block is 0', () => {
  const a = analyzeSql(Buffer.from(dump));
  assert.deepEqual(a.criticalTables.customers, { copy: true, create: true, present: true, rows: 3 });
  assert.deepEqual(a.criticalTables.suppliers, { copy: true, create: true, present: true, rows: 0 });
  assert.deepEqual(a.criticalTables.companies, { copy: false, create: true, present: true, rows: 0 });
  assert.equal(a.criticalTables.tenants.present, false);
});

test('the message says what is really there', () => {
  const a = analyzeSql(Buffer.from(dump));
  assert.equal(describeTableData(a.criticalTables.customers), ' (مع بيانات — 3 صف)');
  assert.equal(describeTableData(a.criticalTables.suppliers), ' (فارغ — 0 صف)');
  assert.equal(describeTableData(a.criticalTables.companies), ' (هيكل فقط)');
});

test('a CRLF dump ends its COPY blocks too', () => {
  const a = analyzeSql(Buffer.from('COPY public.customers (id) FROM stdin;\r\nx\r\n\\.\r\nCOPY public.suppliers (id) FROM stdin;\r\n\\.\r\n'));
  assert.equal(a.criticalTables.customers.rows, 1);
  assert.equal(a.criticalTables.suppliers.rows, 0);
});

test('requiring the script does not run it', () => {
  assert.equal(typeof analyzeSql, 'function');
});
