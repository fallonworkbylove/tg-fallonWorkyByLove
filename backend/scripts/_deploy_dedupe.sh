#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/telegramClient.js "$B/backend/services/telegramClient.js"
cp /tmp/leadScoring.js "$B/backend/services/leadScoring.js"
cp /tmp/CHANGELOG_TG.md "$B/CHANGELOG_TG.md"
node --check "$B/backend/services/telegramClient.js"
node --check "$B/backend/services/leadScoring.js"
echo syntax-ok
pm2 restart tgbot --update-env
sleep 4
pm2 status tgbot
