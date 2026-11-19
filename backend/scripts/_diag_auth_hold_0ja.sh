#!/bin/bash
set -euo pipefail
echo '=== health ==='
curl -sS http://127.0.0.1:3000/api/health; echo
echo '=== node ==='
ps aux | grep -E 'node ' | grep -v grep || true
echo '=== TG DC sockets ==='
ss -tnp 2>/dev/null | grep -E '149\.154\.|91\.108\.' || netstat -tnp 2>/dev/null | grep -E '149\.154\.|91\.108\.' || echo '(no tg dc sockets)'
echo '=== out since last start (pid 197671) ==='
# строки после последнего старта сервера
START=$(grep -an 'Сервер запущен\|listening\|Listening\|bootstrap\|Восстанавливаю' /root/.pm2/logs/tgbot-out.log | tail -5)
echo "$START"
echo '=== last 60 out (filtered) ==='
tail -n 200 /root/.pm2/logs/tgbot-out.log | grep -aE 'Восстанавливаю|активирован|ошибка|ok=|fail=|волна|shutdown|Сервер|listen' | tail -50
echo '=== last 30 err ==='
tail -n 30 /root/.pm2/logs/tgbot-error.log | grep -aE 'AUTH_KEY|SESSION_WATCH|прокси|DEAD' || true
