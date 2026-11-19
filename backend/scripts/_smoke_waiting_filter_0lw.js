#!/usr/bin/env node
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

const src = fs.readFileSync(
  path.join(__dirname, '../services/opsQuality.js'),
  'utf8',
);
check('waiting excludes archived', /archived_peers ap/.test(src) && /ap\.peer_id IS NULL/.test(src));
check(
  'waiting excludes filtered+operator',
  /NOT IN \('filtered','operator'\)/.test(src) || /funnel_stage <> 'filtered'/.test(src),
);
check('waiting excludes operator', /'operator'/.test(src));
check('waiting skips call', /бери/.test(src) && /трубку/.test(src));
check('waiting skips пока', /пока\|ппк/.test(src) && /спокойной/.test(src));
check('waiting skips dots', /NOT REGEXP '\^\[\.!\?…\]\+\$'/.test(src) || /\^\[.!\?…\]\+\$/.test(src));
check('still alerts threshold 3', /n < 3/.test(src));

const sil = fs.readFileSync(
  path.join(__dirname, '../services/silenceCatchup.js'),
  'utf8',
);
check('heal short cool on deferred', /silence-heal: в очереди\/Занята/.test(sil));
check('heal skip lone dots', /\[\.!\?…\]\+\$/.test(sil));
check('silence excludes operator', /NOT IN \('filtered','operator'\)/.test(sil));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_WAITING_FILTER_0LW_OK');
