/**
 * Smoke: медиа «попозже», soft meet после переезда, sanitize, essay clip.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const tg = require(path.join(__dirname, '../services/telegramClient'));
const ai = require(path.join(__dirname, '../services/aiResponder'));

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}

check('sanitize strips null + unpaired surrogate', () => {
  const s = tg.sanitizeOutgoingText('привет\u0000\uD800мир');
  assert.ok(!s.includes('\u0000'));
  assert.ok(!/[\uD800-\uDFFF]/.test(s));
  assert.ok(s.includes('привет'));
});

check('media: «фото попозже» → force or deflect, not raw deferral', () => {
  const r = tg.resolveMediaPromise(
    'ага, фото попозже)',
    null,
    'скинь фото',
    [],
    true,
  );
  assert.strictEqual(r.forceMedia, true);
  assert.ok(!/попозже/i.test(r.outText || ''), `still has попозже: ${r.outText}`);
});

check('media: bare «попозже» stall → deflect without later', () => {
  const r = tg.resolveMediaPromise('попозже)', null, 'скинь фотку', [], false);
  assert.strictEqual(r.forceMedia, false);
  assert.ok(!/попозже|later/i.test(r.outText || ''), `still deferral: ${r.outText}`);
  assert.ok((r.outText || '').length > 5);
});

check('media: «скину потом фотку» promise → force when link', () => {
  const r = tg.resolveMediaPromise(
    'скину потом фотку)',
    null,
    'скинь фото',
    [],
    true,
  );
  assert.strictEqual(r.forceMedia, true, JSON.stringify(r));
  assert.ok(!/потом|попозже/i.test(r.outText || ''), `still deferral: ${r.outText}`);
});

check('meet: после переезда погуляем → refusal', () => {
  const out = ai.stripMeetAgreement(
    'ну да, после переезда можем погулять)',
    'давай встретимся',
    {},
  );
  assert.ok(!/погуля/i.test(out), `still meet: ${out}`);
  assert.ok(/переезд|переписк|коробк/i.test(out), `expected refusal: ${out}`);
});

check('meet: увидимся скоро stripped', () => {
  const out = ai.stripMeetAgreement('ок, скоро увидимся)', 'жду тебя', {});
  assert.ok(!/увидимся/i.test(out), `still see: ${out}`);
});

check('essay clip shortens comma salad', () => {
  const long =
    'ну я тут потихоньку разбираю вещи, потом ещё на работу надо, и ещё мама звонила, в общем день такой насыщенный получился';
  const out = ai.clipOverlongReply(long, 1);
  assert.ok(out.length < long.length, `not shorter: ${out.length} vs ${long.length}`);
  assert.ok(out.split(/,\s+/).length <= 2, `still essay: ${out}`);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall smoke ok → 10/10 path clear');
