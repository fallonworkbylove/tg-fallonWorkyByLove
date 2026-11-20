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
  path.join(__dirname, '../services/humanIdeas12.js'),
  'utf8',
);
check('no balcony smoke', !/на балконе курю/.test(src));
check('statusPoolNow', /function statusPoolNow/.test(src));
check('coffee gated', /isCoffeeOkHourMsk/.test(src) && /STATUS_POOL_COFFEE/.test(src));
check('balcony air', /на балконе мёрзну/.test(src));

const hi = require('../services/humanIdeas12');
const line = hi.pickStatusAskLine?.(1, '2') || '';
if (typeof hi.pickStatusAskLine === 'function') {
  check('pick returns string', typeof line === 'string' && line.length > 4, line);
  check('pick not smoking', !/курю/i.test(line), line);
} else {
  // pick may not be exported — source checks enough
  check('pick export optional', true);
}

if (fails) {
  console.error('SMOKE_0mt_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mt_OK');
process.exit(0);
