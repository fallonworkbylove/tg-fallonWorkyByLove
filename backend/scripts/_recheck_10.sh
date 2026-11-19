#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cd "$B/backend"
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)

echo "=== live checks ==="
grep -n 'ensureAckNotBare\|AFTERTHOUGHTS = \[\]\|mediaHelpers.isContradictory\|socks5ListFromEnv' \
  services/softHumanLite.js services/humanExtra.js services/replyPipeline.js services/aiResponder.js 2>/dev/null | head -12

pm2 status tgbot | head -5
curl -sS --max-time 20 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all || true
echo
sleep 35

SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '20 minutes ago')
echo "FIX_SINCE=$SINCE"
AUDIT_FIX_SINCE="$SINCE" node scripts/_audit_10of10_score.js
echo
AUDIT_FIX_SINCE="$SINCE" node scripts/_audit_10of10_score.js
echo RECHECK_DONE
