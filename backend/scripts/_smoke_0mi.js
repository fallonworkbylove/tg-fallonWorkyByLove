#!/usr/bin/env node
'use strict';

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const jf = require('../services/jobFlipAsk');
check('зарабатываешь', jf.isJobOccupationAsk('а чем ты зарабатываешь?'));
check('на что живёшь', jf.isJobOccupationAsk('ну и на что живёшь?'));
check('not hobby', !jf.isJobOccupationAsk('чем увлекаешься?'));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0MI_OK');
process.exit(0);
