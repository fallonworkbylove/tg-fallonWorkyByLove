#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/0ge/humanHardening.js "$BASE/backend/services/"
timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 6
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";") if x]),"restarts":p["pm2_env"].get("restart_time")})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -aF 'Десять из десяти' "$BASE/frontend/updates.js" | head -1
cd "$BASE/backend" && node scripts/_verify_0ge_persist.js
echo RESTART_0GE_OK
