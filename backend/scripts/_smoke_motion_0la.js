#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const ups = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');
let fail = 0;
function ok(name, cond) {
  console.log(cond ? `OK ${name}` : `FAIL ${name}`);
  if (!cond) fail += 1;
}
ok('css_motion_vars', /--motion:/.test(css) && /--ease-soft:/.test(css));
ok('css_lr_rise', /@keyframes lr-rise/.test(css));
ok('css_tab_is_anim', /\.tab-panel\.active\.is-anim/.test(css));
ok('css_card_hover_lift', /\.card:hover[\s\S]{0,80}translateY\(-2px\)/.test(css));
ok('css_reduced', /prefers-reduced-motion: reduce/.test(css));
ok('index_styles_v', /styles\.css\?v=104/.test(index));
ok('index_updates_v', /updates\.js\?v=232/.test(index));
ok('index_app_v', /app\.js\?v=183/.test(index));
ok('app_is_anim', /is-anim/.test(app) && /offsetWidth/.test(app));
ok('updates_title', /Плавнее переходы в приложении/.test(ups));
process.exit(fail ? 1 : 0);
