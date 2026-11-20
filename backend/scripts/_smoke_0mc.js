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

const jf = require('../services/jobFlipAsk');
check('кем ты?', jf.isJobOccupationAsk('а кем ты?'));
check('кем работаешь compound', jf.isJobOccupationAsk('Ты так и не ответила вроде, кем работаешь?'));
check('not day ask', !jf.isJobOccupationAsk('чем занята сейчас?'));

check(
  'purge script',
  fs.existsSync(path.join(__dirname, '_purge_otvlekla_0mc.js')),
);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0MC_OK');
process.exit(0);
