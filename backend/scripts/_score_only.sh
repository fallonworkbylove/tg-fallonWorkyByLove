#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
# kill hung ship if any
pkill -f '_ship_10' 2>/dev/null || true
sleep 1

cp /tmp/softHumanLite.js "$B/backend/services/"
cp /tmp/_audit_10of10_score.js "$B/backend/scripts/"

# restart only if code newer than process or softHuman missing ensureAck
if ! grep -q 'ensureAckNotBare' "$B/backend/services/softHumanLite.js"; then
  echo 'missing ensureAck'; exit 1
fi

PID=$(pm2 pid tgbot)
UP=$(ps -p "$PID" -o etime= 2>/dev/null | tr -d ' ')
echo "pid=$PID up=$UP"
# Force restart if softHuman on disk is newer than process start (~ always after scp)
timeout 35 pm2 restart tgbot --update-env
sleep 40

cd "$B/backend"
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
curl -sS --max-time 25 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all || true
echo
sleep 40

SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '3 minutes ago')
echo "FIX_SINCE=$SINCE"
AUDIT_FIX_SINCE="$SINCE" node scripts/_audit_10of10_score.js
sleep 12
AUDIT_FIX_SINCE="$SINCE" node scripts/_audit_10of10_score.js
echo SCORE_ONLY_DONE
