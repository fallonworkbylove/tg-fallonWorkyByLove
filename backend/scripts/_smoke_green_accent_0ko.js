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

check('html_v94', /styles\.css\?v=94/.test(html));
check('html_updates_v220', /updates\.js\?v=220/.test(html));
check('css_no_media_blue_border', !/#7eb8e8/.test(css));
check('css_no_media_blue_rgba', !/126, 184, 232/.test(css));
check('css_media_green', /\.activity-item\.is-media[\s\S]*?border-left-color:\s*var\(--primary\)/.test(css));
check('css_kind_green', /\.activity-item\.is-media \.activity-kind[\s\S]*?#c8f26a/.test(css));
check('updates_title', /Зелёные метки в ленте/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK green_accent_0ko');
process.exit(0);
