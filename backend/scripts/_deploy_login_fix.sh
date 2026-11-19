#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/telegramClient.js "$B/backend/services/telegramClient.js"
cp /tmp/workerConnect.js "$B/backend/services/workerConnect.js"
cp /tmp/CHANGELOG_TG.md "$B/CHANGELOG_TG.md"
node --check "$B/backend/services/telegramClient.js"
node --check "$B/backend/services/workerConnect.js"
echo syntax-ok
pm2 restart tgbot --update-env
sleep 4
pm2 status tgbot
grep -n "PHONE_CODE_INVALID\|confirmCode для" "$B/backend/services/workerConnect.js" "$B/backend/services/telegramClient.js" | head -10
