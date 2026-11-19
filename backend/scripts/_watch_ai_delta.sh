#!/bin/bash
set -euo pipefail
SZ1=$(wc -c </root/.pm2/logs/tgbot-out.log)
C1=$(grep -acF 'Ответ для' /root/.pm2/logs/tgbot-out.log || true)
echo "t0 size=$SZ1 replies=$C1 $(date -u +%H:%M:%S)"
sleep 90
SZ2=$(wc -c </root/.pm2/logs/tgbot-out.log)
C2=$(grep -acF 'Ответ для' /root/.pm2/logs/tgbot-out.log || true)
echo "t90 size=$SZ2 replies=$C2 delta_bytes=$((SZ2-SZ1)) delta_replies=$((C2-C1)) $(date -u +%H:%M:%S)"
echo ===LAST5===
grep -aF 'Ответ для' /root/.pm2/logs/tgbot-out.log | tail -5
echo ===ACTIVITY===
tail -n 40 /root/.pm2/logs/tgbot-out.log | grep -aE 'Ответ для|Catch-up:|outbound |]: ' | tail -20
echo DELTA_OK
