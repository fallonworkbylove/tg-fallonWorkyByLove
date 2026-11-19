#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cp -f /tmp/softHumanLite.js /tmp/humanThinLayer.js /tmp/aiResponder.js "$ROOT/backend/services/"
cp -f /tmp/updates.js /tmp/index.html "$ROOT/frontend/"
cd "$ROOT/backend"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
pm2 restart tgbot --update-env
pm2 save
sleep 2
echo "pid=$(pm2 pid tgbot)"
grep -n 'этап знакомства\|эталон — тёплый\|Пишет как в живом' "$ROOT/backend/services/aiResponder.js" "$ROOT/backend/services/humanThinLayer.js" "$ROOT/frontend/updates.js" | head -10
echo DEPLOY_OK
