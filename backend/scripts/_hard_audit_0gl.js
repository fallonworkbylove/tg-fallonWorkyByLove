#!/usr/bin/env node
/**
 * Hard audit 0gl — humanIdeas11 wiring + changelog + no regress on 0gj/0gk.
 */
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

const i11 = fs.readFileSync(path.join(services, 'humanIdeas11.js'), 'utf8');
check('ideas11 module', /applyIdeas11Postfilters|buildIdeas11Hints/.test(i11));
check('#1 therapist', /THERAPIST_RE|stripTherapistTone/.test(i11));
check('#2 double Q', /stripDoubleQuestion/.test(i11));
check('#3 joke', /jokeAckHint/.test(i11));
check('#4 opener', /antiOpenerRepeatHint|stripOpenerRepeat/.test(i11));
check('#5 en office', /stripEnOffice|EN_OFFICE_RE/.test(i11));
check('#6 micro', /maybeMicroThinkPrefix/.test(i11));
check('#7 pitch after share', /stripSelfPitchAfterHisShare/.test(i11));
check('#8 stitch', /topicStitchHint/.test(i11));
check('#9 empathy', /stripEmptyEmpathy/.test(i11));
check('#10 tiny ask', /shortenOnTinyAsk/.test(i11));

const hh = fs.readFileSync(path.join(services, 'humanHardening.js'), 'utf8');
check('HH hints wire', /buildIdeas11Hints/.test(hh));
check('HH post wire', /applyIdeas11Postfilters/.test(hh));

const rhythm = fs.readFileSync(path.join(services, 'humanRhythm.js'), 'utf8');
check('0gk honest forget still', /applyHonestForget|detectRecallAsk/.test(rhythm));
check('0gj reshape still', /reshapeDelayPair|whoLeadsHint/.test(rhythm));

const pipe = fs.readFileSync(path.join(services, 'replyPipeline.js'), 'utf8');
check('pipe honest forget', /applyHonestForget/.test(pipe));
check('pipe reshape', /reshapeDelayPair/.test(pipe));
check('pipe whoLeads', /whoLeadsHint/.test(pipe));

const front = fs.readFileSync(path.join(root, '../frontend/updates.js'), 'utf8');
check('miniapp entry', /Живее без шаблонов|без канцелярита|один вопрос|шутк/i.test(front));
const idx = fs.readFileSync(path.join(root, '../frontend/index.html'), 'utf8');
check('v bump', /updates\.js\?v=116/.test(idx));

const opsPath = path.join(root, '../ops-console/app/updates.js');
if (fs.existsSync(opsPath)) {
  const ops = fs.readFileSync(opsPath, 'utf8');
  check('ops sync', /Живее без шаблонов|без канцелярита|один вопрос|шутк/i.test(ops));
} else console.log('SKIP ops-console');

const cl = fs.readFileSync(path.join(root, '../CHANGELOG_TG.md'), 'utf8');
check('changelog 0gl', /^## 0gl\./m.test(cl));

check(
  'smoke script exists',
  fs.existsSync(path.join(__dirname, '_smoke_human_ideas11.js')),
);

if (fail) {
  console.error(`AUDIT_FAIL ${fail}`);
  process.exit(1);
}
console.log('HARD_AUDIT_0GL_STATIC_OK');
