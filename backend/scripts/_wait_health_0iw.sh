#!/bin/bash
set -e
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  h=$(curl -s http://127.0.0.1:3000/api/health)
  echo "$(date -u +%H:%M:%S) $h"
  echo "$h" | grep -q '"online":[1-9]' && echo HEALTHY && exit 0
  # bootstrap done?
  if grep -a 'Восстановление сессий завершено' /root/.pm2/logs/tgbot-out.log | tail -1 | grep -q завершено; then
    last=$(grep -a 'Восстановление сессий завершено' /root/.pm2/logs/tgbot-out.log | tail -1)
    echo "last_boot: $last"
  fi
  sleep 30
done
echo TIMEOUT
curl -s http://127.0.0.1:3000/api/health
exit 1
