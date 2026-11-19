#!/bin/bash
set -euo pipefail
echo "=== long AUTH_KEY heal: SIGTERM → 600s → start ==="
# убрать чужие node-скрипты
for pid in $(pgrep -f 'node ' || true); do
  cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
  case "$cmd" in
    *tg-miniapp-loverussian/backend/server*|*PM2*|*pm2*) ;;
    '') ;;
    *) echo "KILL $pid $cmd"; kill -TERM "$pid" 2>/dev/null || true ;;
  esac
done
sleep 2

PID=$(pm2 pid tgbot 2>/dev/null || true)
if [ -n "${PID:-}" ] && [ "$PID" != "0" ]; then
  echo "SIGTERM pid=$PID"
  kill -TERM "$PID" || true
  for i in $(seq 1 20); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
fi
pm2 stop tgbot || true
sleep 5
pkill -TERM -f 'tg-miniapp-loverussian/backend/server' 2>/dev/null || true
sleep 3
echo "node left:"; ps aux | grep -E 'node ' | grep -v grep || echo '(none)'
echo "waiting 600s for DC..."
sleep 600
pm2 start tgbot --update-env
pm2 save
# волны + возможные 120с AUTH wait
for i in 1 2 3 4 5 6 7 8 9 10; do
  h=$(curl -sS http://127.0.0.1:3000/api/health || echo '{}')
  echo "check_$i $h"
  echo "$h" | grep -qE '"online":([1-9]|[1-9][0-9])' && break
  sleep 45
done
echo '--- bootstrap ---'
grep -aE 'активирован|ошибка|ok=|fail=|retry done' /root/.pm2/logs/tgbot-out.log | tail -40
echo '--- AUTH ---'
grep -aE 'AUTH_KEY|SESSION_WATCH' /root/.pm2/logs/tgbot-error.log | tail -15
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
echo DONE_LONG_HEAL
