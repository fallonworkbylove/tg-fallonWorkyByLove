#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/pkg_10v2

mkdir -p "$SRC"
cp /tmp/softHumanLite.js "$SRC/"
cp /tmp/_smoke_10of10_fixes.js /tmp/_audit_10of10_score.js /tmp/_audit_10of10_pass1.js "$B/backend/scripts/"
cp "$SRC/softHumanLite.js" "$B/backend/services/"

cd "$B/backend"
node scripts/_smoke_10of10_fixes.js

pm2 restart tgbot --update-env
# wait for bootstrap: poll pool-status until online>=3 or 90s
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
ONLINE=0
for i in $(seq 1 30); do
  sleep 3
  RESP=$(curl -sS --max-time 8 -H "X-Auth-Bypass-Key: $KEY" http://127.0.0.1:3000/api/accounts/pool-status || echo '{}')
  ONLINE=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const n=(j.online||j.active||[]).length||j.onlineCount||0;console.log(n)}catch(e){console.log(0)}})")
  echo "pool t=$i online=$ONLINE"
  if [ "${ONLINE:-0}" -ge 3 ]; then break; fi
done

echo "=== catch-up ==="
curl -sS --max-time 30 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all
echo
# give catch-up time to reply
sleep 45

echo "=== PASS2 score ==="
AUDIT_FIX_SINCE='2026-10-27 15:30:00' node scripts/_audit_10of10_score.js
echo
echo "=== PASS2 raw gaps ==="
node scripts/_audit_10of10_pass1.js | head -40
echo DEPLOY_V2_DONE
