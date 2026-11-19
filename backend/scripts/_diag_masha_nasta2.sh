#!/bin/bash
set -u
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== TIME MSK ==="
TZ=Europe/Moscow date
echo "=== PM2 ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print(e["status"],"PROXY",len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]))'
echo "=== LAST LINES ==="
grep -aE "Машенька|Анастасия|79601878688|79322088586" "$OUT" | tail -80
echo "=== SKIP/BUSY ==="
grep -aE "Машенька|Анастасия|79601878688|79322088586" "$OUT" "$ERR" 2>/dev/null | grep -aEi "Занята|quiet|sleep|молчу|skip|отсев|filtered|AI замолчал|DISCONNECT|Flood|AUTH|DEAD|timeout|catch-up|silence|offline|не подключ" | tail -40
echo "=== REPLIES ==="
grep -aE "\[79601878688 — Машенька\]|\[79322088586 —" "$OUT" | grep -a "Ответ для" | tail -15
echo "=== ERR ==="
grep -aE "79601878688|79322088586|Машенька|Анастасия" "$ERR" | tail -30
echo "=== DB ==="
cd "$B"
node scripts/_check_acc_masha_nasta.js
echo DIAG_DONE