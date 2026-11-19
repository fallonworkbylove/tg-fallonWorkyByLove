#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const rhythm = require('../services/humanRhythm');
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const askPet = rhythm.detectRecallAsk('помнишь как зовут мою собаку?');
check('detect pet recall', askPet && askPet.type === 'pet', askPet);

const askCity = rhythm.detectRecallAsk('я же говорил из какого я города');
check('detect city recall', askCity && askCity.type === 'city', askCity);

check('no false recall', !rhythm.detectRecallAsk('как дела)'));

const empty = [];
const withPet = [{ fact_type: 'pet', fact_text: 'корги Барсик' }];

const hintMiss = rhythm.honestForgetHint('помнишь кличку моей собаки?', empty);
check('hint missing', /НЕТ|забыла|пуст/i.test(hintMiss || ''), hintMiss);

const hintHit = rhythm.honestForgetHint('помнишь кличку моей собаки?', withPet);
check('hint has fact', /ТОЛЬКО из КАРТОЧКИ/i.test(hintHit || ''), hintHit);

const forced = rhythm.applyHonestForget(
  'да помню, Барсик же)',
  'помнишь как зовут мою собаку?',
  empty,
);
check('force forget invent', /забыл|напомни|вылетел|не помн/i.test(forced), forced);

const keep = rhythm.applyHonestForget(
  'ну Барсик же)',
  'помнишь как зовут мою собаку?',
  withPet,
);
check('keep when in card', /Барсик/i.test(keep), keep);

const already = rhythm.applyHonestForget(
  'бля забыла) напомни',
  'помнишь мой город?',
  empty,
);
check('keep honest reply', /забыла/i.test(already), already);

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
check('wire hint', (pipe.match(/honestForgetHint/g) || []).length >= 2);
check('wire apply', (pipe.match(/applyHonestForget/g) || []).length >= 2);
check(
  'listPeerFacts export',
  /listPeerFacts/.test(
    fs.readFileSync(path.join(__dirname, '../services/memoryTriggers.js'), 'utf8'),
  ),
);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_HONEST_FORGET_0GK_OK');
