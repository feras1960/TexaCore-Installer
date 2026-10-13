'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const mkdtemp = (p = 'tcx-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
module.exports = { mkdtemp, sha };
