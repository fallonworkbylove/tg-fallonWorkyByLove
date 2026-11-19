#!/bin/bash
# Fresh replies since last restart
SINCE=$(date -u -d '2 minutes ago' +%Y-%m-%dT%H:%M 2>/dev/null || date -u -v-2M +%Y-%m-%dT%H:%M)
echo "check_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo '--- status ---'
pm2 jlist | python3 -c 'import sys,json; p=[x for x in json.load(sys.stdin) if x.get("name")=="tgbot"][0]; e=p["pm2_env"]; print(e.get("status"), "restarts", e.get("restart_time"), "uptime_ms", __import__("time").time()*1000-e.get("pm_uptime",0))'
echo '--- pool ---'
grep 'Work (DC) пул' /root/.pm2/logs/tgbot-out.log | tail -1
echo '--- fresh Ответ/Catch-up/connect (tail) ---'
grep -E 'Ответ для|Catch-up:|подключ|активн|Connecting to|WS fail|AUTH_KEY|сесс' /root/.pm2/logs/tgbot-out.log | tail -50
echo '--- err tail ---'
tail -8 /root/.pm2/logs/tgbot-error.log
