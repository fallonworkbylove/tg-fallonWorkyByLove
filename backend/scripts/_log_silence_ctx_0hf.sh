#!/bin/bash
set -euo pipefail
LOG=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log

echo "=== matches ==="
grep -anE 'kolyaa_52|Как и вчера|видео записать|6868829215' "$LOG" | tail -40 || true

echo "=== last Как и вчера contexts ==="
mapfile -t lines < <(grep -an 'Как и вчера' "$LOG" | tail -4 | cut -d: -f1)
for n in "${lines[@]}"; do
  echo "-- around $n --"
  start=$((n - 3)); end=$((n + 30))
  sed -n "${start},${end}p" "$LOG"
done

echo "=== video life context ==="
n=$(grep -an 'видео записать лайф' "$LOG" | tail -1 | cut -d: -f1 || true)
if [[ -n "${n:-}" ]]; then
  echo "line=$n"
  sed -n "$((n-3)),$((n+45))p" "$LOG"
fi

echo "=== error near same window ==="
grep -aE 'SocksClient|OpenAI|ECONN|timeout|generateReply|6868829215|6699737878|видео|как и вчера' "$ERR" | tail -40 || true
