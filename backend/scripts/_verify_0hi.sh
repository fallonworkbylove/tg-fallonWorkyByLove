#!/bin/bash
set -euo pipefail
curl -sI --max-time 10 https://loverussian.duckdns.org/ops/ | head -6
curl -sI --max-time 10 https://loverussian.duckdns.org/api/health | head -3
grep -n 'updates.js?v=' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
grep -aE 'silence-heal|silenceCatchup|ночной тишине|schedulers: digest' /root/.pm2/logs/tgbot-out.log | tail -20
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";")if x.strip()]),"cors":(p["pm2_env"].get("CORS_ORIGIN")or"")[:90]})'
# check nginx ops not redirecting to missing host
if curl -sI --max-time 10 https://loverussian.duckdns.org/ops/ | grep -qi 'ops-loverussian'; then
  echo 'BAD_REDIRECT_STILL'
  exit 1
fi
echo VERIFY_0HI_OK
