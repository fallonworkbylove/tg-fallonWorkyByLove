#!/usr/bin/env node
'use strict';

/**
 * Smoke 0jf: обрубки, Радужный, дома?, робот, отказ+медиа, мягкая встреча, 18+ нейтраль.
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');
const i17 = require('../services/humanIdeas17');
const i14 = require('../services/humanIdeas14');
const soft = require('../services/softHumanLite');
const ai = require('../services/aiResponder');
const oh = require('../services/objectionHandler');
const ms = require('../services/mediaSend');
const thin = require('../services/humanThinLayer');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

ok('stump_pozd', /поздно/i.test(i17.fixWordStumps17('да нет, еще не позд)')));
ok('stump_podozhd', /подожди/i.test(i17.fixWordStumps17('нормальное, подожд)')));
ok('stump_i14', /поздно/i.test(i14.fixBrokenWords('да нет, еще не позд)')));
ok('soft_pozd', /поздно/i.test(soft.softCompleteCut('да нет, еще не позд)')));

ok(
  'raduzhny',
  /Радужн|город/i.test(
    i17.stripRainbowCityConfusion(
      'радуга - моя слабость, всегда фоткаю',
      'ты живёшь в Радужном?',
      'переезжаешь в Радужный к маме',
    ),
  ),
);

ok('home_ask', /дома/i.test(i17.fixHomeAsk('хз, обычный день', 'ты дома?')));
ok(
  'bot_admit',
  !/ну\s+да|как-то\s+так/i.test(
    i17.denyBotOrScriptAdmit('ну да) как-то так получается', 'Ты робот'),
  ),
);

ok(
  'refuse_token',
  /<<(PHOTO|CIRCLE)>>/i.test(
    i17.stripRefuseWhenMediaToken('<<PHOTO>> ну давай без фото коробок, расскажу текстом)'),
  ) &&
    !/без\s+фото\s+коробок/i.test(
      i17.stripRefuseWhenMediaToken('<<PHOTO>> ну давай без фото коробок, расскажу текстом)'),
    ),
);

const meet = i17.softMeetAgree('нет)', 'давай погуляем когда приедешь');
ok(
  'soft_meet',
  /как\s+буду|когда\s+приеду|на\s+месте|пересечём|после\s+переезда|погулять/i.test(meet),
  meet,
);

const meetHint = i17.buildIdeas17Hints([], 'давай встретимся', {});
ok('meet_hint', /как\s+буду|на\s+месте/i.test(String(meetHint || '')), meetHint);

const stripped = ai.stripMeetAgreement('скоро увидимся завтра у метро', 'давай встретимся');
ok(
  'strip_concrete',
  /как\s+буду|на\s+месте|приеду|город/i.test(stripped) && !/завтра\s+у\s+метро/i.test(stripped),
  stripped,
);

const softKeep = ai.stripMeetAgreement(
  'можно) как буду на месте, погуляем)',
  'давай погуляем',
);
ok('keep_soft_meet', /как\s+буду/i.test(softKeep), softKeep);

const thinMeet = thin.fixMeetWeakDodge('нет)', 'давай встретимся');
ok('thin_meet', /как\s+буду|приеду|город/i.test(thinMeet), thinMeet);

const nude = oh.softenSexualPressureReply('эмм.. что? фу ты тут только ради этого?', 'скинь сиськи');
ok('adult_neutral', !/фу\s+ты\s+тут\s+только/i.test(nude), nude);

const resolved = ms.resolveMediaPromise(
  'не кину такое, стыдно',
  'photo',
  'скинь фото',
  [],
  true,
);
ok(
  'media_no_refuse',
  !/не\s+кину|стыдно/i.test(resolved.outText),
  resolved.outText,
);

const hh = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
ok('wire_hints', /humanIdeas17/.test(hh) && /buildIdeas17Hints/.test(hh));
ok('wire_post', /applyIdeas17Postfilters/.test(hh));

const chained = i17.applyIdeas17Postfilters(
  'да нет, еще не позд)',
  [],
  'ты дома?',
  'переезжаешь в Радужный',
);
ok('chain_home_or_stump', /поздно|дома/i.test(chained), chained);

if (fail) {
  console.error('SMOKE_FAIL_0jf', fail);
  process.exit(1);
}
console.log('ALL_OK_0jf');
process.exit(0);
