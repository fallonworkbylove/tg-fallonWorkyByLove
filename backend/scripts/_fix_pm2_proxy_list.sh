#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

# Подтянуть полный PROXY_LIST из .env в окружение перед pm2 --update-env
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text = Path('.env').read_text(encoding='utf-8', errors='ignore')
keys = [
  'OPENAI_API_KEY', 'ADMIN_CONSOLE_TOKEN', 'PROXY_LIST', 'PROXY_LIST_LOGIN',
  'PROXY_FILE', 'PROXY_FILE_LOGIN', 'BOT_TOKEN', 'PORT',
]
for key in keys:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if not m:
        continue
    val = m.group(1).strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        val = val[1:-1]
    # shell-safe single-quoted export
    safe = val.replace("'", "'\"'\"'")
    print(f"export {key}='{safe}'")
PY
)"

COUNT=$(python3 - <<'PY'
import os
print(len([x for x in os.environ.get('PROXY_LIST','').replace('\n',';').split(';') if x.strip()]))
PY
)
echo "PROXY_LIST entries to inject: $COUNT"
if [ "$COUNT" -lt 2 ]; then
  echo "REFUSING: PROXY_LIST too short in .env/env"
  exit 1
fi

timeout 60 pm2 restart tgbot --update-env
pm2 save
sleep 6

node <<'NODE'
require('dotenv').config();
const http = require('http');
const tok = process.env.ADMIN_CONSOLE_TOKEN;
http.get({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  path: '/api/admin/console/proxies',
  headers: { 'X-Admin-Console-Token': tok, Accept: 'application/json' },
  timeout: 30000,
}, (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('fail', res.statusCode, b.slice(0, 200));
      process.exit(1);
    }
    const j = JSON.parse(b);
    const work = j.proxies?.work?.length || 0;
    const login = j.proxies?.login?.length || 0;
    console.log(JSON.stringify({
      work,
      login,
      workHosts: (j.proxies?.work || []).map((x) => x.label),
    }, null, 2));
    if (work < 2) {
      console.error('STILL_ONE_WORK_PROXY');
      process.exit(1);
    }
    console.log('PROXY_FIX_OK');
  });
}).on('error', (e) => { console.error(e); process.exit(1); });
NODE
