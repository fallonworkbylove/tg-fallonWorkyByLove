#!/bin/bash
set -euo pipefail
echo "=== replies / busy / silence ==="
grep -aE 'ответил|Занята|отсев \+|AI замолчал|Ошибка обработки' /root/.pm2/logs/tgbot-out.log | tail -40 || true
echo "=== promise leftovers (подожд/<<>>) ==="
grep -aE 'подожд|<<>>|Обещание медиа' /root/.pm2/logs/tgbot-out.log | tail -25 || true
echo "=== AUTH uniq ==="
grep -a 'AUTH_KEY_DUPLICATED' /root/.pm2/logs/tgbot-error.log | grep -oE 'аккаунт [0-9]+' | sort | uniq -c || true
echo "=== crash? ==="
grep -aE 'TypeError|SyntaxError|Cannot find module|humanIdeas18' /root/.pm2/logs/tgbot-error.log | tail -10 || true
echo DONE2
