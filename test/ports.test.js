'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePorts } = require('../src/ports');

test('defaults are the historical ports', () => {
  assert.deepEqual(resolvePorts({}), { custom: false, pg: 54322, postgrest: 3000, gotrue: 9999, api: 54321, ui: 80, admin: 1960 });
});
test('TEXACORE_PORT_BASE gives one contiguous block', () => {
  assert.deepEqual(resolvePorts({ TEXACORE_PORT_BASE: '47391' }), { custom: true, pg: 47391, postgrest: 47392, gotrue: 47393, api: 47394, ui: 47395, admin: 47396 });
});
test('a base outside 1024..65000 is refused', () => {
  for (const bad of ['80', 'abc', '70000', '1.5']) assert.throws(() => resolvePorts({ TEXACORE_PORT_BASE: bad }));
});
