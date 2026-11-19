#!/bin/bash
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
echo '=== anomalies ==='
tail -n 200 "$OUT" | grep -iE 'AUTH_KEY|сессия отозвана|сессия пуста|TypeError|OpenAIError|ты отправила|FLOOD_WAIT|не стираю' | tail -15 || true
echo '=== replies ==='
tail -n 80 "$OUT" | grep 'Ответ для' | tail -6 || true
echo '=== socks err count (tail40) ==='
tail -n 40 "$ERR" | grep -c SocksClientError || true
pm2 describe tgbot 2>/dev/null | grep -E 'status|uptime' | head -4
