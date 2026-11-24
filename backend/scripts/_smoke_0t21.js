'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const g = require(path.join(__dirname, '../services/softHumanGates'));
const lite = require(path.join(__dirname, '../services/softHumanLite'));

const milo = g.fixMiloAlone('мило)', 'сегодня весь день ездил по городу и устал');
assert(milo && !/^мило\s*\)?$/i.test(milo), 'milo alone');

const love = g.fixLoveStampOveruse('ой мило)', [
  { role: 'assistant', content: 'мне приятно)' },
]);
assert(love && !/мило/i.test(love), 'love+milo stamp');

const src = require('fs').readFileSync(
  path.join(__dirname, '../services/softHumanLite.js'),
  'utf8',
);
assert(!/SOFT_ALTS = \[[^\]]*ну ладно\)/.test(src), 'soft alts no nu ladno');
assert(typeof lite.softenCoachy === 'function' || src.includes('softenCoachy'), 'soften exists');

console.log('SMOKE_0t21_OK');
