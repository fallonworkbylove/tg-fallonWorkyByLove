#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian

cp /tmp/telegramAuth.js "$B/backend/middleware/"
cp /tmp/proxyPools.js "$B/backend/services/"
cp /tmp/app.js /tmp/updates.js /tmp/index.html "$B/frontend/"
cp /tmp/_full_root_audit.js /tmp/_audit_10of10_score.js "$B/backend/scripts/"

# verify key bits
grep -n 'timingSafeEqual\|safeTelegramHref\|currentProxyIndex' \
  "$B/backend/middleware/telegramAuth.js" \
  "$B/frontend/app.js" \
  "$B/backend/services/proxyPools.js" | head -10
grep -n 'Полный разбор\|updates.js?v=57\|app.js?v=57' \
  "$B/frontend/updates.js" "$B/frontend/index.html" | head -6

cd "$B/backend"
node --check middleware/telegramAuth.js
node --check services/proxyPools.js

timeout 40 pm2 restart tgbot --update-env
sleep 45
pm2 status tgbot | head -5

KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
curl -sS --max-time 25 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all || true
echo
sleep 40

echo "=== FULL AUDIT A ==="
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_full_root_audit.js || true
echo
echo "=== FULL AUDIT B ==="
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_full_root_audit.js || true
echo FULL_ROOT_DONE
