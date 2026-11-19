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

check('html_bulk_btns', /bulk-start-panel/.test(html) && /bulk-stop-panel/.test(html));
check('html_styles_v89', /styles\.css\?v=89/.test(html));
check('html_updates_v215', /updates\.js\?v=215/.test(html));
check('css_brand_graphite', /\.brand-mark__love[\s\S]*?#8a9288/.test(css) && /\.brand-mark__russian[\s\S]*?#8a9288/.test(css));
check('css_no_blue_brand', !/#9ec8e8/.test(css));
check('css_panel_deck_visible', /\.panel-deck[\s\S]*?overflow:\s*visible/.test(css));
check('css_bulk_flex', /\.panel-bulk__actions \.btn[\s\S]*?inline-flex/.test(css));
check('css_btn_no_forwards_press', !/\.btn:active[\s\S]{0,80}forwards/.test(css));
check('css_card_overflow_visible', /\.card \{\s*overflow:\s*visible/.test(css));
check('updates_title', /Кнопки на панели и цвет названия/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK panel_btns_0kj');
process.exit(0);
