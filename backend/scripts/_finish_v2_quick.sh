#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian

pkill -f '_deploy_10of10_v2' 2>/dev/null || true
sleep 1

cp /tmp/softHumanLite.js "$B/backend/services/"
cp /tmp/_smoke_10of10_fixes.js /tmp/_audit_10of10_score.js /tmp/_audit_10of10_pass1.js "$B/backend/scripts/"

# Confirm code on disk
grep -n 'ну ладно тогда' "$B/backend/services/softHumanLite.js" | head -1
grep -n 'BARE_ACK_RE' "$B/backend/services/softHumanLite.js" | head -1

cd "$B/backend"
# Don't re-run full smoke (loads proxies loudly); quick node assert
node -e "
require('dotenv').config({quiet:true});
const s=require('./services/softHumanLite');
const c=s.softCompleteCut('а ещё)');
if(/^а\\s+ещё/i.test(c)||c.length<=8){console.error('fail cut',c);process.exit(1)}
const e=s.enrichBareAckOnSubstance('круто)','Вчера ездил в Калугу на выходные');
if(/^круто/i.test(e)){console.error('fail enrich',e);process.exit(1)}
console.log('quick_ok',c,'|',e);
"

echo "=== restart ==="
# Prefer delete+start if restart hangs; use timeout
timeout 45 pm2 restart tgbot --update-env || {
  echo 'restart timed; stop/start'
  pm2 stop tgbot || true
  sleep 2
  pm2 start tgbot --update-env || pm2 restart tgbot --update-env
}
sleep 25
pm2 status tgbot | head -6

KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
# Wait for clients without heavy pool-status pings
echo "=== wait bootstrap 70s ==="
sleep 70

echo "=== catch-up ==="
curl -sS --max-time 40 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all || echo catch_err
echo
sleep 50

echo "=== SCORE ==="
AUDIT_FIX_SINCE='2026-10-27 15:30:00' node scripts/_audit_10of10_score.js
echo
echo "=== PASS2 gaps (online-sensitive) ==="
node scripts/_audit_10of10_pass1.js | head -45
echo FINISH_V2_DONE
