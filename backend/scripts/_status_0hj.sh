#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "===== heal/video ====="
grep -aE '🐊|лайф|silenceCatchup healed|silence-heal' /root/.pm2/logs/tgbot-out.log | tail -20
echo "===== video peer msgs ====="
node scripts/_check_video_life_0hj.js 2>/dev/null | tail -50
echo "===== soft ====="
node - <<'NODE'
require('dotenv').config();
const { findUnfulfilledMediaGaps } = require('./services/silenceCatchup');
(async () => {
  const soft = await findUnfulfilledMediaGaps({ maxAgeHours: 12, limit: 8 });
  console.log(JSON.stringify(soft.map(r=>({a:r.account_id,p:r.peer_id,u:r.last_user_text,b:r.last_bot_text})),null,2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
NODE
echo "===== pm2 ====="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"BYPASS":e.get("TELEGRAM_AUTH_BYPASS")})'
grep -n 'updates.js?v=' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
