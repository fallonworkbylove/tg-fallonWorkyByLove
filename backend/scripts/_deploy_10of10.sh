#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"
cp -a services/telegramClient.js "services/telegramClient.js.bak-pre-10of10"
cp -a services/aiResponder.js "services/aiResponder.js.bak-pre-10of10"
mv tmp_upload/telegramClient.js services/telegramClient.js
mv tmp_upload/aiResponder.js services/aiResponder.js
mv tmp_upload/_smoke_ten_of_ten.js scripts/_smoke_ten_of_ten.js
node scripts/_smoke_ten_of_ten.js
node -e "require('./services/aiResponder'); require('./services/telegramClient'); console.log('require-ok')"
pm2 restart tgbot --update-env
sleep 5
pm2 status tgbot
echo ====ERR_TAIL====
pm2 logs tgbot --nostream --lines 15 --err
echo ====OUT_TAIL====
pm2 logs tgbot --nostream --lines 15 --out
