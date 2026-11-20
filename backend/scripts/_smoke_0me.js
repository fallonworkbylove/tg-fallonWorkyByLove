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

const hi = require('../services/humanIdeas10');
check('pool no отвлеклась', !hi.LIFE_LAG_PREFIXES.some((p) => /отвлеклась/i.test(p)));
for (let i = 0; i < 30; i++) {
  const p = hi.pickLifeLagPrefix();
  if (/отвлеклась/i.test(p)) {
    check('pick no отвлеклась', false, p);
    break;
  }
}
check('pick ok', true);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0ME_OK');
process.exit(0);
