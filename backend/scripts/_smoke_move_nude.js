#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const oh = require('../services/objectionHandler');

let failed = 0;
function check(name, ok, detail) {
  console.log(name, ok ? 'OK' : 'FAIL');
  if (!ok) {
    failed += 1;
    if (detail) console.log(' ', String(detail).slice(0, 220));
  }
}

const hist = [{ role: 'assistant', content: 'сейчас в мурманске, переезжаю)' }];
const why = oh.detectHint('а почему переезжаешь?', hist);
check(
  'why_backstory',
  /парень|измен|обустроил|мамой\s+беда/i.test(String(why || '')),
  why,
);

const there = oh.detectHint('Я имею в виду ты сейчас в Мурманске, что ты там делаешь?', hist);
check('what_there', /собира|перебир|парень|измен|мамой/i.test(String(there || '')), there);

const nudeHint = oh.detectHint('Пора скинуть сиськи уже', hist);
check('nude_hint', /фу ты тут только ради|эмм/i.test(String(nudeHint || '')), nudeHint);

const soft = oh.softenSexualPressureReply('не, не мой стиль)', 'Пора скинуть сиськи уже');
check('nude_soft', /фу ты тут только ради этого/i.test(soft), soft);

const endHint = oh.detectHint('Ну всё тогда закончим общение', hist);
check(
  'end_chat',
  /заканчивает общение/i.test(String(endHint || '')) && /ну ок/i.test(String(endHint || '')),
  endHint,
);

const short = oh.detectHint('А почему?', hist);
check('short_why', /парень|измен|мамой|нашла работу/i.test(String(short || '')), short);

if (failed) {
  console.log('FAILED', failed);
  process.exit(1);
}
console.log('ALL OK');
