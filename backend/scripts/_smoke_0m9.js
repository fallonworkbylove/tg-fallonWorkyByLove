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

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
check('directAskSkipBusy', /directAskSkipBusy/.test(pipe));
check('jobFlip in defer gate', /isJobOccupationAsk/.test(pipe) && /isWhyHereAsk/.test(pipe));

const sil = fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8');
check('directAskEarly heal', /directAskEarly/.test(sil));
check('heal cool 8м on ask', /mediaSeedEarly \|\| directAskEarly/.test(sil));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M9_OK');
process.exit(0);
