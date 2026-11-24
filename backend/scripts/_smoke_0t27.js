'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const reg = fs.readFileSync(path.join(__dirname, '../services/replyGateRegistry.js'), 'utf8');
const clicheAlts = reg.match(/const CLICHE_ALTS = \{([\s\S]*?)\n\};/)?.[1] || '';
assert(!/'поняла\)': \[[^\]]*ясно\)/.test(clicheAlts), 'поняла alts');
assert(!/'ну ок': \[[^\]]*ясно\)/.test(clicheAlts), 'nu ok alts');
const scale = fs.readFileSync(path.join(__dirname, '../services/scaleOps.js'), 'utf8');
const scaleAlts = scale.match(/0t27:[\s\S]{0,120}const alts = \[([^\]]+)\]/)?.[1] || '';
assert(scaleAlts.length > 0, 'scale alts found');
assert(!/поняла тебя/.test(scaleAlts), 'scale no therapist');
assert(/слышу\)/.test(scaleAlts), 'scale has alive alts');
const lite = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(!/ясно\) слушай/.test(lite), 'kaif pivot');
console.log('SMOKE_0t27_OK');
