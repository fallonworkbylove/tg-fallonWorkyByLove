#!/usr/bin/env node
'use strict';
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const gates = require('../services/softHumanGates');
const out = gates.fixSmokingSoftYes(
  'иногда могу попробовать',
  'куришь что-то?)',
);
check(
  'smoking soft-yes → hard no',
  out && !/попробовать/i.test(out) && /не|нет/i.test(out),
  out,
);

const keep = gates.fixSmokingSoftYes('не, вообще нет)', 'куришь?)');
check('hard no kept', /не,\s*вообще\s*нет/i.test(keep), keep);

const ignore = gates.fixSmokingSoftYes('иногда могу попробовать', 'как день?');
check('non-smoking keep soft', /попробовать/i.test(ignore), ignore);

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '../services/softHumanGates.js'),
  'utf8',
);
check('wired in wave0lo', /fixSmokingSoftYes\(out/.test(src));

if (fails) {
  console.error('SMOKE_0mm_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mm_OK');
process.exit(0);
