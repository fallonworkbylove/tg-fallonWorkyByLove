'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const files = [
  'humanIdeas11.js',
  'humanIdeas12.js',
  'humanIdeas14.js',
  'humanIdeas16.js',
  'humanThinLayer.js',
];
for (const f of files) {
  const src = fs.readFileSync(path.join(__dirname, '../services', f), 'utf8');
  // ignore comments that mention the banned phrases
  const live = src
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
    .join('\n');
  assert(!/'поняла тебя\)'/.test(live), `${f} no поняла тебя`);
  assert(!/'ну ладно\)'/.test(live), `${f} no ну ладно`);
}
const ai = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(!/BROKEN_CHAT_FALLBACKS = \[[^\]]*ахах ладно/.test(ai), 'broken fallbacks');
console.log('SMOKE_0t32_OK');
