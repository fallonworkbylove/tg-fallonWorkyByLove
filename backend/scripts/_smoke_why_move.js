#!/usr/bin/env node
require('dotenv').config();
const oh = require('../services/objectionHandler');

const hist = [
  { role: 'assistant', content: 'сейчас в нижнем, переезжаю в анапу)' },
];

const short = oh.detectHint('А почему?', hist);
const why = oh.detectHint('а почему анапу?', hist);
const main = oh.detectHint('а основное?', hist);
const earn = oh.detectHint('много зарабатываешь?', hist);
const earn2 = oh.detectHint('сколько заработала?', hist);

const okShort = /нашла работу/i.test(String(short || ''));
const okWhy = /нашла работу|мама/i.test(String(why || ''));
const okMain =
  /флипинг токенов|это и есть основное/i.test(String(main || '')) &&
  !/ты сказала, что флипинг — подработка/i.test(String(main || ''));
const okEarn =
  /кредит родителям/i.test(String(earn || '')) &&
  /кредит родителям/i.test(String(earn2 || ''));

console.log('short_why', okShort ? 'OK' : 'FAIL');
console.log('why_city', okWhy ? 'OK' : 'FAIL');
console.log('main_job', okMain ? 'OK' : 'FAIL');
console.log('earnings', okEarn ? 'OK' : 'FAIL');
if (!okShort || !okWhy || !okMain || !okEarn) {
  console.log({ short, why, main, earn, earn2 });
  process.exit(1);
}
process.exit(0);
