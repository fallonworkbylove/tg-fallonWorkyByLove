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

check('html_v92', /styles\.css\?v=92/.test(html));
check('html_app_v180', /app\.js\?v=180/.test(html));
check('html_updates_v218', /updates\.js\?v=218/.test(html));
check('app_topline', /activity-item__topline/.test(app));
check('app_no_old_head_main', !/activity-item__head-main/.test(app));
check('css_topline', /\.activity-item__topline/.test(css));
check('css_no_inset_shadow', !/activity-item[\s\S]{0,200}inset 3px/.test(css));
check('css_meta_equal', /\.activity-meta__row \{[\s\S]*?min-height:\s*54px/.test(css));
check('css_border_left', /\.activity-item \{[\s\S]*?border-left-width:\s*3px/.test(css));
check('updates_title', /Лента событий ровнее/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK activity_ui_0km');
process.exit(0);
