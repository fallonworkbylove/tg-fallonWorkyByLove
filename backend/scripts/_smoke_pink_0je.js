#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
let fail = 0;
function ok(n, c, d) {
  if (c) console.log('OK', n);
  else {
    fail += 1;
    console.log('FAIL', n, d || '');
  }
}
const css = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const idx = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const upd = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');
ok('primary_pink', /--primary:\s*#e879c8/.test(css));
ok('brand_pink', /#fdf2f8.*#f0abfc/.test(css));
ok('bg_pink', /--bg:\s*#0c0812/.test(css));
ok('card_text', /#f8f0f6 !important/.test(css));
ok('styles_v78', /styles\.css\?v=78/.test(idx));
ok('app_v168', /app\.js\?v=168/.test(idx));
ok('updates_v185', /updates\.js\?v=185/.test(idx));
ok('inline_pink', /color:#f8f0f6!important/.test(app));
ok('critical', /fix-acc-text-0je/.test(idx));
ok('feed', /Снова розово-фиолетовый вид/.test(upd));
if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
