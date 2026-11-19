#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
ls -la "$B/services/telegramClient.js" "$B/services/aiResponder.js"
ls -la "$B/tmp_upload/" 2>/dev/null || echo "tmp_upload empty/gone"
test -f "$B/services/telegramClient.js.bak-pre-10of10" && echo bak-ok
grep -n "MEDIA_STALL_RE" "$B/services/telegramClient.js" | head -2
grep -n "после переезда" "$B/services/aiResponder.js" | head -3
grep -n "nah later" "$B/services/telegramClient.js" || echo "EN later deflect gone (good)"
grep -n "sanitizeForModel" "$B/services/aiResponder.js" | head -2
# smoke with pm2 env
cd "$B"
export $(pm2 env 9 | grep -E '^(OPENAI_|DB_|MYSQL_|PROXY_)' | xargs -0 2>/dev/null || true)
# fallback: source dotenv if present
if [ -f "$B/.env" ]; then set -a; . "$B/.env"; set +a; fi
node scripts/_smoke_ten_of_ten.js
pm2 logs tgbot --nostream --lines 12 --err
