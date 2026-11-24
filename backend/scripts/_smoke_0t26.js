'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const g = require(path.join(__dirname, '../services/softHumanGates'));
const lite = require(path.join(__dirname, '../services/softHumanLite'));

const pon = g.fixPonjalaStamp('поняла)', [{ role: 'assistant', content: 'поняла)' }]);
assert(pon && !/^поняла\s*\)?$/i.test(pon), 'ponjala');
assert(!/ясно\)|хм ок\)/i.test(pon), 'ponjala alts clean');

const hist = [{ role: 'assistant', content: 'о как) а как день?' }];
const skipped = lite.ensureReciprocalQuestion('ну да)', hist, 'сегодня ездил в город весь день долго');
assert(skipped === 'ну да)' || !/\?/.test(skipped), 'no second how-ask');

const src = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(!/а у тебя как дела\?\)/.test(src.match(/RECIPROCAL_QS = \[([\s\S]*?)\];/)?.[1] || ''), 'no kak dela');

console.log('SMOKE_0t26_OK');
