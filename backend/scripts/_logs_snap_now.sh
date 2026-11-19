#!/bin/bash
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
echo "=== BOOT / POOL ==="
grep -aE 'Login \(residential\)|Work \(DC\)|Warm TG:' "$OUT" | tail -6
echo "=== LOGIN/QR last 40 ==="
grep -aEi '\[login\]|QR |sendCode|proxy-seller|Connect QR|код запрошен|QR старт' "$OUT" "$ERR" 2>/dev/null | tail -40
echo "=== ERRORS last (login/proxy) ==="
grep -aEi '\[login\]|SocksClient|proxy-seller|DEAD|WebSocket connection failed' "$ERR" | tail -35
echo "=== AI recent ==="
grep -aEi '\[v0\]|openai\]|Запрос к модели' "$OUT" | tail -10
echo "=== pm2 ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()])})'
echo SNAP_OK
