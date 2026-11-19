#!/bin/bash
OUT=/tmp/logwatch_0hm.txt
: > "$OUT"
for i in 1 2 3 4 5 6; do
  sleep 30
  {
    echo "--- tick $i $(date -u +%H:%M:%S) ---"
    grep -aE 'SESSION_WATCH|Warm TG:|Ответ для|silence|heal|SocksClientError|Connection error|REFUSE' \
      /root/.pm2/logs/tgbot-error.log /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -15
  } >> "$OUT"
done
echo DONE >> "$OUT"
