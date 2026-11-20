#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const hh = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
check('phrase ban min len 4', /n\.length < 4/.test(hh));
check('nu ok echo break', /nuOkN/.test(hh) && /норм\)/.test(hh));
check('purge script', fs.existsSync(path.join(__dirname, '_purge_short_patterns_0m3.js')));

const soft = require('../services/softHumanLite');
const out = soft.ensureAckNotBare('мм)', 'что делаешь?');
check('ensureAck мм)', out && out !== 'мм)', out);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M3_OK');
process.exit(0);
