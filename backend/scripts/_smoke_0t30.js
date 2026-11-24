'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const silence = fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8');
assert(/спасибо\|спс\|пасиб/.test(silence), 'soft close thanks');
const daily = fs.readFileSync(path.join(__dirname, '../services/dailyLife.js'), 'utf8');
const night = daily.match(/const NIGHT_GREETINGS = \[([\s\S]*?)\];/)?.[1] || '';
const nightQuotes = [...night.matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert(!nightQuotes.some((s) => /целую|снись/.test(s)), 'no tseluyu/snis');
assert(nightQuotes.some((s) => /глаза слипаются/.test(s)), 'new night');
const gates = fs.readFileSync(path.join(__dirname, '../services/softHumanGates.js'), 'utf8');
const th = gates.match(/THERAPIST_ALTS = \[([^\]]+)\]/)?.[1] || '';
assert(!/держись/.test(th), 'no derzhis');
console.log('SMOKE_0t30_OK');
