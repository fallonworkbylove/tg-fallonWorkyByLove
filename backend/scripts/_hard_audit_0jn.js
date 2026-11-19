#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let fail = 0;
function check(name, cond, d = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, d);
  }
}
const smoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_opt_0jn.js')], {
  encoding: 'utf8',
  timeout: 20_000,
});
check('smoke', smoke.status === 0, (smoke.stdout || smoke.stderr || '').slice(-300));
check('age', /LIMIT 400/.test(read('services/history.js')));
check('work', /workMin/.test(read('services/nftCampaign.js')));
check('watch', !/INTERVAL \? MINUTE/.test(read('services/opsQuality.js')));
check('changelog', /^## 0jn\./m.test(read('../CHANGELOG_TG.md')));
check('v194', /updates\.js\?v=194/.test(read('../frontend/index.html')));
if (fail) {
  console.error('HARD_AUDIT_0JN_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0JN_OK');
process.exit(0);
