#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const index = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const ups = fs.readFileSync(path.join(root, 'frontend/updates.js'), 'utf8');
const checks = [
  [/family=Syne:wght@400;500;600;700;800/, index, 'index Syne link'],
  [/styles\.css\?v=103/, index, 'styles v=103'],
  [/updates\.js\?v=229/, index, 'updates v=229'],
  [/--font:\s*"Syne"/, css, 'css --font'],
  [/--display:\s*"Syne"/, css, 'css --display'],
  [/Syne,system-ui/, app, 'app.js Syne'],
  [/Прежний шрифт на всём экране/, ups, 'updates title'],
  [/Outfit/, index, 'no Outfit in index', true],
  [/Manrope/, index, 'no Manrope in index', true],
];
let fail = 0;
for (const [re, src, label, invert] of checks) {
  const hit = re.test(src);
  const ok = invert ? !hit : hit;
  console.log(ok ? `OK ${label}` : `FAIL ${label}`);
  if (!ok) fail += 1;
}
process.exit(fail ? 1 : 0);
