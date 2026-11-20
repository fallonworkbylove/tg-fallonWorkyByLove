/** Smoke 0m4 — карточки Идей не на белом фоне. */
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
const block = css.match(/\.admin-idea-card\s*\{[^}]+\}/);
assert(block, 'idea card rule');
assert(!/#fff|#f3eee6|--surface/.test(block[0]), 'no light surface');
assert(/var\(--text/.test(block[0]) && /var\(--bg-elevated/.test(block[0]), 'dark tokens');
assert(/updates\.js\?v=261/.test(html) && /styles\.css\?v=111/.test(html), 'bumps');
console.log('SMOKE_IDEAS_CONTRAST_0M4_OK');
process.exit(0);
