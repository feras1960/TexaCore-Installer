'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const BackupManager = require('../src/backup-manager');

test('needsTrackingModeRepair: only a dump that COPIES fabric_materials without the tracking_mode column (a file older than 20270210v)', () => {
  const old = 'COPY public.fabric_materials (id, tenant_id, company_id, code, name_ar, is_roll_tracked, track_serial, track_batch) FROM stdin;\nrow\n\\.\n';
  const current = 'COPY public.fabric_materials (id, tenant_id, code, name_ar, tracking_mode, is_roll_tracked) FROM stdin;\nrow\n\\.\n';
  assert.equal(BackupManager.needsTrackingModeRepair(old), true);
  assert.equal(BackupManager.needsTrackingModeRepair(current), false, 'a file that carries the column carries the modes the user chose');
  assert.equal(BackupManager.needsTrackingModeRepair('COPY public.customers (id, name) FROM stdin;\n\\.\n'), false, 'no fabric_materials at all');
  assert.equal(BackupManager.needsTrackingModeRepair(''), false);
  assert.equal(BackupManager.needsTrackingModeRepair(null), false);
  assert.equal(BackupManager.needsTrackingModeRepair('COPY public.fabric_materials_extra (id) FROM stdin;\n\\.\n'), false, 'another table with a similar name');
});

test('the repair is the server\'s own: SET tracking_mode = NULL on cards that carry a legacy flag or a fabric/service type, only where the mode is the default "quantity"', async () => {
  const bm = Object.create(BackupManager.prototype);
  const seen = [];
  bm._queryScalar = async (sql) => { seen.push(sql); return /information_schema/.test(sql) ? 't\n' : '7\n'; };
  assert.equal(await bm._repairTrackingModes(), 7);
  assert.match(seen[1], /UPDATE public\.fabric_materials SET tracking_mode = NULL WHERE tracking_mode = 'quantity' AND \(material_type = 'fabric' OR is_roll_tracked OR track_serial OR track_batch OR material_type = 'service'\)/);
  const none = Object.create(BackupManager.prototype);
  none._queryScalar = async () => 'f\n';
  assert.equal(await none._repairTrackingModes(), 0, 'a database without the column: nothing to do');
});
