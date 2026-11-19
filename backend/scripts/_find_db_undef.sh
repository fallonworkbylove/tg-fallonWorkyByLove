#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend/services
echo "=== files using db. without const db ==="
for f in "$B"/*.js; do
  if grep -qE '\bdb\.(execute|query)' "$f" 2>/dev/null; then
    if ! grep -qE "require\(['\"]\.\./db['\"]\)|require\(['\"]\./db['\"]\)" "$f"; then
      echo "MISSING require: $f"
      grep -nE '\bdb\.(execute|query)' "$f" | head -5
    fi
  fi
done
echo "=== replyPipeline head ==="
head -30 "$B/replyPipeline.js"
echo "=== inbound head ==="
head -40 "$B/inbound.js"
echo "=== stack sample ==="
# trigger path: look for 'Ошибка обработки сообщения'
grep -n "Ошибка обработки сообщения\|db\.execute\|require.*db" "$B/inbound.js" "$B/replyPipeline.js" "$B/humanExtra.js" "$B/history.js" 2>/dev/null | head -40
