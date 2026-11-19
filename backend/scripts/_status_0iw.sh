#!/bin/bash
uptime
pm2 show tgbot | grep -E 'status|uptime|restarts'
curl -s http://127.0.0.1:3000/api/health; echo
echo '===OUT==='
grep -aE 'Восстановление сессий завершено|подключён со 2|активирован' /root/.pm2/logs/tgbot-out.log | tail -25
echo '===ERR==='
grep -aE 'AUTH_KEY_DUPLICATED — жду|SESSION_WATCH|подключение не удалось' /root/.pm2/logs/tgbot-error.log | tail -20
