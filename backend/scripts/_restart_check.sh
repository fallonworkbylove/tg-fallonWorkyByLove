#!/bin/bash
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node -e "const t=require('./services/timeStyle'); console.log('getSeasonInfo', typeof t.getSeasonInfo, t.getSeasonInfo().id);"
pm2 restart tgbot --update-env
sleep 5
pm2 status tgbot
echo ====ERR====
pm2 logs tgbot --nostream --lines 50 --err | tail -n 35
echo ====OUT====
pm2 logs tgbot --nostream --lines 30 --out | tail -n 25
