#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cp -f /tmp/adminConsoleStats.js "$B/services/"
cd "$B"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
TOK=$(python3 -c "import re;m=re.search(r'^ADMIN_CONSOLE_TOKEN=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
export ADMIN_CONSOLE_TOKEN="$TOK"
timeout 50 pm2 restart tgbot --update-env
sleep 4
node <<'NODE'
require('dotenv').config();
const http = require('http');
http.get({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  path: '/api/admin/console',
  headers: { 'X-Admin-Console-Token': process.env.ADMIN_CONSOLE_TOKEN, Accept: 'application/json' },
  timeout: 60000,
}, (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => {
    const j = JSON.parse(b);
    const a = j.console.accounts.list[0] || {};
    console.log(JSON.stringify({
      ok: res.statusCode === 200,
      hasPrompt: typeof a.prompt === 'string',
      promptLen: (a.prompt || '').length,
      phone: a.phone,
      peers: a.peersTotal,
    }));
    if (res.statusCode !== 200 || typeof a.prompt !== 'string') process.exit(1);
    console.log('DEPLOY_OK');
  });
}).on('error', (e) => { console.error(e); process.exit(1); });
NODE
