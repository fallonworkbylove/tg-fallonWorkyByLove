#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/0iw/sessionBootstrap.js "$BASE/backend/services/" 2>/dev/null || true
# already copied clientPool/server earlier
curl -s http://127.0.0.1:3000/api/health; echo
echo "graceful stop 120s…"
pm2 stop tgbot
sleep 120
pm2 start tgbot --update-env
pm2 save
echo "wait bootstrap 150s…"
sleep 150
curl -s http://127.0.0.1:3000/api/health; echo
grep -aE 'завершено|retry done|уже идёт|активирован' /root/.pm2/logs/tgbot-out.log | tail -30
echo DONE
