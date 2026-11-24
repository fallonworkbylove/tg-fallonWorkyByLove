'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const ai = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/Не начинай с «слушай\/короче»/.test(ai), 'craft ban opener');
assert(/Не крути «мило/.test(ai), 'alive ban milo');
const lite = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
const safeBlock = lite.match(/const SAFE_ACK_VARIANTS = \[([\s\S]*?)\];/)?.[1] || '';
const safeEntries = [...safeBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert(!safeEntries.includes('слушай)'), 'safe ack no slushay');
const mem = fs.readFileSync(path.join(__dirname, '../services/memoryTriggers.js'), 'utf8');
assert(/sport:\s*\(\)\s*=>\s*pickPoke/.test(mem), 'sport poke');
assert(/show:\s*\(\)\s*=>\s*pickPoke/.test(mem), 'show poke');
console.log('SMOKE_0t24_OK');
