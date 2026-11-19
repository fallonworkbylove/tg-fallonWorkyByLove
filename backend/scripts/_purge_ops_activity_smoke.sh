#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config();
const db = require('./db');
(async () => {
  const [r] = await db.execute(
    `DELETE FROM ops_activity_log
     WHERE peer_id = '0'
        OR account_label = 'проверка'
        OR body LIKE '%тестовая запись после деплоя%'
        OR JSON_EXTRACT(meta_json, '$.smoke') = true`,
  );
  console.log('deleted', r.affectedRows || 0);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
