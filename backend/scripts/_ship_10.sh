#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/softHumanLite.js "$B/backend/services/"
cp /tmp/_smoke_10of10_fixes.js /tmp/_audit_10of10_score.js "$B/backend/scripts/"
cp /tmp/updates.js "$B/frontend/" 2>/dev/null || true
# bump cache if index has updates.js
if grep -q 'updates.js?v=' "$B/frontend/index.html"; then
  sed -i 's/updates.js?v=[0-9]*/updates.js?v=55/' "$B/frontend/index.html"
fi

cd "$B/backend"
node scripts/_smoke_10of10_fixes.js

timeout 40 pm2 restart tgbot --update-env || { pm2 stop tgbot; sleep 2; pm2 start tgbot; }
sleep 50
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
curl -sS --max-time 30 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all
echo
sleep 55

SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '2 minutes ago')
echo "FIX_SINCE=$SINCE"
echo "=== SCORE 1 ==="
AUDIT_FIX_SINCE="$SINCE" node scripts/_audit_10of10_score.js
sleep 15
echo "=== SCORE 2 ==="
AUDIT_FIX_SINCE="$SINCE" node scripts/_audit_10of10_score.js
echo SHIP10_DONE
