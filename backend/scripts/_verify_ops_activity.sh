#!/bin/bash
set -euo pipefail
cp /tmp/opsActivityLog.js /root/opt/tgbot/tg-miniapp-loverussian/backend/services/
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
timeout 40 pm2 restart tgbot --update-env
sleep 5
node <<'NODE'
require('dotenv').config();
const { listActivity } = require('./services/opsActivityLog');
listActivity({ limit: 5 })
  .then((d) => {
    console.log('src=' + d.source);
    console.log('n=' + d.events.length);
    console.log('title=' + ((d.events[0] && d.events[0].title) || ''));
    process.exit(d.source === 'db' && d.events.length ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
NODE
