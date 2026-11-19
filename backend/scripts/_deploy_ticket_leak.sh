#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian/backend
cp -f /tmp/mediaSend.js /tmp/replyPipeline.js /tmp/mediaReplies.js "$ROOT/services/"
cp -f /tmp/_smoke_10of10_fixes.js "$ROOT/scripts/"
cd "$ROOT"
# Smoke в подпроцессе с dummy-ключом — НЕ экспортировать dummy в этот shell / pm2.
node -e "require('child_process').execSync('node scripts/_smoke_10of10_fixes.js',{stdio:'inherit',env:{...process.env,OPENAI_API_KEY:'local-smoke-only'}})" 2>/dev/null | grep -E '^(ok leak|ok where|ok bare|ok specific_ticket|ok no_selfie|ok deflect_ticket|FAIL|smoke|failed)' || true
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
pm2 restart tgbot --update-env
sleep 2
echo "PID=$(pm2 pid tgbot)"
echo DEPLOY_OK
