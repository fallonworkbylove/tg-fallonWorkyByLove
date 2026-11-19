#!/bin/bash
set -euo pipefail
echo '=== kill dual gramjs / audit holders ==='
ps aux | grep -E 'node.*(audit|smoke|gram|heal|_ai10|_check)' | grep -v grep || true
# Убиваем всё node кроме pm2 tgbot server
for pid in $(pgrep -f 'node ' || true); do
  cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
  case "$cmd" in
    *tg-miniapp-loverussian/backend/server*) echo "keep tgbot pid=$pid" ;;
    *PM2*|*pm2*) echo "keep pm2 pid=$pid" ;;
    '') ;;
    *)
      echo "KILL pid=$pid cmd=$cmd"
      kill -TERM "$pid" 2>/dev/null || true
      ;;
  esac
done
sleep 3
ps aux | grep -E 'node ' | grep -v grep || true

echo '=== graceful stop tgbot ==='
PID=$(pm2 pid tgbot 2>/dev/null || true)
if [ -n "${PID:-}" ] && [ "$PID" != "0" ]; then
  kill -TERM "$PID" || true
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
fi
pm2 stop tgbot || true
sleep 5
# leftover node audit?
pkill -TERM -f 'scripts/_audit' 2>/dev/null || true
pkill -TERM -f 'scripts/_smoke' 2>/dev/null || true
pkill -TERM -f 'scripts/_hard' 2>/dev/null || true
sleep 2
echo 'remaining node:'
ps aux | grep -E 'node ' | grep -v grep || true
echo 'waiting 180s...'
sleep 180
pm2 start tgbot --update-env
pm2 save
sleep 90
curl -sS http://127.0.0.1:3000/api/health; echo
ps aux | grep -E 'node ' | grep -v grep || true
echo DONE_HEAL_DUAL
