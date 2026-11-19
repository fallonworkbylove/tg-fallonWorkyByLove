'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
const updates = fs.readFileSync(path.join(root, 'frontend', 'updates.js'), 'utf8');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

check('html_v90', /styles\.css\?v=90/.test(html));
check('html_app_v178', /app\.js\?v=178/.test(html));
check('html_updates_v216', /updates\.js\?v=216/.test(html));
check('app_inline_online', /\$\{online\}\/\$\{aiOn\}/.test(app));
check('app_no_split_span_online', !/\$\{online\}<span class="stat-card__split">/.test(app));
check('css_label_direct', /\.stat-card > span|\.stat-card__label/.test(css));
check('css_no_all_spans_block', !/\.stat-card span \{\s*display:\s*block/.test(css));
check('updates_title', /Плашка онлайн ровнее/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK stat_inline_0kk');
process.exit(0);
