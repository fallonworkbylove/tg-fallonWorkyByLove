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
  path.join(__dirname, '../services/lifeTexture.js'),
  'utf8',
);
check('rhythm uses isCoffeeOkHourMsk', /isCoffeeOkHourMsk/.test(src));
check('night detail without forced coffee', /чай\/сериал\/улица\/телефон/.test(src));

if (fails) {
  console.error('SMOKE_0mu_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mu_OK');
process.exit(0);
