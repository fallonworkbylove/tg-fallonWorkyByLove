#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/telegramClient.js "$B/backend/services/telegramClient.js"
cp /tmp/workerConnect.js "$B/backend/services/workerConnect.js"
cp /tmp/proxies-login.txt "$B/backend/config/proxies-login.txt"
cp /tmp/CHANGELOG_TG.md "$B/CHANGELOG_TG.md"
node --check "$B/backend/services/telegramClient.js"
node --check "$B/backend/services/workerConnect.js"
echo "proxies lines: $(grep -cve '^[[:space:]]*$' "$B/backend/config/proxies-login.txt")"
echo "unique hosts:"
sed -n 's/.*@\([^:]*\):.*/\1/p' "$B/backend/config/proxies-login.txt" | sort -u
pm2 restart tgbot --update-env
sleep 6
pm2 logs tgbot --nostream --lines 40 --out 2>/dev/null | grep -E '\[proxy\]|Login \(residential\)|Work \(DC\)|syntax|online' | tail -20 || true
pm2 status tgbot
