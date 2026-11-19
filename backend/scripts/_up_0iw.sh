#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/0iw/server.js "$BASE/backend/"
cp -a /tmp/0iw/sessionBootstrap.js "$BASE/backend/services/" 2>/dev/null || true
cp -a /tmp/0iw/clientPool.js "$BASE/backend/services/" 2>/dev/null || true

# pm2 stop через SIGTERM
pm2 stop tgbot --kill-timeout 15000 || true
sleep 90
pm2 start tgbot --update-env --kill-timeout 15000
pm2 save
# не держим SSH во время bootstrap — выходим; проверка отдельным заходом
echo STARTED
curl -s http://127.0.0.1:3000/api/health; echo
