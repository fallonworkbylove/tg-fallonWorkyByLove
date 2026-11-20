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
  path.join(__dirname, '_hard_audit_full_0ht.js'),
  'utf8',
);
check('includes wave 0m1', /_smoke_wave_0m1\.js/.test(src));
check('includes wave 0m2', /_smoke_wave_0m2\.js/.test(src));
check('includes 0ms', /_smoke_0ms\.js/.test(src));
check('includes 0mt', /_smoke_0mt\.js/.test(src));
check('includes 0mu', /_smoke_0mu\.js/.test(src));
check('includes 0mv', /_smoke_0mv\.js/.test(src));
check(
  'hard_audit_0m1 present',
  fs.existsSync(path.join(__dirname, '_hard_audit_0m1.js')),
);
check(
  'hard_audit_0m2 present',
  fs.existsSync(path.join(__dirname, '_hard_audit_0m2.js')),
);

if (fails) {
  console.error('SMOKE_0mw_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mw_OK');
process.exit(0);
