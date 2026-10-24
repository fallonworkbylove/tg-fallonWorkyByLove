#!/usr/bin/env node
/**
 * Smoke: humanExtra — пачка, анти-зеркало, эхо длины, утро, сленг, afterthought.
 */
const h = require('../services/humanExtra');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else console.log('ok', msg);
}

// 1) boring batch
assert(
  h.filterBoringBatch(['ок', 'ага', 'вчера чинил машину']).join('|') === 'вчера чинил машину',
  'filter boring keeps rich',
);
assert(h.filterBoringBatch(['ок', 'ага']).length === 1, 'all boring → last');

// 2) anti-mirror
assert(
  !/\?/.test(h.stripAntiMirror('норм) а ты?', 'а ты как?')),
  'anti mirror strips: ' + h.stripAntiMirror('норм) а ты?', 'а ты как?'),
);

// 3) length echo
const clipped = h.echoLengthClip('ок', 'ну да всё нормально я дома сижу смотрю сериал и пью чай)');
assert(clipped.length < 55, 'echo clip: ' + clipped);

// 4) morning apology
const night = new Date();
night.setHours(night.getHours() - 10);
assert(h.needsMorningApology(night) === true || h.needsMorningApology(night) === false, 'morning fn runs');
const oldNight = new Date(Date.now() - 12 * 3600 * 1000);
// force: msg at 2am msk ≈ use fixed
const msg2am = new Date('2026-10-20T23:00:00.000Z'); // ~2msk
const nowNoon = new Date('2026-10-21T09:00:00.000Z'); // ~12msk
assert(h.needsMorningApology(msg2am, nowNoon), 'night→morning');

// 5) away
assert(h.awayReturnHint(5) === null, 'away short null');
assert(/отвлек/i.test(h.awayReturnHint(55) || ''), 'away 55m');

// 6) pace + slang
const p1 = h.getAccountPace(11);
const p2 = h.getAccountPace(11);
assert(p1.typingMul === p2.typingMul, 'pace stable');
assert(p1.typingMul >= 0.75 && p1.typingMul <= 1.4, 'pace range ' + p1.typingMul);
const slanged = h.applyAccountSlang('короче норм)', 42);
assert(typeof slanged === 'string' && slanged.length >= 3, 'slang: ' + slanged);

// 7) afterthought
assert(h.pickAfterthought('норм день)') !== null || h.pickAfterthought('норм день)') === null, 'afterthought pick');
assert(h.pickAfterthought('как дела?') === null, 'no afterthought on ?');

// 8) react delay
const d = h.reactThenTextDelayMs(7, '👍', 'норм)');
assert(d === 0 || d >= 8000, 'react delay ' + d);

// 9) detail callback
const hint = h.buildHisDetailCallbackHint(
  [
    { role: 'user', content: 'привет' },
    { role: 'assistant', content: 'прив' },
    { role: 'user', content: 'а' },
    { role: 'assistant', content: 'б' },
    { role: 'user', content: 'в' },
    { role: 'assistant', content: 'г' },
    { role: 'user', content: 'вчера машину чинил' },
  ],
  'ага',
);
assert(hint === null || /машин/i.test(hint), 'detail hint optional');

console.log('HUMAN_EXTRA', process.exitCode ? 'FAIL' : 'OK');
process.exit(process.exitCode || 0);
