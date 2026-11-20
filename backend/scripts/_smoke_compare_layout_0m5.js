/** Smoke 0m5 — сравнение A/B не overflow. */
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '../../frontend/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
}
assert(/options-actions\.admin-compare-row/.test(css), 'compare selector');
assert(/minmax\(0,\s*1fr\)/.test(css), 'minmax fr');
assert(/grid-column:\s*1\s*\/\s*-1/.test(css), 'btn full width');
assert(!/admin-compare-row\s*\{\s*grid-template-columns:\s*1fr 1fr auto/.test(css), 'no old 3col');
assert(/updates\.js\?v=262/.test(html) && /styles\.css\?v=112/.test(html), 'bumps');
console.log('SMOKE_COMPARE_LAYOUT_0M5_OK');
process.exit(0);
