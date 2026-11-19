#!/bin/bash
LOG=/root/.pm2/logs/tgbot-out.log
n=$(grep -an 'видео записать лайф' "$LOG" | tail -1 | cut -d: -f1)
echo "line=$n"
sed -n "$((n-5)),$((n+80))p" "$LOG"
echo "=== later mentions of crocodile / 686882 ==="
grep -anE '6868829215|🐊|видео записать' "$LOG" | tail -30
echo "=== kolyaa after last vchera ==="
grep -anE 'kolyaa_52' "$LOG" | tail -20
