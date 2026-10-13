'use strict';
// The splitter lives in src/ (the installer needs it at run time for the selective second pass of the baseline load); build scripts and tests use this path.
module.exports = require('../../src/sql-split');
