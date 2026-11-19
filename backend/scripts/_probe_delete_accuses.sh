#!/bin/bash
LOG=/root/.pm2/logs/tgbot-out.log
echo "=== AI answers that admit delete ==="
grep -E 'Ответ для|Отложенный ответ' "$LOG" | grep -iE 'удалила|удалил всё|переписку удалил|диалог удалил' | tail -50
echo
echo "=== peer accuses ==="
grep -E ']: "' "$LOG" | grep -iE 'удалила|удалил всё|переписку удалил|диалог удалил|все твои сообщения' | tail -40
echo
echo "=== bot saw MessageEmpty (peer or someone wiped) ==="
grep -c 'диалог/сообщение удалены' "$LOG" || true
grep 'диалог/сообщение удалены' "$LOG" | sed 's/\].*/]/' | sort | uniq -c | sort -rn | head -20
