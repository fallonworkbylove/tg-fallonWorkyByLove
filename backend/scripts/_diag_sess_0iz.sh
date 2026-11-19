#!/bin/bash
set -euo pipefail
echo '=== health ==='
curl -sS http://127.0.0.1:3000/api/health; echo
echo '=== pm2 uptime ==='
pm2 describe tgbot | head -40
echo '=== last bootstrap block ==='
tail -n 200 /root/.pm2/logs/tgbot-out.log | grep -aE 'bootstrap|активирован|retry|онлайн|сессий|ошибка|Wave|волна|online' | tail -60
echo '=== last error AUTH ==='
tail -n 80 /root/.pm2/logs/tgbot-error.log | grep -aE 'AUTH_KEY|Не удалось|жду 90' | tail -30
