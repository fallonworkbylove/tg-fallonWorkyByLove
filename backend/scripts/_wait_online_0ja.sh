#!/bin/bash
set -euo pipefail
for i in 1 2 3 4 5 6 7 8; do
  h=$(curl -sS http://127.0.0.1:3000/api/health)
  echo "check_$i $h"
  echo "$h" | grep -q '"online":[1-9]' && echo ONLINE_OK && break
  sleep 35
done
echo '--- activate tail ---'
tail -n 120 /root/.pm2/logs/tgbot-out.log | grep -aE 'активирован|ошибка|retry done|подключён|bootstrap|AUTH_KEY|волна' | tail -40
echo '--- err AUTH ---'
tail -n 40 /root/.pm2/logs/tgbot-error.log | grep -aE 'AUTH_KEY|прокси|SESSION_WATCH|подключ' | tail -20
curl -sS http://127.0.0.1:3000/api/health; echo
