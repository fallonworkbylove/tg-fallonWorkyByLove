#!/usr/bin/env node
/** Local: B&W miniapp CSS + sync updates to ops + bump cache + changelog. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const cssPath = path.join(root, 'frontend', 'styles.css');
const updatesPath = path.join(root, 'frontend', 'updates.js');
const indexPath = path.join(root, 'frontend', 'index.html');
const opsUpdates = path.join(root, 'ops-console', 'app', 'updates.js');
const changelogPath = path.join(root, 'CHANGELOG_TG.md');

let css = fs.readFileSync(cssPath, 'utf8');
css = css.replace(
  /:root \{[\s\S]*?\n\}/,
  `:root {
  color-scheme: dark;
  --bg: #0a0a0a;
  --bg-elevated: #141414;
  --card: rgba(22, 22, 22, 0.96);
  --text: #f2f2f2;
  --muted: #9a9a9a;
  --primary: #e8e8e8;
  --primary-strong: #ffffff;
  --primary-soft: rgba(255, 255, 255, 0.12);
  --accent-cool: rgba(255, 255, 255, 0.08);
  --accent-pink: rgba(255, 255, 255, 0.1);
  --danger: #c8c8c8;
  --danger-strong: #ffffff;
  --border: rgba(255, 255, 255, 0.1);
  --border-strong: rgba(255, 255, 255, 0.18);
  --shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
  --radius: 16px;
  --font: "Figtree", "Segoe UI", system-ui, -apple-system, sans-serif;
  --display: "Bricolage Grotesque", "Figtree", system-ui, sans-serif;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
}`,
);

const map = [
  ['#0c0812', '#0a0a0a'],
  ['#160c18', '#111111'],
  ['#18121e', '#141414'],
  ['#e879c8', '#e8e8e8'],
  ['#c026d3', '#ffffff'],
  ['#f0abfc', '#d4d4d4'],
  ['#fdf2f8', '#f5f5f5'],
  ['#d4b4ff', '#d0d0d0'],
  ['#c9a0ff', '#c8c8c8'],
  ['#7c3aed', '#b0b0b0'],
  ['#b07cff', '#c0c0c0'],
  ['#f472b6', '#d8d8d8'],
  ['#a855f7', '#b8b8b8'],
  ['#fae8ff', '#eeeeee'],
  ['#faf7ff', '#f5f5f5'],
  ['#e0c8ff', '#dcdcdc'],
  ['rgba(232, 121, 200', 'rgba(255, 255, 255'],
  ['rgba(192, 38, 211', 'rgba(255, 255, 255'],
  ['rgba(168, 85, 247', 'rgba(255, 255, 255'],
  ['rgba(244, 114, 182', 'rgba(255, 255, 255'],
  ['rgba(176, 124, 255', 'rgba(255, 255, 255'],
  ['rgba(48, 18, 42', 'rgba(30, 30, 30'],
  ['rgba(22, 12, 26', 'rgba(16, 16, 16'],
  ['rgba(10, 6, 14', 'rgba(8, 8, 8'],
  ['rgba(40, 8, 36', 'rgba(0, 0, 0'],
  ['rgba(26, 16, 32', 'rgba(22, 22, 22'],
];
for (const [a, b] of map) css = css.split(a).join(b);
fs.writeFileSync(cssPath, css, 'utf8');
console.log('css_bw', cssPath);

let updates = fs.readFileSync(updatesPath, 'utf8');
if (!/Чёрно-белый интерфейс|Черно-белый интерфейс/.test(updates)) {
  const entry = `  {
    date: '30 октября',
    tag: 'МАЛЕНЬКОЕ',
    title: 'Чёрно-белый интерфейс',
    lead: 'Миниапп переведён на чёрно-белый стиль — спокойнее глазу, без цветных градиентов.',
    items: [
      'Акценты и кнопки в оттенках серого и белого.',
    ],
  },
`;
  updates = updates.replace(
    /(window\.LOVERUSSIAN_UPDATES = \[\r?\n  \/\* ——— октябрь 2026 ——— \*\/\r?\n)/,
    `$1${entry}`,
  );
  fs.writeFileSync(updatesPath, updates, 'utf8');
  console.log('updates_bw_entry');
}

fs.copyFileSync(updatesPath, opsUpdates);
console.log('ops_synced');

let index = fs.readFileSync(indexPath, 'utf8');
index = index
  .replace(/styles\.css\?v=\d+/, 'styles.css?v=69')
  .replace(/updates\.js\?v=\d+/, 'updates.js?v=99');
fs.writeFileSync(indexPath, index, 'utf8');

let cl = fs.readFileSync(changelogPath, 'utf8');
if (!/## 0fs\./.test(cl)) {
  cl = cl.replace(
    /## 0fr\./,
    `## 0fs. 30 окт — miniapp ч/б + changelog ops

Стили miniapp: чёрно-белая палитра. updates.js синхрон в ops-console + VPS. Лента: (updates.js?v=99), styles?v=69.

## 0fr.`,
  );
  fs.writeFileSync(changelogPath, cl, 'utf8');
}

console.log('BW_LOCAL_OK');
