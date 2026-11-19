#!/bin/bash
set -e
APP=/root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== PROXY_LEN ==="
pm2 jlist | python3 -c '
import json,sys
j=json.load(sys.stdin)
p=[x for x in j if x["name"]=="tgbot"][0]
pl=p["pm2_env"].get("PROXY_LIST") or ""
print("pm2_PROXY_LEN", len([x for x in pl.split(";") if x.strip()]))
print("status", p["pm2_env"]["status"])
print("pid", p.get("pid"))
print("restarts", p["pm2_env"].get("restart_time"))
'
echo "=== connectionRetries ==="
grep -n 'connectionRetries' "$APP/services/clientPool.js" "$APP/services/proxyPools.js" 2>/dev/null | head -40
echo "=== recent warm/bootstrap/DEAD ==="
grep -aE 'Warm TG|активирован|DEAD|BOOTSTRAP|tgWeak|Восстанавливаю|markProxyDead|SocksClient|TIMEOUT|REFUSE|connect failed|false' \
  /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -100
echo "=== activated count (last boot window) ==="
grep -a 'активирован' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -30
echo "=== DONE ==="
