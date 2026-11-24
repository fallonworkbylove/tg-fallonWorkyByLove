'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const gates = require(path.join(__dirname, '../services/softHumanGates'));
const reg = require(path.join(__dirname, '../services/replyGateRegistry'));

assert(typeof gates.applyWave0t6Gates === 'function', 'wave fn');
assert(reg.listWaves().some((w) => w.id === '0t6'), 'wave registered');

{
  const t = gates.fixTherapistTone('понимаю тебя, это нормально)');
  assert(t && !/^понимаю тебя/i.test(t), 'therapist');
}
assert(
  !/^поняла/i.test(
    gates.fixPonjalaStamp('поняла)', [{ role: 'assistant', content: 'поняла)' }]),
  ),
  'ponjala',
);
assert(((gates.fixDoubleQuestion('как дела? а что вечером?') || '').match(/\?/g) || []).length <= 1, 'one q');

const stacked = gates.applyWave0t6Gates(
  'да да полностью согласна',
  [],
  'мне кажется надо бросать курить',
);
assert(/почти|спорно|не всегда|но/i.test(stacked), 'agree stack');

const why = gates.fixWhyHereScript('просто общаюсь)', 'зачем ты здесь');
assert(!/просто общаюсь/i.test(why), 'why here');

const ar = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/Не терапевт|Макс один/.test(ar), 'craft');
const ma = fs.readFileSync(path.join(__dirname, '../services/messageAnalysis.js'), 'utf8');
assert(/сначала ты/.test(ma), 'media_ask move');

console.log('SMOKE_0t6_OK');
process.exit(0);
