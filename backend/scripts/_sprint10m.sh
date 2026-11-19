#!/bin/bash
# 10-min sprint: last 30m logs + live state
set -uo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
OUT=/tmp/sprint10m.txt
exec > >(tee "$OUT") 2>&1
echo "======== SPRINT $(date -u +%H:%MZ) ========"

echo "===== PM2 ====="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"OPENAI":len([x for x in (e.get("OPENAI_PROXY_LIST")or"").split(";")if x.strip()]),"BYPASS":e.get("TELEGRAM_AUTH_BYPASS"),"FORCE":e.get("TELEGRAM_AUTH_BYPASS_FORCE")})'

echo "===== Warm last ====="
grep -a 'Warm TG:' /root/.pm2/logs/tgbot-out.log | tail -6

echo "===== OUT last 30m greps ====="
# rough: last 4000 lines ≈ recent
tail -n 5000 /root/.pm2/logs/tgbot-out.log | grep -aE 'silence-heal|silenceCatchup|во сне|AI замолчал|отсев|это я|бород|leak=1|TypeError|entity|лайф|PROXY|REFUSE' | tail -60

echo "===== ERR last ====="
tail -n 800 /root/.pm2/logs/tgbot-error.log | grep -aE 'SocksClientError|silenceCatchup|TypeError|Incorrect arguments|PEER_ID|FROZEN|OPENAI' | tail -40

echo "===== soft/hard gaps ====="
node - <<'NODE'
require('dotenv').config();
const { findUnfulfilledMediaGaps, findDbSilenceGaps } = require('./services/silenceCatchup');
(async () => {
  const soft = await findUnfulfilledMediaGaps({ maxAgeHours: 12, limit: 10 });
  const gaps = await findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 2, limit: 12 });
  console.log('soft', soft.length, soft.map(r=>({a:r.account_id,p:r.peer_id,u:String(r.last_user_text||'').slice(0,70),b:String(r.last_bot_text||'').slice(0,50)})));
  console.log('hard', gaps.length, gaps.map(r=>({a:r.account_id,p:r.peer_id,u:String(r.last_user_text||'').slice(0,70)})));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
NODE

echo "===== video peer ====="
node scripts/_check_video_life_0hj.js 2>/dev/null | head -40

echo "===== updates ====="
grep -n 'updates.js?v=' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
head -20 /root/opt/tgbot/tg-miniapp-loverussian/frontend/updates.js | sed -n '8,20p'

echo "===== ops https ====="
curl -s -o /dev/null -w 'ops_sub=%{http_code}\n' --max-time 8 https://ops-loverussian.duckdns.org/ || echo ops_sub=ERR
curl -s -o /dev/null -w 'ops_main=%{http_code}\n' --max-time 8 https://loverussian.duckdns.org/ops/
dig +short ops-loverussian.duckdns.org A || true

echo SPRINT_DONE
