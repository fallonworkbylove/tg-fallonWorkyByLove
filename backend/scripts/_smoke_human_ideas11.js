#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const i11 = require('../services/humanIdeas11');
const hh = require('../services/humanHardening');
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

check(
  '1 therapist',
  !/важно что ты чувств/i.test(
    i11.stripTherapistTone('важно что ты чувствуешь. ну да)'),
  ),
);

check(
  '2 one question',
  (i11.stripDoubleQuestion('норм. а ты как? и что делаешь?').match(/\?/g) || []).length <= 1,
);

check('3 joke hint', !!i11.jokeAckHint('ахаха ору'));
check('3 no joke', !i11.jokeAckHint('как смена прошла сегодня?'));

const histOpen = [{ role: 'assistant', content: 'чем занимаешься)' }];
check('4 opener hint', !!i11.antiOpenerRepeatHint(histOpen));
check(
  '4 strip opener',
  !i11.OPENER_RE.test(i11.stripOpenerRepeat('круто. чем занимаешься?', histOpen)),
);

check('5 en office', !/\banyway\b/i.test(i11.stripEnOffice('anyway давай потом)')));

const prefixed = [];
for (let i = 0; i < 80; i++) {
  prefixed.push(
    i11.maybeMicroThinkPrefix(
      'ну я тут подумала что день странный совсем и ещё вот',
      'x'.repeat(60),
    ),
  );
}
check(
  '6 micro prefix sometimes',
  prefixed.some((p) => /^(?:хм|сек|ой|а)\s/i.test(p)),
);

check(
  '7 no pitch after share',
  !/флип|nft/i.test(
    i11.stripSelfPitchAfterHisShare('ого) я флипаю токены кстати)', 'у меня сегодня смена адская'),
  ),
);

let stitch = null;
for (let i = 0; i < 40 && !stitch; i++) {
  stitch = i11.topicStitchHint(
    [
      { role: 'user', content: 'на смене полный трэш' },
      { role: 'assistant', content: 'ох' },
      { role: 'user', content: 'ещё начальник орёт' },
      { role: 'assistant', content: 'жесть' },
    ],
    'щас дома уже',
  );
}
check('8 topic stitch', !!stitch, stitch);

check('9 empty empathy', !/^я тебя понимаю/i.test(i11.stripEmptyEmpathy('я тебя понимаю)')));

check(
  '10 shorten tiny ask',
  i11.shortenOnTinyAsk('ну да конечно всё так и есть длинный ответ про жизнь', 'ок?').length < 50,
);

const post = hh.applyHardeningPostfilters(
  'anyway важно что ты чувствуешь. а ты как? чем занимаешься?',
  histOpen,
  'ахаха',
  1,
);
check('hh postfilter wired', !/\banyway\b/i.test(post) && (post.match(/\?/g) || []).length <= 1, post);

const hhSrc = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
check('wire hints', /buildIdeas11Hints/.test(hhSrc));
check('wire post', /applyIdeas11Postfilters/.test(hhSrc));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_HUMAN_IDEAS11_OK');
