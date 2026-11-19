#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export TELEGRAM_AUTH_BYPASS=false
export TELEGRAM_AUTH_BYPASS_FORCE=false
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN_before=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

echo "=== pm2 restart ==="
pm2 restart tgbot --update-env
pm2 save
sleep 8
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"pid":p.get("pid"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"BYPASS":e.get("TELEGRAM_AUTH_BYPASS"),"restarts":e.get("restart_time")})'

echo "=== boot tail ==="
sleep 5
grep -aE 'opsQuality|Work \(DC\)|Warm TG|schedulers|listening|tgbot|PROXY' /root/.pm2/logs/tgbot-out.log | tail -25

echo "=== watch 90s ==="
END=$((SECONDS+90))
while [ $SECONDS -lt $END ]; do
  sleep 15
  echo "--- $(date -u +%H:%MZ) ---"
  tail -n 40 /root/.pm2/logs/tgbot-out.log | grep -aE 'silence-heal|silenceCatchup|outbound |Ответ для|во сне|медиа-просьба|Warm TG|error|TypeError|AI замолчал|leak=1' || true
  tail -n 15 /root/.pm2/logs/tgbot-error.log | grep -aE 'SocksClientError|TypeError|Incorrect arguments|Unhandled|OPENAI' || true
done

echo "=== final state ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()])})'
grep -a 'Warm TG:' /root/.pm2/logs/tgbot-out.log | tail -3
echo WATCH_DONE
