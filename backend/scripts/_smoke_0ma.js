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

const soft = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
check('silence complaint hint', /не\\s\+ответил/.test(soft) || /не\s+ответил/.test(soft));
check('oy sorri hint', /ой сорри, отвлеклась/.test(soft));

const ld = fs.readFileSync(path.join(__dirname, '../services/learningDb.js'), 'utf8');
check('learning reject прикольно', /прикольно\|норм\|о как/.test(ld));
check('learning reject ну бывает', /ну бывает/.test(ld));

const opsIdx = fs.readFileSync(path.join(__dirname, '../../ops-console/app/index.html'), 'utf8');
check('ops updates v267', /updates\.js\?v=267/.test(opsIdx));
const feIdx = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
check('fe updates v267', /updates\.js\?v=267/.test(feIdx));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0MA_OK');
process.exit(0);
