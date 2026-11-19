#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke';
'use strict';

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const jf = require('../services/jobFlipAsk');

const hist = [
  { role: 'user', content: 'привет' },
  { role: 'assistant', content: 'хай)' },
];

const forced = jf.ensureJobFlipHeardAsk(
  'флипаю токены онлайн)',
  'а ты кем работаешь?',
  { ageHours: 48, history: hist },
);
ok('job_ask_has_heard', jf.HEARD_RE.test(forced), `got=${forced}`);

const volunteer = jf.maybeAppendHeardAskOnWorkTalk(
  'ну я флипаю токены онлайн)',
  'чем день скрашиваешь?',
  { ageHours: 48, history: hist, chance: 1, random: () => 0 },
);
ok('volunteer_appends_heard', jf.HEARD_RE.test(volunteer), `got=${volunteer}`);

const noRoll = jf.maybeAppendHeardAskOnWorkTalk(
  'ну я флипаю токены онлайн)',
  'чем день скрашиваешь?',
  { ageHours: 48, history: hist, chance: 0.85, random: () => 0.99 },
);
ok('volunteer_can_skip', !jf.HEARD_RE.test(noRoll), `got=${noRoll}`);

const day1 = jf.maybeAppendHeardAskOnWorkTalk(
  'флипаю токены онлайн)',
  'норм день?',
  { ageHours: 5, history: hist, chance: 1, random: () => 0 },
);
ok('day1_no_heard', !jf.HEARD_RE.test(day1), `got=${day1}`);

const aside = jf.maybeAppendHeardAskOnWorkTalk(
  'ой, там по работе затык — пойду разберусь, чуть позже напишу)',
  'ок',
  { ageHours: 48, history: hist, chance: 1, random: () => 0 },
);
ok('aside_no_heard', !jf.HEARD_RE.test(aside), `got=${aside}`);

const already = jf.maybeAppendHeardAskOnWorkTalk(
  'опять флипаю токены)',
  'круто',
  {
    ageHours: 48,
    history: [...hist, { role: 'assistant', content: 'флип токены) слышал о таком?)' }],
    chance: 1,
    random: () => 0,
  },
);
ok('no_duplicate_heard', (already.match(/слышал/gi) || []).length <= 1, `got=${already}`);

const wire = require('fs').readFileSync(
  require('path').join(__dirname, '../services/aiResponder.js'),
  'utf8',
);
ok('wired_aiResponder', /maybeAppendHeardAskOnWorkTalk/.test(wire));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
process.exit(0);
