#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node - <<'NODE'
const { execSync } = require('child_process');
const apps = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
const a = apps.find((x) => x.name === 'tgbot');
const k = (a && a.pm2_env && a.pm2_env.OPENAI_API_KEY) || '';
console.log('pm2_key', k ? `${k.slice(0, 8)}… len=${k.length}` : 'MISSING', k === 'sk-test' ? 'BAD' : 'OK');
console.log('pid', a && a.pid);
NODE
pm2 logs tgbot --err --lines 12 --nostream 2>/dev/null | grep -E 'sk-test|401 Incorrect' | tail -5 || echo 'err_ok'
pm2 logs tgbot --out --lines 60 --nostream 2>/dev/null | grep 'Ответ для' | tail -10 || echo 'no_replies_yet'
echo DONE
