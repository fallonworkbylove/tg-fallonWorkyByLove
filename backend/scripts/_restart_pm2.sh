#!/bin/bash
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
# smoke без openai key: только синтаксис
node --check services/aiResponder.js
node --check services/telegramClient.js
echo syntax-ok
pm2 restart tgbot --update-env
sleep 6
pm2 status tgbot
pm2 logs tgbot --nostream --lines 20 --err
