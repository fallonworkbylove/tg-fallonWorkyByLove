#!/usr/bin/env node
/**
 * Smoke 0ga: #72/#73/#48/#49/#14/#84/#75/#95/#96/#100
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');
const hh = require('../services/humanHardening');
const oh = require('../services/objectionHandler');
const inbound = require('../services/inbound');
const scanSrc = fs.readFileSync(path.join(__dirname, '../services/scanCatchup.js'), 'utf8');
const pipeSrc = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
const memSrc = fs.readFileSync(path.join(__dirname, '../services/memoryTriggers.js'), 'utf8');

let failed = 0;
function check(name, ok) {
  if (ok) console.log(`OK  ${name}`);
  else {
    console.error(`FAIL ${name}`);
    failed += 1;
  }
}

check('bot test', hh.isBotTest('докажи что ты живая'));
check('captcha', hh.isBotTest('сколько будет 2+2'));
check(
  'detectHint captcha',
  /НЕ ассистент|не калькулятор/i.test(String(oh.detectHint('сколько будет 3+5') || '')),
);
check(
  'detectHint bot-test',
  /Ирония|жива/i.test(String(oh.detectHint('докажи что ты не бот') || '')),
);
check(
  'soften solves',
  /калькулятор/i.test(hh.softenBotTestReply('4', 'сколько будет 2+2')),
);
check('strip lists', !/^\d+[.)]/m.test(hh.stripChatLists('1) а\n2) б\n3) в')));
check('strip anketa', /обычная/i.test(hh.stripAnketaTone('Меня зовут Аня, мне 22 лет, работаю онлайн')));
check(
  'postfilter captcha',
  !/^\s*4\s*$/.test(hh.applyHardeningPostfilters('4', [], 'сколько будет 2+2', 1)),
);

check('later promise', hh.detectLaterTextPromise('ок напишу позже)'));
hh.scheduleDeferredText(77, 'p77', { delayMs: 0 });
check('deferred text due', !!hh.takeDueDeferredText(77, 'p77'));
hh.scheduleDeferredText(77, 'p77b', { delayMs: 999999 });
hh.cancelDeferredText(77, 'p77b');
check('cancel deferred', !hh.takeDueDeferredText(77, 'p77b'));

check('burst hint', !!hh.getBurstReplyHint('ок\nа что делаешь?\nты тут?'));
check('no burst single', !hh.getBurstReplyHint('просто одно'));

check('score object', typeof hh.computeHumanScore(1).tighten === 'boolean');
check('tighten API', typeof hh.shouldTightenFilters(1) === 'boolean');

check('aggregate window 3200', inbound.AGGREGATE_WINDOW_MS === 3200);
check('aggregate max 12000', inbound.AGGREGATE_MAX_WAIT_MS === 12000);
check('scheduleLater exported', typeof inbound.scheduleLaterTextReturn === 'function');

check('scan #95 night skip', /Catch-up skip: поздний/.test(scanSrc));
check('pipe later return', /scheduleLaterTextReturn/.test(pipeSrc));
check('pipe cancel deferred', /cancelDeferredText/.test(pipeSrc));
check('pipe outbound log', /logOutboundReason/.test(pipeSrc));
check('pipe burst hint', /getBurstReplyHint/.test(pipeSrc));
check('mem dislike ban', /НЕ ПРЕДЛАГАЙ/.test(memSrc));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nALL PASS 0ga');
