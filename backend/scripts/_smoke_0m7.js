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

const hlSrc = fs.readFileSync(path.join(__dirname, '../services/howLong.js'), 'utf8');
check('assertHowLongMarkers', /assertHowLongMarkers/.test(hlSrc));
check('fixed template in src', /давно на дв\? или только/.test(hlSrc));
check('no broken template', !/давно на дв или недавно\?/.test(hlSrc));
check('lazy bufferKey', /require\('\.\/inbound'\)\.bufferKey/.test(hlSrc));

const hl = require('../services/howLong');
for (let i = 0; i < 50; i++) {
  const q = hl.buildHowLongQuestion();
  if (!hl.isHowLongQuestion(q)) {
    check('howLong marker runtime', false, q);
    break;
  }
}
check('howLong markers runtime', true);
check('old broken undetectable', !hl.isHowLongQuestion('а ты давно на дв или недавно?'));

const ms = fs.readFileSync(path.join(__dirname, '../services/mediaSend.js'), 'utf8');
check('mediaSend uses retry', /downloadMediaWithRetry/.test(ms));

const inbound = fs.readFileSync(path.join(__dirname, '../services/inbound.js'), 'utf8');
check('retry exported', /downloadMediaWithRetry,/.test(inbound));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M7_OK');
process.exit(0);
