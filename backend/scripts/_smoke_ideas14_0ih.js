#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const i14 = require('../services/humanIdeas14');

function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
  console.log('OK', m);
}

assert(/нормальное/.test(i14.fixBrokenWords('щас пр альное фото')), 'typo пр альное');
assert(/пример/.test(i14.fixBrokenWords('просто поимер')), 'typo поимер');
assert(/капец/.test(i14.fixBrokenWords('кааец')), 'typo кааец');

const histNoshow = [
  { role: 'assistant', content: 'не покажу)' },
  { role: 'assistant', content: 'неа, не покажу' },
];
const div = i14.applyIdeas14Postfilters('не, не покажу', histNoshow, 'скинь', 1, 'p1');
assert(!/не\s+покаж/i.test(div) || /день|увлека|вечер/i.test(div), 'noshow divert after 2');

assert(i14.shouldBlockMediaAfterNoShow([{ role: 'assistant', content: 'не покажу)' }]), 'block media after noshow');

const cut = i14.applyIdeas14Postfilters('поняла) но иногда полезно,', [], 'ок', 1, 'p2');
assert(!/,\s*$/.test(String(cut).trim()), 'cut tail');

const bot = i14.applyIdeas14Postfilters(
  'я не бот, я живая девушка и нейросеть мне не нужна потому что я реальная',
  [],
  'ты бот?',
  1,
  'p3',
);
assert(String(bot).length < 80, 'bot defense short');

const shy = i14.applyIdeas14Postfilters(
  'скинь кружок с платформы nft токен',
  [],
  'запиши видео',
  1,
  'p4',
);
assert(!/нфт|nft|токен/i.test(shy), 'shy video no nft');

assert(typeof i14.buildIdeas14Hints === 'function', 'hints export');
console.log('SMOKE_IDEAS14_0IH_OK');
