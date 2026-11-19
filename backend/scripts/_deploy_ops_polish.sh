#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
F=/root/opt/tgbot/tg-miniapp-loverussian/frontend
cp -f /tmp/adminLogBuffer.js /tmp/adminOps.js /tmp/adminConsoleStats.js "$B/services/"
cp -f /tmp/updates.js /tmp/index.html "$F/"
cd "$B"
# полный PROXY_LIST из .env
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text = Path('.env').read_text(encoding='utf-8', errors='ignore')
for key in ['OPENAI_API_KEY','ADMIN_CONSOLE_TOKEN','PROXY_LIST','PROXY_LIST_LOGIN','BOT_TOKEN','PORT']:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if not m: continue
    val = m.group(1).strip().strip('"').strip("'")
    safe = val.replace("'", "'\"'\"'")
    print(f"export {key}='{safe}'")
PY
)"
timeout 60 pm2 restart tgbot --update-env
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
  headers: { 'X-Admin-Console-Token': tok },
  timeout: 60000,
}, (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => {
    const j = JSON.parse(b);
    const n = j.console?.accounts?.list?.length;
    console.log(JSON.stringify({
      status: res.statusCode,
      accountsListed: n,
      total: j.console?.accounts?.total,
    }));
    if (res.statusCode !== 200 || !n) process.exit(1);
    console.log('POLISH_OK');
  });
}).on('error', (e) => { console.error(e); process.exit(1); });
NODE
