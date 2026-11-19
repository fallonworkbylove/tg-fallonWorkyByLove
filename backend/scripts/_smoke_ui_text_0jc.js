#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const idx = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const upd = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');

ok('card_hard_color', /\.account-card\s*\{[\s\S]{0,280}color:\s*#eef0ff/.test(css));
ok('phone_hard_color', /\.account-card__phone\s*\{[\s\S]{0,180}color:\s*#eef0ff/.test(css));
ok('label_card_color', /label\.account-card\s*\{[\s\S]{0,120}#eef0ff/.test(css));
ok('theme_text_luma_guard', /textLuma\s*>=\s*0\.55/.test(app));
ok('styles_bump', /styles\.css\?v=76/.test(idx));
ok('app_bump', /app\.js\?v=166/.test(idx));
ok('changelog_feed', /Вернули текст на карточках/.test(upd));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
