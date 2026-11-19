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

check('html_v93', /styles\.css\?v=93/.test(html));
check('html_updates_v219', /updates\.js\?v=219/.test(html));
check('css_list_gap16', /\.activity-list \{[\s\S]*?gap:\s*16px/.test(css));
check('css_item_pad16', /\.activity-item \{[\s\S]*?padding:\s*16px/.test(css));
check('css_content_gap16', /\.content \{[\s\S]*?gap:\s*16px/.test(css));
check('css_meta_gap10', /\.activity-meta \{[\s\S]*?gap:\s*10px/.test(css));
check('updates_title', /Больше воздуха между плашками/.test(updates));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK spacing_0kn');
process.exit(0);
