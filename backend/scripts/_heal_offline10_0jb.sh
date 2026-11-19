#!/bin/bash
set -euo pipefail
echo "=== heal offline 10: graceful stop → 900s → start ==="
curl -sS http://127.0.0.1:3000/api/health || echo '(health down)'
echo
pm2 describe tgbot | head -20 || true

# убрать чужие node
for pid in $(pgrep -f 'node ' || true); do
  cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
  case "$cmd" in
    *tg-miniapp-loverussian/backend/server*|*PM2*|*pm2*) ;;
    *) echo "KILL $pid"; kill -TERM "$pid" 2>/dev/null || true ;;
  esac
done
sleep 2

PID=$(pm2 pid tgbot 2>/dev/null || true)
if [ -n "${PID:-}" ] && [ "$PID" != "0" ]; then
  echo "SIGTERM $PID (disconnect live sessions cleanly)"
  kill -TERM "$PID" || true
  for i in $(seq 1 25); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
fi
pm2 stop tgbot || true
sleep 5
pkill -TERM -f 'tg-miniapp-loverussian/backend/server' 2>/dev/null || true
sleep 3
echo "sockets to TG DC:"
ss -tnp 2>/dev/null | grep -E '149\.154\.|91\.108\.' || echo '(none)'
echo "waiting 900s..."
sleep 900

pm2 start tgbot --update-env
pm2 save

# bootstrap + optional 5m retry
for i in $(seq 1 16); do
  h=$(curl -sS http://127.0.0.1:3000/api/health 2>/dev/null || echo '{}')
  echo "check_$i $h"
  # stop early if ≥16 online
  echo "$h" | grep -qE '"online":(1[6-9]|[2-9][0-9])' && break
  sleep 40
done

echo '--- bootstrap ---'
grep -aE 'Восстановление сессий|активирован|ошибка|retry done|повтор' /root/.pm2/logs/tgbot-out.log | tail -50
echo '--- AUTH ---'
grep -aE 'AUTH_KEY|SESSION_WATCH' /root/.pm2/logs/tgbot-error.log | tail -20
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
if n < 5: raise SystemExit('REFUSE_PROXY')
PY
echo DONE_HEAL_10
