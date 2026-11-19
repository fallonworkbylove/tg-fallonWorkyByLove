#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
let fail = 0;
function ok(name, cond, d) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, d || '');
  }
}
const css = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const idx = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const upd = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');

ok('inline_text_style', /color:#eef0ff!important/.test(app));
ok('select_all_div', /account-card--select-all" role="group"/.test(app));
ok('critical_css', /fix-acc-text-0jd/.test(idx));
ok('styles_v77', /styles\.css\?v=77/.test(idx));
ok('app_v167', /app\.js\?v=167/.test(idx));
ok('updates_v184', /updates\.js\?v=184/.test(idx));
ok('phone_important', /account-card__phone[\s\S]{0,200}#eef0ff !important/.test(css));
ok('feed', /Текст на номерах — повторный фикс/.test(upd));
try {
  new Function(app);
  ok('parse', true);
} catch (e) {
  ok('parse', false, e.message);
}
if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
