'use strict';
process.env.AUDIT_SMOKE = '1';
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const gates = require(path.join(__dirname, '../services/softHumanGates'));
const circle = gates.fixCircleAskDodge('щас запишу)', 'скинь кружок');
assert(/сначала ты|сперва ты|ты перв/i.test(circle), 'circle you-first');

const dl = fs.readFileSync(path.join(__dirname, '../services/dailyLife.js'), 'utf8');
assert(/IDLE_POKE_RU_EVENING/.test(dl), 'evening pokes');
assert(/listPeerFacts/.test(dl), 'name poke');
assert(/мне скучно, напиши/.test(dl), 'alive poke');

console.log('SMOKE_0t7_OK');
process.exit(0);
