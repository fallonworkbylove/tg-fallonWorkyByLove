#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const src = fs.readFileSync(
  path.join(__dirname, '../services/aiResponder.js'),
  'utf8',
);
check('moveSpamDayDetails', /function moveSpamDayDetails/.test(src));
check('uses isCoffeeOkHourMsk', /isCoffeeOkHourMsk/.test(src));
check('night tea alt', /чай пью\)/.test(src));
check('no static MOVE_SPAM_FALLBACKS coffee-only', !/const MOVE_SPAM_FALLBACKS/.test(src));
check(
  'rewrite uses details',
  /const details = moveSpamDayDetails\(\)/.test(src),
);

if (fails) {
  console.error('SMOKE_0mo_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mo_OK');
process.exit(0);
