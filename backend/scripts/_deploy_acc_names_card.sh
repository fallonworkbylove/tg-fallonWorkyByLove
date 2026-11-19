#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/acc_names/accounts.js "$BASE/backend/routes/accounts.js"
cp -a /tmp/acc_names/adminConsoleStats.js "$BASE/backend/services/adminConsoleStats.js"
cp -a /tmp/acc_names/clientPool.js "$BASE/backend/services/clientPool.js"
cp -a /tmp/acc_names/telegramClient.js "$BASE/backend/services/telegramClient.js"
cp -a /tmp/acc_names/app.js "$BASE/frontend/app.js"
cp -a /tmp/acc_names/styles.css "$BASE/frontend/styles.css"
cp -a /tmp/acc_names/index.html "$BASE/frontend/index.html"
cp -a /tmp/acc_names/updates.js "$BASE/frontend/updates.js"
node -e "require('$BASE/backend/services/adminConsoleStats').nameFromPrompt('Ты — Кира, 24'); require('$BASE/backend/services/clientPool'); console.log('ok')"
pm2 restart tgbot --update-env
sleep 2
pm2 ls | head -15
echo DEPLOY_ACC_NAMES_OK
