#!/bin/bash
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
echo "time: $(date -Is)"
echo "=== phone 9779994852 ==="
grep -a '79779994852\|9779994852' "$OUT" "$ERR" | tail -40
echo
echo "=== last 15 login ==="
grep -a '\[login\]' "$OUT" | tail -15
echo
echo "=== last sendCode fails ==="
grep -a 'sendCode не удался' "$OUT" | tail -20
echo
echo "=== recent NotAllowed count (err) ==="
grep -ac 'NotAllowed' "$ERR" || true
pm2 pid tgbot
ps -p "$(pm2 pid tgbot)" -o etime,pcpu,pmem --no-headers 2>/dev/null || true
