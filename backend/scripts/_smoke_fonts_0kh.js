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

check('css_font_manrope', /--font:\s*"Manrope"/.test(css));
check('css_display_syne', /--display:\s*"Syne"/.test(css));
check('css_no_space_grotesk', !/Space Grotesk/.test(css));
check('css_no_dm_sans', !/DM Sans/.test(css));
check('html_fonts_link', /family=Manrope:.*family=Syne:/.test(html));
check('html_no_space_dm', !/Space\+Grotesk|DM\+Sans/.test(html));
check('html_styles_bumped', /styles\.css\?v=\d+/.test(html));
check('html_updates_bumped', /updates\.js\?v=\d+/.test(html));
check('html_app_bumped', /app\.js\?v=\d+/.test(html));
check('app_banner_manrope', /Manrope,system-ui/.test(app) && !/Figtree/.test(app));
check('updates_has_font_note', /шрифт/i.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK fonts_0kh');
process.exit(0);
