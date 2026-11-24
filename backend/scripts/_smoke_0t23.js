'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const g = require(path.join(__dirname, '../services/softHumanGates'));

const hex = g.fixHexAloneOveruse('хех)', [{ role: 'assistant', content: 'мм)' }]);
assert(hex && !/^хех+\s*\)?$/i.test(hex), 'hex alone');

const rada = g.fixRadaChtoEcho('рада что ты написал)', []);
assert(rada && !/^рада\s+что/i.test(rada), 'rada short');
assert(!/ну ты милый/i.test(rada), 'rada no love loop');

const wave = g.applyWave0t6Gates('хех)', [{ role: 'assistant', content: 'хех)' }], 'ну');
assert(wave && !/^хех+\s*\)?$/i.test(wave), 'wave hex');

console.log('SMOKE_0t23_OK');
