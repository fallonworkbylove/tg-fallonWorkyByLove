#!/bin/bash
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node -e "require('./services/aiResponder'); require('./services/telegramClient'); require('./services/timeStyle'); console.log('require-ok', require('./services/timeStyle').getSeasonInfo().id);"
pm2 restart tgbot --update-env
sleep 5
pm2 status tgbot
echo ====ERR_TAIL====
# only lines after restart: take last 20 of err
pm2 logs tgbot --nostream --lines 20 --err
echo ====OUT_TAIL====
pm2 logs tgbot --nostream --lines 25 --out
