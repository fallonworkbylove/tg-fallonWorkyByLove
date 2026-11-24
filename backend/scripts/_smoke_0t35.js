'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const gates = fs.readFileSync(path.join(__dirname, '../services/softHumanGates.js'), 'utf8');
const alts = gates.match(/DEAD_FILLER_ALTS = \[([^\]]+)\]/)?.[1] || '';
assert(/а дальше что/.test(alts), 'new dead alts');
assert(!/интересно, и что/.test(alts), 'no interesting dead alt');
const extra = fs.readFileSync(path.join(__dirname, '../services/humanExtra.js'), 'utf8');
assert(/хех только сейчас/.test(extra), 'awayReturn');
console.log('SMOKE_0t35_OK');
