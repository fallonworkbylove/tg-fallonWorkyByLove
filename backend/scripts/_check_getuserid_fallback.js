#!/usr/bin/env node
/**
 * C1: запрет inline getUserId fallback на 1 в routes/services.
 * Разрешён только lib/getUserId.js с throw 401.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const roots = ['routes', 'services', 'middleware', 'lib'].map((d) => path.join(root, d));

const BAD = [
  /dbUser\s*\?\s*[^:]+:\s*1\b/,
  /return\s+req\.dbUser\s*\?\s*[^:]+:\s*1\b/,
  /getUserId\s*=\s*\([^)]*\)\s*=>\s*[^;]*:\s*1\b/,
  /fallback\s+1/i,
];

const ALLOW_COMMENT = /^\s*(\/\/|\*|\/\*)/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.js$/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const dir of roots) {
  for (const file of walk(dir)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (ALLOW_COMMENT.test(line.trim())) return;
      // комментарий в lib/getUserId про «Без fallback на 1» — ок
      if (rel === 'lib/getUserId.js' && /Без fallback|без fallback/i.test(line)) return;
      for (const re of BAD) {
        if (re.test(line)) {
          hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    });
  }
}

if (hits.length) {
  console.error('FAIL getUserId fallback-1');
  hits.forEach((h) => console.error(' ', h));
  process.exit(1);
}

console.log('OK getUserId_no_fallback_1');
process.exit(0);
