#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [rows] = await db.execute(
    `SELECT id, account_id, peer_id, peer_username, role, LEFT(content,200) content, created_at
     FROM conversation_messages
     WHERE peer_id = '5712579905' OR peer_username LIKE '%bardak%'
     ORDER BY id ASC LIMIT 80`
  );
  console.log('rows', rows.length);
  console.log(JSON.stringify(rows, null, 2));
  const [sv] = await db.execute(
    `SELECT * FROM silence_voice_daily WHERE peer_id='5712579905' OR account_id=49 ORDER BY decided_at DESC LIMIT 10`
  ).catch(()=>[[]]);
  console.log('silence_voice_daily', JSON.stringify(sv, null, 2));
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1)});
NODE
