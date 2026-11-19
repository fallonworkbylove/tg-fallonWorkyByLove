#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
F="$ROOT/frontend"

cp -f /tmp/leadScoring.js /tmp/adminConsoleStats.js "$B/services/"
cp -f /tmp/adminConsole.js "$B/routes/"
cp -f /tmp/telegramAuth.js "$B/middleware/"
cp -f /tmp/updates.js "$F/"

cd "$B"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
TOK=$(python3 -c "import re;m=re.search(r'^ADMIN_CONSOLE_TOKEN=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export ADMIN_CONSOLE_TOKEN="$TOK"

timeout 50 pm2 restart tgbot --update-env
pm2 save
sleep 5

node <<'NODE'
require('dotenv').config();
const http = require('http');
const tok = process.env.ADMIN_CONSOLE_TOKEN;
http.get({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  path: '/api/admin/console',
  headers: { 'X-Admin-Console-Token': tok, Accept: 'application/json' },
  timeout: 60000,
}, (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('fail', res.statusCode, b.slice(0, 300));
      process.exit(1);
    }
    const j = JSON.parse(b);
    const f = j.console && j.console.funnel;
    console.log(JSON.stringify({
      day: j.console.messages.day.sent,
      online: j.console.accounts.online,
      leads: f ? f.conversations.length : 0,
      funnel: f ? f.funnel : null,
    }));
    if (!f || !Array.isArray(f.conversations)) {
      console.error('no funnel');
      process.exit(1);
    }
    console.log('DEPLOY_OK');
  });
}).on('error', (e) => { console.error(e); process.exit(1); });
NODE
