'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const g = require(path.join(__dirname, '../services/softHumanGates'));
const hist = [{ role: 'assistant', content: 'спасибо что написал)' }];
const rewritten = g.fixSpasiboStamp('спасибо что написал)', hist);
assert(rewritten && !/^спасибо\s+что\s+написа/i.test(rewritten), 'spasibo rewrite');
const first = g.fixSpasiboStamp('спасибо что написал)', []);
assert(/^спасибо\s+что\s+написа/i.test(first), 'first ok');
const wave = g.applyWave0t6Gates('спасибо что написал)', hist, 'хай');
assert(wave && !/^спасибо\s+что\s+написа/i.test(wave), 'wave');
console.log('SMOKE_0t20_OK');
