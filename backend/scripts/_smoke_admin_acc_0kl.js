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

check('html_v91', /styles\.css\?v=91/.test(html));
check('html_app_v179', /app\.js\?v=179/.test(html));
check('html_updates_v217', /updates\.js\?v=217/.test(html));
check('css_top_grid', /\.admin-acc__top \{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) auto/.test(css));
check('css_stats_3col', /\.admin-acc__stats \{[\s\S]*?grid-template-columns:\s*repeat\(3/.test(css));
check('css_stat_centered', /\.admin-acc__stat \{[\s\S]*?align-items:\s*center/.test(css));
check('css_actions_2col', /\.admin-acc__actions \{[\s\S]*?grid-template-columns:\s*repeat\(2/.test(css));
check('css_btn_centered', /\.admin-acc__actions \.btn \{[\s\S]*?inline-flex/.test(css));
check('app_admin_acc', /admin-acc__stats/.test(app) && /admin-acc__actions/.test(app));
check('updates_title', /Карточки аккаунтов ровнее/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK admin_acc_0kl');
process.exit(0);
