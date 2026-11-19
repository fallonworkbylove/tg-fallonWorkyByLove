#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
F="$ROOT/frontend"

cp -f /tmp/adminConsoleStats.js "$B/services/"
cp -f /tmp/adminConsole.js "$B/routes/"
cp -f /tmp/dashboard.js "$B/routes/"
cp -f /tmp/server.js "$B/"
cp -f /tmp/app.js /tmp/styles.css /tmp/index.html /tmp/updates.js "$F/"

cd "$B"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
if [ -z "$KEY" ] || [[ "$KEY" == sk-test* ]]; then
  echo "BAD_OPENAI_KEY"
  exit 1
fi
export OPENAI_API_KEY="$KEY"

node -e "
require('./services/adminConsoleStats');
require('./routes/adminConsole');
const s=require('fs').readFileSync('server.js','utf8');
if(!/admin\/console/.test(s)) { console.error('fail route'); process.exit(1); }
const a=require('fs').readFileSync('../frontend/app.js','utf8');
if(!/openAdminConsole/.test(a)) { console.error('fail frontend'); process.exit(1); }
console.log('smoke_ok');
"

timeout 50 pm2 restart tgbot --update-env
pm2 save
sleep 3
echo "pid=$(pm2 pid tgbot)"
grep -n 'admin/console\|isAdmin\|Админ-консоль\|updates.js?v=70\|app.js?v=62' \
  "$B/server.js" "$B/routes/dashboard.js" "$F/index.html" "$F/updates.js" | head -20
echo DEPLOY_OK
