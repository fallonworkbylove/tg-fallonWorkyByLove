#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/audit10

cp "$SRC/telegramClient.js" "$B/backend/services/"
cp "$SRC/loginAuth.js" "$B/backend/services/"
cp "$SRC/sessionBootstrap.js" "$B/backend/services/"
cp "$SRC/workerConnect.js" "$B/backend/services/"
cp "$SRC/accounts.js" "$B/backend/routes/"
cp "$SRC/telegramAuth.js" "$B/backend/middleware/"
cp "$SRC/server.js" "$B/backend/"
cp "$SRC/_relgin_7173.js" "$B/backend/scripts/"
cp "$SRC/CHANGELOG_TG.md" "$B/"

node --check "$B/backend/services/telegramClient.js"
node --check "$B/backend/middleware/telegramAuth.js"
node --check "$B/backend/routes/accounts.js"
node --check "$B/backend/services/loginAuth.js"
node --check "$B/backend/server.js"
echo syntax-ok

ENV="$B/backend/.env"
KEY=$(openssl rand -hex 16)

# НЕ включаем TELEGRAM_AUTH_BYPASS_FORCE автоматически.
if grep -q '^TELEGRAM_AUTH_BYPASS_FORCE=true' "$ENV" 2>/dev/null; then
  echo "[deploy] WARN: TELEGRAM_AUTH_BYPASS_FORCE=true в .env — убедись что это намеренно"
fi
if grep -q '^TELEGRAM_AUTH_BYPASS_KEY=' "$ENV"; then
  sed -i "s/^TELEGRAM_AUTH_BYPASS_KEY=.*/TELEGRAM_AUTH_BYPASS_KEY=$KEY/" "$ENV"
else
  echo "TELEGRAM_AUTH_BYPASS_KEY=$KEY" >> "$ENV"
fi
grep -q '^CORS_ORIGIN=' "$ENV" || echo 'CORS_ORIGIN=https://loverussian.duckdns.org' >> "$ENV"

# Keep TELEGRAM_AUTH_BYPASS=true but FORCE gates it to localhost/key
grep -E 'TELEGRAM_AUTH_BYPASS|CORS_ORIGIN|TELEGRAM_API_ID' "$ENV" | sed 's/KEY=.*/KEY=***/'

pm2 restart tgbot --update-env
sleep 8
pm2 logs tgbot --out --lines 50 --nostream 2>/dev/null | grep -E 'bootstrap|Нормализовано|bypass|Server is running|Нужна авторизация|сессия мертва|Восстанавливаю' | tail -30
# Ключ только в root-only файл — не в shell history / CI logs.
umask 077
printf '%s\n' "$KEY" > /root/.tgbot_bypass_key
chmod 600 /root/.tgbot_bypass_key
echo "BYPASS_KEY written to /root/.tgbot_bypass_key (chmod 600)"
