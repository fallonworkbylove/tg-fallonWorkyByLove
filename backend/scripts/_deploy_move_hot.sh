#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cp -f /tmp/aiResponder.js "$B/services/"
cd "$B"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
timeout 50 pm2 restart tgbot --update-env
echo DEPLOY_OK pid=$(pm2 pid tgbot)
grep -n 'опять|ну|да' "$B/services/aiResponder.js" | head -5
