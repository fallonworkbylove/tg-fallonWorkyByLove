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
  [/family=Outfit:wght@400;500;600;700;800/, index, 'index Outfit link'],
  [/styles\.css\?v=102/, index, 'styles v=102'],
  [/updates\.js\?v=228/, index, 'updates v=228'],
  [/--font:\s*"Outfit"/, css, 'css --font'],
  [/--display:\s*"Outfit"/, css, 'css --display'],
  [/Outfit,system-ui/, app, 'app.js Outfit'],
  [/Один шрифт во всём приложении/, ups, 'updates title'],
  [/Syne/, index, 'no Syne in index', true],
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
