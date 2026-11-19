#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const assert = require('assert');
const oq = require('../services/opsQuality');
const hh = require('../services/humanHardening');

assert.strictEqual(oq.FILTER_REASONS.howlong, 'давно на дв');
assert.ok(oq.formatFilterNote('howlong', '30 дн.').startsWith('отсев:'));
assert.strictEqual(oq.parseFilterReason('отсев: давно на дв · 30 дн.'), 'howlong');
assert.strictEqual(oq.parseFilterReason('отсев: молчит 2д · x'), 'silent');

const cold = oq.tempoForLeadTier('cold');
const hot = oq.tempoForLeadTier('hot');
assert.ok(cold.delayMult > hot.delayMult);
assert.ok(cold.mediaChance < hot.mediaChance);
assert.ok(oq.applyTempoDelay(1000, 'cold') > 1000);
assert.ok(oq.applyTempoDelay(1000, 'hot') < 1000);

assert.ok(['morning', 'day', 'evening', 'night'].includes(oq.mediaTimeSlot()));
const pol = oq.mediaSlotPolicy();
assert.ok(pol.banned === 'day' || pol.banned === 'dark');

// #7 — deterministic forceBareOk
assert.strictEqual(oq.preferSilentReaction('ок', { forceBareOk: true }), true);
assert.strictEqual(oq.preferSilentReaction('ага)', { forceBareOk: true }), true);
assert.strictEqual(oq.preferSilentReaction('сколько тебе лет?', { forceBareOk: true }), false);

assert.ok(hh.phraseBanLimitFor(null) <= 3);
assert.ok(hh.preferReactionOnlyOnBareOk('ок', 'ага)', { leadTier: 'cold' }) === true);

const sorted = oq.sortMediaBySlotPrefer(
  [{ id: 1 }, { id: 2 }, { id: 3 }],
  'L',
  (i) => (i.id === 2 ? 'day' : i.id === 1 ? 'dark' : null),
  'day',
);
assert.strictEqual(sorted[0].id, 2);

console.log('SMOKE_OPS_QUALITY_OK');
process.exit(0);
