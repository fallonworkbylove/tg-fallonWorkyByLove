#!/bin/bash
set -euo pipefail
for i in 1 2 3 4 5 6; do
  echo "check_$i"
  curl -sS http://127.0.0.1:3000/api/health; echo
  sleep 40
done
echo '--- recent activate ---'
grep -aE 'Аккаунт .* онлайн|сессия .* готова|AUTH_KEY|подключ|online=|активир' /root/.pm2/logs/tgbot-out.log | tail -30
grep -aE 'AUTH_KEY_DUPLICATED|retry done' /root/.pm2/logs/tgbot-error.log | tail -20
