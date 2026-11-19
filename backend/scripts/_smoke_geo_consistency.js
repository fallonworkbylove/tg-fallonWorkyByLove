#!/usr/bin/env node
/**
 * Гео: давление «врёшь» + постфильтр «живу в A → я в B».
 * + не нукаем оффтоп («сериалы» → легенда переезда).
 */
require('dotenv').config();
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'local-smoke-only';

const oh = require('../services/objectionHandler');
const ar = require('../services/aiResponder');
const pf = require('../services/personaFacts');

const hist = [
  {
    role: 'assistant',
    content: 'не, я из России, сейчас в Нижнем Новгороде живу)',
  },
];

const pressure = oh.detectHint(
  'Ты хуйня, ты чего пиздишь ты же говорил что через пару недель поедешь сюда',
  hist,
);
const okPressure = /НЕ оправдывайся сменой города|пока в/i.test(String(pressure || ''));

let okSwap = false;
let swapped = '';
if (typeof ar.fixSwappedCurrentCity === 'function') {
  swapped = ar.fixSwappedCurrentCity(
    'в смысле? я в Липецке',
    'Ты путаешь где живёшь?',
    hist,
    'Ты живёшь в Нижнем, переезжаешь в Липецк к маме.',
  );
  okSwap =
    /Нижн/i.test(swapped) &&
    /Липецк/i.test(swapped) &&
    /переезж|поеду|еду/i.test(swapped) &&
    !/^в смысле\? я в Липецке\s*$/i.test(swapped.trim()) &&
    !/в Нижнеме|еду в Липецке|поеду.*Липецке|переезжаю.*Липецке/i.test(swapped) &&
    !/пока в Нижний\b/i.test(swapped); // «в Нижнем», «еду в Липецк»
} else {
  console.log('WARN fixSwappedCurrentCity not exported');
}

const seriesAsk = ar.fixSwappedCurrentCity(
  'в сериалах залипаю)',
  'какие сериалы смотришь?',
  hist,
  'долго жила в Москве. Сейчас переезжаешь в Анапу.',
);
const okSeries =
  /сериал/i.test(seriesAsk) && !/Анап|Москв|переезж/i.test(seriesAsk);

const mashaPrompt =
  'Ты — Маша. долго жила в Москве. Сейчас переезжаешь в Анапу.';

// На оффтоп про сериалы даже кривой «я в Анапе» НЕ превращаем в шаблон переезда.
const badGeo = ar.fixSwappedCurrentCity(
  'аа в смысле? я в Анапе живу',
  'какие сериалы смотришь?',
  [{ role: 'assistant', content: 'смотрю сериалы)' }],
  mashaPrompt,
);
const okOfftopic =
  badGeo === 'аа в смысле? я в Анапе живу' &&
  !/пока в Москв|в Анап[ае] переезжаю/i.test(badGeo);

// groundReply тоже не нукает оффтоп
const groundedOff = pf.groundReply(
  'я в Анапе',
  'какие сериалы смотришь?',
  [{ role: 'assistant', content: 'смотрю сериалы)' }],
  mashaPrompt,
);
const okGroundOff =
  /Анап/i.test(groundedOff) && !/пока в Москв|переезжаю/i.test(groundedOff);

// locative / accusative helpers
const okPrep =
  pf.inCityPrep('Москва') === 'Москве' &&
  pf.inCityPrep('Анапа') === 'Анапе' &&
  pf.inCityAcc('Анапа') === 'Анапу' &&
  pf.inCityAcc('Липецк') === 'Липецк';

// «сейчас в Липецке» + «давно не была там» на комплимент городу
const vikaPrompt =
  'Ты живёшь в Липецке, переезжаешь в Тимашевск к маме.';
const absentFix = pf.groundReply(
  'да, миленький, но я давно не была там)',
  'Липецк миленький)',
  [{ role: 'assistant', content: 'сейчас в Липецке)' }],
  vikaPrompt,
);
const okAbsent =
  !/давно\s+не\s+был/i.test(absentFix) && /Липецк/i.test(absentFix);

console.log('geo_pressure', okPressure ? 'OK' : 'FAIL');
console.log('geo_swap', okSwap ? 'OK' : 'FAIL', swapped);
console.log('geo_series', okSeries ? 'OK' : 'FAIL', seriesAsk);
console.log('geo_offtopic', okOfftopic ? 'OK' : 'FAIL', badGeo);
console.log('geo_ground_off', okGroundOff ? 'OK' : 'FAIL', groundedOff);
console.log('geo_prep', okPrep ? 'OK' : 'FAIL');
console.log('geo_absent', okAbsent ? 'OK' : 'FAIL', absentFix);
if (
  !okPressure ||
  !okSwap ||
  !okSeries ||
  !okOfftopic ||
  !okGroundOff ||
  !okPrep ||
  !okAbsent
) {
  console.log({
    pressure: String(pressure || '').slice(0, 160),
    swapped,
    seriesAsk,
    badGeo,
    groundedOff,
    absentFix,
  });
  process.exit(1);
}
process.exit(0);
