#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/pkg_10

cp "$SRC/humanExtra.js" "$SRC/mediaSend.js" "$SRC/softHumanLite.js" "$B/backend/services/"
cp "$SRC/styles.css" "$SRC/index.html" "$B/frontend/"
cp /tmp/_smoke_10of10_fixes.js "$B/backend/scripts/" 2>/dev/null || true

grep -n 'AFTERTHOUGHTS = \[\]' "$B/backend/services/humanExtra.js"
grep -n 'enrichBareAckOnSubstance' "$B/backend/services/softHumanLite.js" | head -2
grep -n 'v=54' "$B/frontend/index.html"

cd "$B/backend"
node scripts/_smoke_10of10_fixes.js

pm2 restart tgbot --update-env
sleep 12
pm2 status tgbot | head -8

KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
# catch-up with short client timeout so we don't hang forever
curl -sS --max-time 25 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all || echo 'catch-up timed/err (async ok)'
echo

node scripts/_audit_10of10_pass1.js | head -60
echo PASS2_DONE
