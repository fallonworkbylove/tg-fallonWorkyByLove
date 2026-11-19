#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const services = path.join(root, 'services');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const rhythm = fs.readFileSync(path.join(services, 'humanRhythm.js'), 'utf8');
check('humanRhythm module', /reshapeDelayPair|whoLeadsHint|aggregateWindowMs/.test(rhythm));

const pipe = fs.readFileSync(path.join(services, 'replyPipeline.js'), 'utf8');
check('#1/#2 reshape wired', (pipe.match(/reshapeDelayPair/g) || []).length >= 2);
check('#6 whoLeads wired', (pipe.match(/whoLeadsHint/g) || []).length >= 2);
check('boost react wired', /boostReactThenTextMs/.test(pipe));

const mem = fs.readFileSync(path.join(services, 'memoryTriggers.js'), 'utf8');
check('#3 pet/hobby card', /petF|hobbyF|питомец|хобби/.test(mem));
check('#3 honest memory', /appendHonestMemoryRule/.test(mem));

const inbound = fs.readFileSync(path.join(services, 'inbound.js'), 'utf8');
check('hold incomplete', /aggregateWindowMs/.test(inbound));

const timing = fs.readFileSync(path.join(services, 'timing.js'), 'utf8');
check('timing reshape', /humanRhythm/.test(timing));

const front = fs.readFileSync(path.join(root, '../frontend/updates.js'), 'utf8');
check('miniapp changelog', /ритм|пауза|помн|ведёт|ведёт|однослож|как человек|Живой ритм/i.test(front));

const opsPath = path.join(root, '../ops-console/app/updates.js');
if (fs.existsSync(opsPath)) {
  const ops = fs.readFileSync(opsPath, 'utf8');
  check('ops changelog sync', /ритм|пауза|помн|Живой ритм/i.test(ops));
} else {
  console.log('SKIP ops-console');
}

if (fail) {
  console.error(`AUDIT_FAIL ${fail}`);
  process.exit(1);
}
console.log('HARD_AUDIT_0GJ_OK');
