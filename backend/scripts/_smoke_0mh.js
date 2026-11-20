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

const soft = require('../services/softHumanLite');
const ts = require('../services/timeStyle');
check('export stripNightCoffee', typeof soft.stripNightCoffeeClaim === 'function');

if (ts.isEveningOrNightMsk()) {
  const out = soft.stripNightCoffeeClaim('слушай, ничего особенного, кофе пью)');
  check('night strips coffee', out && !/кофе/i.test(out), out);
} else {
  const out = soft.stripNightCoffeeClaim('кофе пью)');
  check('day keeps coffee', /кофе/i.test(out), out);
}

const src = require('fs').readFileSync(
  require('path').join(__dirname, '../services/softHumanLite.js'),
  'utf8',
);
check('wired in applySoftLite', /stripNightCoffeeClaim\(out\)/.test(src));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0MH_OK');
process.exit(0);
