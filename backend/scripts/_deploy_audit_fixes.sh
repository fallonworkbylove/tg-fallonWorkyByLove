#!/bin/bash
# Deploy 10/10 audit fixes. Bypass key: keep existing, never echo.
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/audit_fixes

cp "$SRC/telegramAuth.js" "$B/backend/middleware/"
cp "$SRC/debugUser.js" "$B/backend/middleware/" 2>/dev/null || true
cp "$SRC/server.js" "$B/backend/"
cp "$SRC/accounts.js" "$B/backend/routes/"
cp "$SRC/telegramClient.js" "$B/backend/services/"
cp "$SRC/dailyLife.js" "$B/backend/services/"
cp "$SRC/loginAuth.js" "$B/backend/services/"
cp "$SRC/inbound.js" "$B/backend/services/"
cp "$SRC/replyPipeline.js" "$B/backend/services/"
cp "$SRC/mediaSend.js" "$B/backend/services/"
cp "$SRC/howLong.js" "$B/backend/services/"
cp "$SRC/clientPool.js" "$B/backend/services/"
cp "$SRC/humanThinLayer.js" "$B/backend/services/"
cp "$SRC/softHumanLite.js" "$B/backend/services/"
cp "$SRC/aiResponder.js" "$B/backend/services/" 2>/dev/null || true
cp "$SRC/helpRequestNotifier.js" "$B/backend/services/" 2>/dev/null || true
cp "$SRC/operatorAccess.js" "$B/backend/services/" 2>/dev/null || true
cp "$SRC/adminMenu.js" "$B/backend/services/" 2>/dev/null || true
cp "$SRC/app.js" "$B/frontend/" 2>/dev/null || true
cp "$SRC/index.html" "$B/frontend/" 2>/dev/null || true
cp "$SRC/styles.css" "$B/frontend/" 2>/dev/null || true
cp "$SRC/_smoke_pool_status.js" "$B/backend/scripts/"
cp "$SRC/_WARN_DUAL_GRAMJS.txt" "$B/backend/scripts/" 2>/dev/null || true
cp "$SRC/CHANGELOG_TG.md" "$B/"

for f in \
  "$B/backend/middleware/telegramAuth.js" \
  "$B/backend/server.js" \
  "$B/backend/routes/accounts.js" \
  "$B/backend/services/telegramClient.js" \
  "$B/backend/services/dailyLife.js" \
  "$B/backend/services/loginAuth.js" \
  "$B/backend/services/inbound.js" \
  "$B/backend/services/replyPipeline.js" \
  "$B/backend/services/mediaSend.js" \
  "$B/backend/services/howLong.js" \
  "$B/backend/services/clientPool.js" \
  "$B/backend/services/humanThinLayer.js" \
  "$B/backend/services/softHumanLite.js"
do
  node --check "$f"
done
echo syntax-ok

ENV="$B/backend/.env"
# НЕ включаем TELEGRAM_AUTH_BYPASS_FORCE автоматически — только ручной loopback-ops.
if grep -q '^TELEGRAM_AUTH_BYPASS_FORCE=true' "$ENV" 2>/dev/null; then
  echo "[deploy] WARN: TELEGRAM_AUTH_BYPASS_FORCE=true в .env — убедись что это намеренно"
fi
grep -q '^CORS_ORIGIN=' "$ENV" || echo 'CORS_ORIGIN=https://loverussian.duckdns.org' >> "$ENV"

# Keep existing bypass key — regenerating breaks ops scripts mid-flight.
if grep -q '^TELEGRAM_AUTH_BYPASS_KEY=.\+' "$ENV"; then
  KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' "$ENV" | head -1 | cut -d= -f2-)
else
  KEY=$(openssl rand -hex 16)
  echo "TELEGRAM_AUTH_BYPASS_KEY=$KEY" >> "$ENV"
fi
umask 077
printf '%s\n' "$KEY" > /root/.tgbot_bypass_key
chmod 600 /root/.tgbot_bypass_key
echo "BYPASS_KEY synced to /root/.tgbot_bypass_key (chmod 600, not echoed)"

grep -E 'TELEGRAM_AUTH_BYPASS_FORCE|CORS_ORIGIN|ADMIN_ALERT_CHAT_ID|TELEGRAM_API_ID' "$ENV" \
  | sed 's/KEY=.*/KEY=***/;s/CHAT_ID=.*/CHAT_ID=***/'

pm2 restart tgbot --update-env
sleep 20
pm2 flush tgbot >/dev/null || true
sleep 8
pm2 logs tgbot --err --lines 30 --nostream 2>/dev/null \
  | grep -E 'ReferenceError|is not defined|Cannot find|SyntaxError' \
  | grep -vE 'Timeout|telegramAuth' | tail -15 || echo 'err-clean'

cd "$B/backend" && node scripts/_smoke_pool_status.js
curl -sS http://127.0.0.1:3000/api/health | head -c 400; echo
