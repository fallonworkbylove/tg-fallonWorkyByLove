#!/bin/bash
set -euo pipefail
bash /tmp/_scrub_err_sktest.sh
cp -f /tmp/_ping_openai.js /root/opt/tgbot/tg-miniapp-loverussian/backend/scripts/
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node scripts/_ping_openai.js
node <<'NODE'
const { execSync } = require('child_process');
const a = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' })).find((x) => x.name === 'tgbot');
const k = (a && a.pm2_env && a.pm2_env.OPENAI_API_KEY) || '';
console.log('FINAL', k.slice(0, 8), 'len=' + k.length, 'sk-test=' + (k === 'sk-test' || /^sk-test/.test(k)));
if (!k || k === 'sk-test' || /^sk-test/.test(k) || k.length < 40) process.exit(2);
NODE
echo -n "dump_sk_test="; grep -c sk-test /root/.pm2/dump.pm2 2>/dev/null || echo 0
echo -n "err_sk_test="; grep -c sk-test /root/.pm2/logs/tgbot-error.log 2>/dev/null || echo 0
echo -n "env_sk_test="; grep -c sk-test .env 2>/dev/null || echo 0
echo ALL_KEY_CLEAN
