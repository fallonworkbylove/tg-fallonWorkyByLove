#!/bin/bash
set -euo pipefail
cp -f /tmp/externalFacts.js /root/opt/tgbot/tg-miniapp-loverussian/backend/services/
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node -e "
const ef=require('./services/externalFacts');
const samples=['сколько время?','Так у тебя сколько время','у тебя сколько времени','который час'];
for (const s of samples) if (!ef.TIME_ASK_RE.test(s)) { console.error('no match', s); process.exit(1); }
console.log('time_ok');
"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
timeout 40 pm2 restart tgbot --update-env
echo TIME_DEPLOY_OK
