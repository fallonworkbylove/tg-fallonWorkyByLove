#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = path.join(__dirname, '../..');
const read = (r) => fs.readFileSync(path.join(repo, r), 'utf8');
let p0 = 0;
function check(name, cond, d) {
  if (cond) console.log('OK ', name);
  else {
    p0 += 1;
    console.log('P0', name, d || '');
  }
}
check('gates 0m9', /applyWave0m9Gates|fixLeadShutDown/.test(read('backend/services/softHumanGates.js')));
check('hint no shut', /НИКОГДА не отшивай общение/.test(read('backend/services/softHumanLite.js')));
check('registry wave', /0m9/.test(read('backend/services/replyGateRegistry.js')));
check('changelog', /## 0m9\./.test(read('CHANGELOG_TG.md')));
check('FE updates', /не отшивает|Никак|архив/i.test(read('frontend/updates.js')));
const r = spawnSync(process.execPath, [path.join(__dirname, '_smoke_lead_shut_0m9.js')], {
  encoding: 'utf8',
  timeout: 30_000,
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
});
check('smoke', /SMOKE_LEAD_SHUT_0M9_OK/.test(`${r.stdout}\n${r.stderr}`), String(r.stderr || '').slice(-200));
if (p0) {
  console.error('HARD_AUDIT_0M9_FAIL');
  process.exit(1);
}
console.log('HARD_AUDIT_0M9_OK');
process.exit(0);
