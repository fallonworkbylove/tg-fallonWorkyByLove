#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/workerConnect.js "$B/backend/services/workerConnect.js"
cp /tmp/helpRequestNotifier.js "$B/backend/services/helpRequestNotifier.js"
cp /tmp/CHANGELOG_TG.md "$B/CHANGELOG_TG.md"
node --check "$B/backend/services/workerConnect.js"
node --check "$B/backend/services/helpRequestNotifier.js"
echo syntax-ok
# quick Bot API reachability
curl -sS -o /dev/null -w "api.telegram.org HTTP %{http_code} %{time_total}s\n" --max-time 8 https://api.telegram.org/ || echo "curl fail"
pm2 restart tgbot --update-env
sleep 5
pm2 status tgbot
pm2 logs tgbot --nostream --lines 15 --err
