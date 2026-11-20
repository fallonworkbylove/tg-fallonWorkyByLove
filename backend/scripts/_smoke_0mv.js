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
  path.join(__dirname, '../services/replyPipeline.js'),
  'utf8',
);
check('reaction fallback time-aware', /isCoffeeOkHourMsk/.test(src));
check('night fallback сериал', /сериал фоном, туплю/.test(src));
check(
  'coffee fallback only in coffeeOk branch',
  /coffeeOk\s*\n?\s*\?\s*\n?\s*'кофе остыл/.test(src) ||
    /coffeeOk[\s\S]{0,80}кофе остыл/.test(src),
);

if (fails) {
  console.error('SMOKE_0mv_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mv_OK');
process.exit(0);
