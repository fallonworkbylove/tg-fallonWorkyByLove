#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
# sync latest from /tmp
for f in externalFacts.js dailyPhotos.js nftCampaign.js objectionHandler.js personaFacts.js replyPipeline.js; do
  if [ -f "/tmp/$f" ]; then cp -f "/tmp/$f" "$ROOT/backend/services/$f"; fi
done
[ -f /tmp/updates.js ] && cp -f /tmp/updates.js "$ROOT/frontend/updates.js"
[ -f /tmp/index.html ] && cp -f /tmp/index.html "$ROOT/frontend/index.html"
cd "$ROOT/backend"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
unset DAILY_PHOTO_ENABLED || true
timeout 50 pm2 restart tgbot --update-env
pm2 save
sleep 4
bash /tmp/_full_hard_10of10.sh
