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

check('html_topbar_logo', /topbar__logo/.test(html) && /lrTopLogoHeart/.test(html));
check('html_title_row', /topbar__title-row/.test(html) && /id="page-title"/.test(html));
check('html_brand_split', /brand-mark__love/.test(html) && /brand-mark__russian/.test(html));
check('html_styles_v88', /styles\.css\?v=88/.test(html));
check('html_app_v177', /app\.js\?v=177/.test(html));
check('html_updates_v214', /updates\.js\?v=214/.test(html));
check('css_title_row', /\.topbar__title-row/.test(css) && /\.topbar__logo/.test(css));
check('css_stat_ellipsis', /\.stat-card strong[\s\S]*?text-overflow:\s*ellipsis/.test(css));
check('css_no_pink_active', !/#f0abfc|#dcc4ff|#f8f0f6\s*!important/.test(css));
check('css_nav_active_acid', /\.nav-btn\.active[\s\S]*?color:\s*#e8ffe0/.test(css));
check('app_no_inline_pink', !/f0abfc|textStyle|mutedStyle/.test(app));
check('app_account_title', /account-item__title/.test(app));
check('updates_title', /Логотип у заголовка и ровнее экран/.test(updates));
check('fonts_still_syne', /--display:\s*"Syne"/.test(css) && /--font:\s*"Manrope"/.test(css));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK ui_polish_0ki');
process.exit(0);
