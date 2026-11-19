#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cp -f /tmp/dailyPhotos.js "$ROOT/backend/services/"
cp -f /tmp/updates.js /tmp/index.html "$ROOT/frontend/"
cd "$ROOT/backend"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
# убедиться что не осталось DAILY_PHOTO_ENABLED=0 в env процесса
unset DAILY_PHOTO_ENABLED || true
timeout 50 pm2 restart tgbot --update-env
pm2 save
sleep 3
echo "pid=$(pm2 pid tgbot)"
grep -n 'DAILY_PHOTO_ENABLED\|Планировщик' "$ROOT/backend/services/dailyPhotos.js" | head -8
pm2 logs tgbot --lines 40 --nostream 2>/dev/null | grep -i 'dailyPhotos\|профит' | tail -5 || true
grep -n 'Скрины по работе снова\|updates.js?v=63' "$ROOT/frontend/updates.js" "$ROOT/frontend/index.html" | head -5
echo PROFIT_ON_OK
