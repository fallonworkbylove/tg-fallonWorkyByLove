'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const aiSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/0t29: короткая, но многослойная/.test(aiSrc), 'router comment');
assert(/sentences >= 3/.test(aiSrc), 'sentence gate');
assert(/устал\|грустн\|обид/.test(aiSrc), 'emotion gate');

const g = require(path.join(__dirname, '../services/softHumanGates'));
const admit = g.fixBotAdmitLeak('я не человек, я программа)');
assert(admit && !/я\s+не\s+человек/i.test(admit), 'bot admit');
assert(!/поняла,\s*отдыхай/.test(fs.readFileSync(path.join(__dirname, '../services/softHumanGates.js'), 'utf8').match(/PEER_GENDER_ALTS = \[([^\]]+)\]/)?.[1] || ''), 'gender alts');

console.log('SMOKE_0t29_OK');
