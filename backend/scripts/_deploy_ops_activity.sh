#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/opsActivityLog.js "$ROOT/backend/services/"
cp /tmp/helpRequestNotifier.js "$ROOT/backend/services/"
cp /tmp/mediaSend.js "$ROOT/backend/services/"
cp /tmp/adminOps.js "$ROOT/backend/services/"
cp /tmp/adminConsole.js "$ROOT/backend/routes/"
cp /tmp/updates.js /tmp/index.html "$ROOT/frontend/"
cd "$ROOT/backend"
timeout 50 pm2 restart tgbot --update-env
sleep 6
node -e "
require('dotenv').config();
const { pushActivity, listActivity, ensureSchema } = require('./services/opsActivityLog');
(async () => {
  await ensureSchema();
  await pushActivity({
    kind: 'nft_voice',
    title: 'ИИ отправила ГС NFT-кампании',
    body: 'Аккаунт: проверка\nСобеседник: id test\nФайл: nft.ogg\n(тестовая запись после деплоя — можно игнорировать)',
    accountLabel: 'проверка',
    peerId: '0',
    peerLabel: 'id test',
    meta: { smoke: true },
  });
  const data = await listActivity({ limit: 5 });
  console.log('activity_ok', data.events.length, data.events[0]?.title || '');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
"
