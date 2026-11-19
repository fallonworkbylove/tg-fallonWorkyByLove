#!/usr/bin/env node
'use strict';
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test';

const i14 = require('../services/humanIdeas14');
const soft = require('../services/softHumanLite');
const hz = require('../services/humanizeSpeech');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

ok('vesh', /вещи/i.test(i14.fixBrokenWords('ещё собираю вещ)')));
ok('lipetsk', /из Липецка/i.test(i14.fixBrokenWords('из Липецк')));
ok('nuzhe', /нужна/i.test(i14.fixBrokenWords('к маме, поддержка нуже')));
ok('seryoz', /серьёзно/i.test(i14.fixBrokenWords('хах, ну ты серьёз')));
ok('del_po', /полно/i.test(soft.softCompleteCut('просто дел по')));
ok('orphan_letter', /ага,\s*да\)/i.test(soft.softCompleteCut('ага, да, Д')));
ok(
  'hello_not_poniala',
  !/понял/i.test(soft.fixAckOnBareGreeting('мм, поняла)', 'Привет')),
);
ok(
  'hello_has_hi',
  /привет|хай/i.test(soft.fixAckOnBareGreeting('мм, поняла)', 'Привет')),
);
ok(
  'hello_ensure',
  /привет|хай/i.test(soft.ensureAckNotBare('ага)', 'привет')),
);
ok('incomplete_del_po', hz.looksIncompleteUtterance('просто дел по') === true);
ok('incomplete_letter', hz.looksIncompleteUtterance('ага, да, Д') === true);

const gated = soft.applySoftLite('ещё собираю вещ)', [], 'ну как сборы?');
ok('soft_vesh', /вещи/i.test(gated));

const gatedHi = soft.applySoftLite('мм, поняла)', [], 'Привет');
ok('soft_hi', /привет|хай/i.test(gatedHi) && !/понял/i.test(gatedHi));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
