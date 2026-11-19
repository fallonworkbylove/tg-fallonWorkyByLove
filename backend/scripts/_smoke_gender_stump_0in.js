#!/usr/bin/env node
'use strict';

if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test';

const ai = require('../services/aiResponder');
const i14 = require('../services/humanIdeas14');
const soft = require('../services/softHumanLite');

function assert(name, cond) {
  if (!cond) {
    console.error('FAIL', name);
    process.exitCode = 1;
    return false;
  }
  console.log('OK', name);
  return true;
}

// H gender
assert('H_napisala', /написала/i.test(ai.fixFemaleSelfForms('я написал тебе)')));
assert('H_isportila', /испортила/i.test(ai.fixFemaleSelfForms('ой испортил всё)')));
assert('H_otvetila', /ответила/i.test(ai.fixFemaleSelfForms('ну я уже ответил)')));
assert('H_poniala_start', /^поняла/i.test(ai.fixFemaleSelfForms('понял)')));
assert('H_keep_other', /он написал/i.test(ai.fixFemaleSelfForms('он написал мне)')));

// H stump / typo
assert('H_ieogda', /иногда/i.test(i14.fixBrokenWords('иеогда бывает)')));
assert('H_radk', /Радужный/i.test(i14.fixBrokenWords('собираюсь в Радкжный)')));
assert('H_perepisk', /переписку\)/i.test(i14.fixBrokenWords('только переписк)')));
assert('H_delam', /делаю\)/i.test(i14.fixBrokenWords('сейчас делам)')));
assert('H_model_ieogda', /иногда/i.test(ai.fixModelTypos('иеогда пишу)')));

// Final soft gate wires gender+stump after texture
const gated = soft.applySoftLite('я написал иеогда переписк)', [], 'ок');
assert('H_soft_gender', /написала/i.test(gated));
assert('H_soft_ieogda', /иногда/i.test(gated));
assert('H_soft_perepisk', /переписку/i.test(gated));

// ideas14 postfilter also genders
const p14 = i14.applyIdeas14Postfilters('я испортил)', [], 'ок', 1, 'p');
assert('H_ideas14_gender', /испортила/i.test(p14));

if (process.exitCode) {
  console.error('SMOKE_FAIL_0in');
  process.exit(1);
}
console.log('ALL_OK');
