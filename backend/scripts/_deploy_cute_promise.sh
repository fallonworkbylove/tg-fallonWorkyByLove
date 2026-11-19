#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian/backend
cp /tmp/mediaSend.js /tmp/replyPipeline.js "$ROOT/services/"
cp /tmp/_smoke_10of10_fixes.js "$ROOT/scripts/"
cd "$ROOT"
# Не ставить dummy OPENAI_API_KEY в этом shell — pm2 restart --update-env отравит прод.
node -e "process.env.OPENAI_API_KEY='local-smoke-only'; require('child_process').execSync('node scripts/_smoke_10of10_fixes.js',{stdio:'inherit',env:{...process.env,OPENAI_API_KEY:'local-smoke-only'}})" 2>/dev/null | grep -E '^(ok cute|ok nudge|ok hard|ok force|ok strip_cute|FAIL|smoke|failed)' || true
# Рестарт без подмены ключа: взять из .env
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
pm2 restart tgbot --update-env
sleep 2
echo "PID=$(pm2 pid tgbot)"
echo DEPLOY_OK
