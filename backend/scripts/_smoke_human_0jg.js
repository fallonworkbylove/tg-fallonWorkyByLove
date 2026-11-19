#!/usr/bin/env node
'use strict';

/**
 * Smoke 0jg: humanIdeas18 top-8 personality layer.
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');
const i18 = require('../services/humanIdeas18');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

// 1 length mirror
const long = i18.mirrorLength(
  'ну да в целом всё нормально просто сижу дома смотрю сериал и пью чай ещё думаю',
  'ок',
);
ok('len_mirror', i18.mirrorLength.length && long.split(/\s+/).length <= 14, long);

// 3 soft disagree after agree spam
const histAgree = [
  { role: 'assistant', content: 'да точно)' },
  { role: 'assistant', content: 'согласна)' },
  { role: 'assistant', content: 'ага точно)' },
];
const dis = i18.softDisagree('да точно)', histAgree, 'погода сегодня огонь');
ok('disagree', /наоборот|спорно|по-моему|по-другому/i.test(dis), dis);

// 4 meet counter
const meet = i18.meetCounterTail(
  'можно) как буду на месте, погуляем)',
  'давай погуляем когда приедешь',
);
ok('meet_q', /\?/.test(meet) && /когда|удобн|гуля/i.test(meet), meet);

// 5 photo detail
const photo = i18.fixGenericPhotoPraise('красиво)', [], '[медиа:#1] смотри');
ok('photo_detail', !/^красиво/i.test(photo) && /свет|фон|настроен|деталь/i.test(photo), photo);

// 6 second bot
const botHist = [
  { role: 'user', content: 'ты бот?' },
  { role: 'assistant', content: 'хах ну ты чего)' },
];
const bot2 = i18.shortenRepeatBotDefense(
  'нет конечно я живая обычная девушка просто коротко пишу',
  botHist,
  'точно бот',
);
ok('bot_short', bot2.split(/\s+/).length <= 5, bot2);

// 7 tier
ok('tier_stranger', i18.peerTier18([{ role: 'user', content: 'hi' }]) === 'stranger');
ok(
  'tier_close',
  i18.peerTier18(Array.from({ length: 22 }, () => ({ role: 'user', content: 'yo' }))) ===
    'close',
);

// hints wired content
const hints = i18.buildIdeas18Hints(
  Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: i === 2 ? 'я после смены в зале обычно' : 'ну ок',
  })),
  'ок',
  { systemPrompt: 'сейчас в Липецке, переезжаешь в Радужный' },
);
ok('hints_some', hints && hints.length > 20, hints);

const hh = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
ok('wire_hints', /humanIdeas18/.test(hh) && /buildIdeas18Hints/.test(hh));
ok('wire_post', /applyIdeas18Postfilters/.test(hh));

const chained = i18.applyIdeas18Postfilters(
  'красиво)',
  [{ role: 'user', content: '[медиа:#9]' }],
  '[медиа:#9] держи',
);
ok('chain', /свет|фон|настроен|деталь/i.test(chained), chained);

if (fail) {
  console.error('SMOKE_FAIL_0jg', fail);
  process.exit(1);
}
console.log('ALL_OK_0jg');
process.exit(0);
