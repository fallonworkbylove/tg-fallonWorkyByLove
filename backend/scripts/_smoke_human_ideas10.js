#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const ideas = require('../services/humanIdeas10');
const hh = require('../services/humanHardening');
const ops = require('../services/opsQuality');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

// #1
const ban = ideas.strengthenSelfToldBan('Ты УЖЕ рассказывала ему о себе: job: «флип»');
check('1 self-told ban', /НЕ повторяй как новость/i.test(ban));

// #2
let lagHits = 0;
for (let i = 0; i < 80; i++) {
  if (ideas.maybeLifeLagMs('рассказал про зал и машину сегодня', { leadTier: 'warm' }) >= 60000) {
    lagHits += 1;
  }
}
check('2 life-lag sometimes', lagHits >= 1 && lagHits < 60, `hits=${lagHits}`);
check('2 no lag on ?', ideas.maybeLifeLagMs('как дела?', { leadTier: 'cold' }) === 0);

// #3
const mirror = ideas.buildMirrorHisTopicHint(
  [{ role: 'user', content: 'x' }],
  'Да есть конечно) Книги люблю читать. Машинами люблю заниматься',
);
// probabilistic — try a few
let mirrorOk = !!mirror;
for (let i = 0; i < 30 && !mirrorOk; i++) {
  const h = ideas.buildMirrorHisTopicHint([], 'Температура и тд, болею сегодня');
  if (h) mirrorOk = true;
}
check('3 mirror hint', mirrorOk);

// #4
const f1 = ideas.maybeForgetHintOnce(1, 'p', 'забыла мелочь');
const f2 = ideas.maybeForgetHintOnce(1, 'p', 'забыла мелочь');
check('4 forget once', !!f1 && f2 == null);

// #5
const short = ideas.applyMoodLengthBias(
  'ну да я тут долго думала про всё это и ещё хотела сказать что день был странный совсем',
  'tired',
);
check('5 mood shortens', short.length < 90, short);

// #6
check('6 slept apology', /сорри спала|проспала/i.test(ideas.morningApologySleptHint()));

// #7
const hobby = ideas.stripCoffeeSeriesWalkCombo(
  'я люблю кофе, сериалы и иногда гулять) ещё флиппингом',
  [],
);
check('7 strip coffee combo', !ideas.COFFEE_SERIES_WALK_RE.test(hobby), hobby);
const post = hh.applyHardeningPostfilters(
  'я люблю кофе, сериалы и иногда гулять)',
  [],
  'расскажи хобби',
  1,
);
check('7 postfilter hobby', !/кофе.+сериал.+гул/i.test(post), post);

// #8 silent reaction rate — just callable
let silent = 0;
for (let i = 0; i < 100; i++) {
  if (ops.preferSilentReaction('ок)', { leadTier: 'cold' })) silent += 1;
}
check('8 silent often', silent >= 30, `silent=${silent}`);

// #9
let disagree = 0;
for (let i = 0; i < 100; i++) {
  if (ideas.mildDisagreeHint()) disagree += 1;
}
check('9 mild disagree rate', disagree >= 10 && disagree <= 45, `n=${disagree}`);

// #10 evening — may null outside evening; just ensure no throw
ideas.buildEveningRecallHint(1, 'x').then((h) => {
  check('10 evening callable', h == null || /Вечер/i.test(h), h);
  if (fail) {
    console.error(fail + ' failed');
    process.exit(1);
  }
  console.log('SMOKE_HUMAN_IDEAS10_OK');
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
