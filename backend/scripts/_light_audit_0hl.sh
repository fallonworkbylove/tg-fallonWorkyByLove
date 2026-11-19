#!/bin/bash
# Light audit — operator snapshot
set -u
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
B=/root/opt/tgbot/tg-miniapp-loverussian/backend

echo "=== PM2 / PROXY ==="
pm2 jlist 2>/dev/null | python3 -c '
import json,sys,time
j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"]
pl=[x for x in (e.get("PROXY_LIST")or"").split(";") if x.strip()]
up=e.get("pm_uptime")or 0; mins=int((time.time()*1000-up)/60000) if up else -1
print({"status":e.get("status"),"restarts":e.get("restart_time"),"uptime_min":mins,"PROXY":len(pl)})
'
echo "login_file=$(grep -c '^socks5' $B/config/proxies-login.txt 2>/dev/null || echo 0)"
echo "  proxy-seller=$(grep -c proxy-seller $B/config/proxies-login.txt 2>/dev/null || echo 0)"
echo "  46.4=$(grep -c '46.4.139.124' $B/config/proxies-login.txt 2>/dev/null || echo 0)"
grep -aE 'Warm TG:|Login \(residential\)' "$OUT" | tail -3

echo "=== AI / REPLIES (tail 3k out) ==="
echo "model=$(tail -n 3000 "$OUT" | grep -ac 'Запрос к модели' || true)"
echo "replies=$(tail -n 3000 "$OUT" | grep -ac 'Ответ для' || true)"
echo "silence=$(tail -n 5000 "$OUT" | grep -acE 'AI замолчал|AI_SILENCE' || true)"
tail -n 3000 "$OUT" | grep -a 'Ответ для' | tail -8

echo "=== HUMAN FLAGS (tail 8k) ==="
tail -n 8000 "$OUT" 2>/dev/null | grep -aE 'отсев \+|ответил, сколько на дв|это я|каиф|Дайджест отсева|PEER_ID_INVALID|FROZEN' | tail -15 || echo "(none)"

echo "=== LOGIN/QR (recent) ==="
grep -aE 'QR ок|QR старт|Connect QR start error|qr: ок' "$OUT" "$ERR" 2>/dev/null | tail -12
echo "login_fail_46=$(tail -n 2000 "$ERR" | grep -ac '46.4.139' || true)"
echo "login_fail_ps=$(tail -n 2000 "$ERR" | grep -ac 'proxy-seller' || true)"

echo "=== ERR TOP (tail 500) ==="
tail -n 500 "$ERR" 2>/dev/null | grep -aoE 'SocksClientError|AUTH_KEY_[A-Z_]+|FLOOD_WAIT|TIMEOUT|ECONNRESET|WebSocket connection failed|PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY' | sort | uniq -c | sort -rn | head -12

echo "=== QUIET / NIGHT ==="
tail -n 4000 "$OUT" | grep -aE 'quiet|тихие|01–08|isNight|media-while-sleep|Занята' | tail -8 || echo "(none recent)"

echo LIGHT_AUDIT_OK
