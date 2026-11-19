#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/qr_ref/loginAuth.js "$BASE/backend/services/loginAuth.js"
cp -a /tmp/qr_ref/telegramClient.js "$BASE/backend/services/telegramClient.js"
cp -a /tmp/qr_ref/accounts.js "$BASE/backend/routes/accounts.js"
cp -a /tmp/qr_ref/app.js "$BASE/frontend/app.js"
cp -a /tmp/qr_ref/index.html "$BASE/frontend/index.html"
cp -a /tmp/qr_ref/updates.js "$BASE/frontend/updates.js"
cd "$BASE/backend"
npm install qrcode --save --no-fund --no-audit
node -e "const q=require('qrcode'); q.toDataURL('tg://login?token=test').then(u=>console.log('qr', u.slice(0,32))); const {qrImageDataUrl}=require('./services/loginAuth'); qrImageDataUrl('tg://login?token=abc').then(u=>console.log('ok', String(u).slice(0,40)));"
pm2 restart tgbot --update-env
sleep 2
pm2 ls | head -12
echo DEPLOY_QR_REFRESH_OK
