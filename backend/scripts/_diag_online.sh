#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "=== proxy pool at boot ==="
pm2 logs tgbot --lines 100 --nostream 2>/dev/null | grep -F '[proxy]' | tail -n 10

echo
echo "=== openai pool ==="
pm2 logs tgbot --lines 100 --nostream 2>/dev/null | grep -F '[openai]' | tail -n 10

echo
echo "=== connect / activate ==="
pm2 logs tgbot --lines 150 --nostream 2>/dev/null | grep -iE 'Connected|activated|подключ|account .*online|is_online|не удалось|AUTH|SESSION|flood|proxy.*Переключ' | tail -n 40

echo
echo "=== socks errors (fresh) ==="
tail -n 50 /root/.pm2/logs/tgbot-error.log 2>/dev/null | grep -E 'SocksClientError|ECONNREFUSED|ETIMEDOUT' | tail -n 20

echo
echo "=== active clients via require (won't see running process maps) ==="
# Hit local admin API if any, else count from logs
pm2 describe tgbot 2>/dev/null | grep -E 'status|uptime|pid' | head -n 8
