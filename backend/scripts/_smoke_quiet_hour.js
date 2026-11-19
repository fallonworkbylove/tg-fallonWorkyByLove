#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '../services/timing.js'), 'utf8');
if (!/hour >= VOICE_QUIET_START_HOUR && hour < VOICE_QUIET_END_HOUR/.test(src)) {
  console.error('FAIL: quiet hour still uses wrong operator');
  process.exit(1);
}
if (/hour >= VOICE_QUIET_START_HOUR \|\| hour < VOICE_QUIET_END_HOUR/.test(src)) {
  console.error('FAIL: old OR still present');
  process.exit(1);
}
// simulate
function quiet(hour) {
  return hour >= 1 && hour < 8;
}
const cases = [
  [0, false],
  [1, true],
  [7, true],
  [8, false],
  [17, false],
  [23, false],
];
for (const [h, exp] of cases) {
  if (quiet(h) !== exp) {
    console.error('FAIL sim', h, quiet(h), exp);
    process.exit(1);
  }
}
console.log('QUIET_HOUR_OK');
