#!/bin/bash
set -euo pipefail
echo "=== $(TZ=Europe/Moscow date) ==="
uptime
df -h / | tail -1
free -h | head -2
echo "=== pm2 ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e.get("status"),"restarts":e.get("restart_time"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"pid":p.get("pid"),"mem_mb":round((p.get("monit") or {}).get("memory",0)/1024/1024,1)})'
echo "=== https ==="
curl -sS -o /dev/null -w "miniapp:%{http_code}\n" --connect-timeout 8 https://loverussian.duckdns.org/ || echo miniapp_FAIL
curl -sS -o /dev/null -w "ops:%{http_code}\n" --connect-timeout 8 https://loverussian.duckdns.org/ops/ || echo ops_FAIL
echo "=== net ==="
curl -sS -o /dev/null -w "google:%{http_code}\n" --connect-timeout 5 https://www.google.com/ || echo google_FAIL
curl -sS -o /dev/null -w "api.telegram.org:%{http_code} t=%{time_total}\n" --connect-timeout 8 https://api.telegram.org/ || echo TG_API_FAIL
echo "=== err last ==="
grep -aE 'long polling|SESSION_WATCH|SocksClientError|REFUSE' /root/.pm2/logs/tgbot-error.log | tail -8
echo "=== out last ==="
tail -n 12 /root/.pm2/logs/tgbot-out.log
