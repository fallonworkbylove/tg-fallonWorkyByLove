#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT"

echo "=== telegramClient imports from aiResponder ==="
node <<'NODE'
const fs = require('fs');
const tc = fs.readFileSync('backend/services/telegramClient.js', 'utf8');
const m = tc.match(/\{([^}]+)\}\s*=\s*require\(['"]\.\/aiResponder['"]\)/);
if (!m) { console.log('no destructure import found'); process.exit(0); }
const names = m[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+$/,'').split('=')[0].trim()).filter(Boolean);
const { execSync } = require('child_process');
const oct1 = execSync('git show 7c97b46:backend/services/aiResponder.js', { maxBuffer: 8e6 }).toString();
const missing = [];
for (const n of names) {
  const ok =
    new RegExp('(?:function|async function|const|let|var)\\s+' + n + '\\b').test(oct1) ||
    oct1.includes('module.exports.' + n) ||
    new RegExp('^\\s*' + n + '\\s*,\\s*$', 'm').test(oct1);
  console.log(ok ? 'OK  ' : 'MISS', n);
  if (!ok) missing.push(n);
}
console.log('MISSING_COUNT', missing.length);
if (missing.length) console.log('MISSING_LIST', missing.join(','));
NODE

echo "=== file sizes ==="
git show 7c97b46:backend/services/aiResponder.js | wc -c
wc -c backend/services/aiResponder.js
