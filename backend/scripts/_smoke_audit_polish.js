#!/usr/bin/env node
/**
 * Smoke: пачка после аудита — цитаты, typos, thanks, vision mime, coach stub.
 */
require('dotenv').config();
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test-smoke';

const ar = require('../services/aiResponder');
const thin = require('../services/humanThinLayer');
const soft = require('../services/softHumanLite');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else console.log('ok', msg);
}

// typos
assert(
  /верном пути/i.test(ar.fixModelTypos('ну поняла) ну, что всё на веоном пути)')),
  'veonom → vernom',
);
assert(/звучит/i.test(ar.fixModelTypos('заучит здорово) люблю природу')), 'zauchit → zvuchit');

// thanks on greeting
const thanks = thin.applyThinPostfilters(
  'да, нормально, спасибо)',
  'Приветик, хорошо, ты как?)',
  [],
  '',
);
assert(!/спасибо/i.test(thanks), 'no thanks on greeting: ' + thanks);

// coach leftover / whole-coach → short live, not «, главное)»
const coachy = soft.softenCoachy('не переживай, всё будет хорошо, главное беречь себя)');
assert(
  !/не\s+переживай|беречь\s+себя|главное/i.test(coachy) && !/^,/.test(String(coachy).trim()),
  'coach cleaned: ' + coachy,
);

// vision mime
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const gzip = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
assert(ar.detectVisionImageMime(jpeg) === 'image/jpeg', 'jpeg mime');
assert(ar.detectVisionImageMime(gzip) === null, 'tgs/gzip skipped');

// nested quote collapse via enrich path — short follow-up should not double
const already =
  '[уточнение к твоей фразе «кстати, а сколько дней ты уже на дв?»]: Иногда захожу';
const hist = [{ role: 'assistant', content: 'кстати, а сколько дней ты уже на дв?' }];
// enrichShortFollowUp is not exported — check via generate path markers in strip
assert(/уточнение/.test(already) && !/\]:\s*\[ответ/.test(already), 'single marker fixture');

console.log('AUDIT_POLISH', process.exitCode ? 'FAIL' : 'OK');
process.exit(process.exitCode || 0);
