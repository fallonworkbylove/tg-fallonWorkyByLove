/**
 * Smoke 0m8 — фиксы Graphify review: owner/health/filter + TZ wrap.
 */
const fs = require('fs');
const path = require('path');
const pack = require('../services/scaleIdeasPack');

function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
}

const app = fs.readFileSync(path.join(__dirname, '../../frontend/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');

assert(!/a\.pool \|\| owner \|\|/.test(app), 'no bare owner in pool flag');
assert(/a\.pool \|\| ownerLabel/.test(app), 'uses ownerLabel');
assert(/Number\.isFinite\(Number\(a\.health\)\)/.test(app), 'health finite');
assert(/function setAdminOwnerFilter[\s\S]{0,400}?renderAdmin\(\)/.test(app), 'filter re-renders');

assert(pack.wrapDayMinutes(-45) === 1395, 'wrap -45 -> 23:15');
assert(pack.wrapDayMinutes(1500) === 60, 'wrap 1500 -> 1:00');
const life = pack.shiftLifeByCityTz(
  { wakeMin: 9 * 60, sleepMin: 23 * 60, afternoonMin: 15 * 60, eveningMin: 20 * 60 },
  'Ты — Кира из Владивостока',
);
assert(life.tzOffsetMin === 420, 'vlad offset');
assert(life.wakeMin >= 0 && life.wakeMin < 1440, 'wake wrapped');
assert(life.sleepMin >= 0 && life.sleepMin < 1440, 'sleep wrapped');

assert(/updates\.js\?v=265/.test(html) && /app\.js\?v=190/.test(html), 'bumps');
console.log('SMOKE_REVIEW_FIXES_0M8_OK');
process.exit(0);
