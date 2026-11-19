#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node -e '
require("dotenv").config();
const db=require("./db");
(async()=>{
  const [[a]]=await db.execute(`SELECT
    SUM(role="assistant" AND created_at>NOW()-INTERVAL 15 MINUTE) bot15,
    SUM(role="user" AND created_at>NOW()-INTERVAL 15 MINUTE) user15,
    SUM(role="assistant" AND created_at>NOW()-INTERVAL 3 MINUTE) bot3,
    SUM(role="user" AND created_at>NOW()-INTERVAL 3 MINUTE) user3,
    MAX(CASE WHEN role="assistant" THEN created_at END) last_bot,
    MAX(CASE WHEN role="user" THEN created_at END) last_user
  FROM conversation_messages`);
  console.log(JSON.stringify(a));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
'
echo LOG: $(stat -c '%y %s' /root/.pm2/logs/tgbot-out.log)
date -u
