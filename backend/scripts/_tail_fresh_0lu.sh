#!/bin/bash
echo "=== fresh out last 40 ==="
tail -40 /root/.pm2/logs/tgbot-out.log | grep -aE 'Ответ для|сдох|circuit|silence-heal|Ошибка' || true
echo "=== fresh err last 15 ==="
tail -15 /root/.pm2/logs/tgbot-error.log
echo "=== health ==="
curl -sS -m 8 http://127.0.0.1:3000/api/health; echo
