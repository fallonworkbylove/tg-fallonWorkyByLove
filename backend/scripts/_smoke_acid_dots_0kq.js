'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
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

check('html_v96', /styles\.css\?v=96/.test(html));
check('html_app_v182', /app\.js\?v=182/.test(html));
check('html_updates_v222', /updates\.js\?v=222/.test(html));
check('css_acid_var', /--acid:\s*#b8ff3c/.test(css));
check('css_dot_acid', /\.online-dot\.is-online \{[\s\S]*?var\(--acid/.test(css));
check('css_meta_acid', /\.account-card__meta strong \{[\s\S]*?var\(--acid/.test(css));
check('app_no_tg_primary_override', !/setProperty\('--primary',\s*tp\.button_color\)/.test(app));
check('app_force_acid', /setProperty\('--primary',\s*'#b8ff3c'\)/.test(app));
check('updates_title', /Точки и цифры без голубого/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK acid_dots_0kq');
process.exit(0);
