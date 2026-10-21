#!/usr/bin/env node
/**
 * A: обрубки «что попал» / «просто читай»
 * B: howLongAck для новичка/редко + rare-correction
 * soft: «?» → не NFT
 */
const path = require('path');
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const oh = require('../services/objectionHandler');
const ar = require('../services/aiResponder');

let failed = 0;
function check(name, ok, detail) {
  console.log(name, ok ? 'OK' : 'FAIL');
  if (!ok) {
    failed += 1;
    if (detail) console.log(' ', detail);
  }
}

// --- B: newbie / rare ---
const weekHint = oh.getHowLongAckHint('Неделю');
check(
  'newbie_week',
  /новичок|редко|мало дней|КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: «уже бывал»/i.test(weekHint) &&
    !/Можно.*уже бывал/i.test(weekHint),
  weekHint.slice(0, 200),
);

const rareHint = oh.getHowLongAckHint('редко там сижу');
check('newbie_rare', /редко|новичок|уже бывал/i.test(rareHint), rareHint.slice(0, 160));

const vetHint = oh.getHowLongAckHint('уже месяца 4');
check(
  'veteran_month',
  /давно на дв|уже шаришь/i.test(vetHint) && !/новичок/i.test(vetHint),
  vetHint.slice(0, 160),
);

const hist = [
  { role: 'assistant', content: 'ну ты уже на дв бывал)' },
  { role: 'user', content: 'Неделю' },
];
const corr = oh.getDvRareCorrectionHint('Я б так не сказал, редко там сижу', hist);
check('rare_correction', !!corr && /Прими без спора|редко на дв/i.test(corr), corr);

const detect = oh.detectHint('Я б так не сказал, редко там сижу', hist);
check('detect_rare', !!detect && /редко на дв|Прими без спора/i.test(detect), detect);

check('is_newbie_week', oh.isDvNewbieOrRare('Неделю') === true);
check('is_newbie_rare', oh.isDvNewbieOrRare('редко там сижу') === true);
check('is_not_vet', oh.isDvNewbieOrRare('уже полгода') === false);

// --- A: broken fragments ---
const broken1 = ar.fixBrokenChatFragments('ну, что попал');
check(
  'broken_popal',
  !/что\s+попал/i.test(broken1) && /ладно|ок|поняла|окей/i.test(broken1),
  broken1,
);

const broken2 = ar.fixBrokenChatFragments('жесть, раз так, тогда просто читай');
check(
  'broken_read',
  !/просто\s+читай/i.test(broken2) && /ладно|ок|поняла|окей/i.test(broken2),
  broken2,
);

const keepOk = ar.fixBrokenChatFragments('поняла, неделю ещё)');
check('keep_normal', keepOk === 'поняла, неделю ещё)', keepOk);

const keepPopalIn = ar.fixBrokenChatFragments('что попал в кадр)');
check('keep_popal_in', /что попал в кадр/i.test(keepPopalIn), keepPopalIn);

// --- soft C: ? + NFT after broken ---
const nftOnQ = ar.softBlockNftOnBareQuestion('ну про коллекции nft)', '?', [
  { role: 'assistant', content: 'просто читай' },
]);
check('soft_nft_q', /проехали|ладно/i.test(nftOnQ) && !/коллекц|nft/i.test(nftOnQ), nftOnQ);

const nftOk = ar.softBlockNftOnBareQuestion('ну про дв)', '?', [
  { role: 'assistant', content: 'на дв сидишь?' },
]);
check('soft_no_nft_pass', nftOk === 'ну про дв)', nftOk);

if (failed) {
  console.log('FAILED', failed);
  process.exit(1);
}
console.log('ALL OK');
