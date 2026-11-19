'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const updates = fs.readFileSync(path.join(root, 'frontend', 'updates.js'), 'utf8');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

check('html_v97', /styles\.css\?v=97/.test(html));
check('html_updates_v223', /updates\.js\?v=223/.test(html));
check('css_lead_green', /\.activity-item\.is-lead \{[\s\S]*?border-left-color:\s*#9fd84a/.test(css));
check('css_media_green', /\.activity-item\.is-media \{[\s\S]*?border-left-color:\s*#d4ff6e/.test(css));
check('css_nft_green', /\.activity-item\.is-nft \{[\s\S]*?border-left-color:\s*#b8ff3c/.test(css));
check('css_other_green', /\.activity-item\.is-other \{[\s\S]*?border-left-color:\s*#86e000/.test(css));
check('css_no_blue_hex', !/#7eb8e8/.test(css));
check('css_no_blue_rgba', !/126, 184, 232/.test(css));
check('css_no_media_var_primary', !/\.activity-item\.is-media[\s\S]{0,120}var\(--primary\)/.test(css));
check('updates_title', /Зелёные полоски в ленте/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK stripe_green_0kr');
process.exit(0);
