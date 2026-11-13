#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const i16 = require('../services/humanIdeas16');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

const soft = i16.stripEmptySoftFillers('ну ну)');
ok('empty_soft', soft !== 'ну ну)' && !/^ну\s*ну/i.test(soft), soft);

const teach = i16.fixTeachAsk('ладно)', 'научишь меня?');
ok('teach', /уч|учитель|объясн|гугл|уроков/i.test(teach), teach);

const walk = i16.fixFalseMeetOnHisWalk(
  'ой пока не до встреч, я вся в коробках',
  'сейчас гуляю по городу',
);
ok('walk_not_meet', !/не\s+до\s+встреч|коробк/i.test(walk), walk);

const keepMeet = i16.fixFalseMeetOnHisWalk(
  'ой пока не до встреч, я вся в коробках',
  'давай погуляем вместе',
);
// На реальный зов встретиться ideas16 не подменяет (это meet-invite) —
// подмена на мягкое «как буду» уже в ideas17 / thinLayer.
ok('keep_real_meet_invite_passthrough', /не\s+до\s+встреч|коробк/i.test(keepMeet), keepMeet);

const huh = i16.stripHuhConfusion('huh 😅', 'kak dela brat');
ok('huh', /русск|напиши|словами|разобрал/i.test(huh), huh);

const ther = i16.stripTherapistTone('я тебя понимаю, это нормально чувствовать');
ok('therapist', !/я\s+тебя\s+понимаю|нормально\s+чувств/i.test(ther), ther);

const chained = i16.applyIdeas16Postfilters('ну ну)', [], 'научишь?');
ok('chain_teach', /уч|учитель|объясн|гугл|уроков/i.test(chained), chained);

const hh = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
ok('wire_hints', /humanIdeas16/.test(hh) && /buildIdeas16Hints/.test(hh));
ok('wire_post', /applyIdeas16Postfilters/.test(hh));

const hints = i16.buildIdeas16Hints('сейчас гуляю');
ok('hint_walk', /прогулк|встреч/i.test(hints), hints);

if (fail) {
  console.error('SMOKE_FAIL_0io', fail);
  process.exit(1);
}
console.log('ALL_OK');
