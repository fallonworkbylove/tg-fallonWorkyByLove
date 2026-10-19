#!/usr/bin/env node
require('dotenv').config();
const oh = require('../services/objectionHandler');

const hist = [
  { role: 'assistant', content: 'сейчас в нижнем, переезжаю в анапу)' },
];

const short = oh.detectHint('А почему?', hist);
const why = oh.detectHint('а почему анапу?', hist);
const main = oh.detectHint('а основное?', hist);

const okShort = /нашла работу/i.test(String(short || ''));
const okWhy = /нашла работу|мама/i.test(String(why || ''));
const okMain =
  /флипинг токенов|это и есть основное/i.test(String(main || '')) &&
  !/ты сказала, что флипинг — подработка/i.test(String(main || ''));

console.log('short_why', okShort ? 'OK' : 'FAIL');
console.log('why_city', okWhy ? 'OK' : 'FAIL');
console.log('main_job', okMain ? 'OK' : 'FAIL');
if (!okShort || !okWhy || !okMain) {
  console.log({ short, why, main });
  process.exit(1);
}
process.exit(0);
