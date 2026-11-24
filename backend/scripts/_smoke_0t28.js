'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const daily = fs.readFileSync(path.join(__dirname, '../services/dailyLife.js'), 'utf8');
const morning = daily.match(/const MORNING_GREETINGS = \[([\s\S]*?)\];/)?.[1] || '';
const morningQuotes = [...morning.matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert(!morningQuotes.some((s) => /солнышко/.test(s)), 'no солнышко');
assert(morningQuotes.some((s) => /глаза ещё не открыла/.test(s)), 'new morning');
const lite = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(!/'хех, ясно\)'/.test(lite), 'no hex yasno');
console.log('SMOKE_0t28_OK');
