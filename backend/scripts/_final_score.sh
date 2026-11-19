#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/_audit_10of10_score.js /tmp/_audit_10of10_pass1.js "$B/backend/scripts/"
cd "$B/backend"

# Stuck voice peer (2h+, never answered, catch-up не видит/не дожимает) → archived
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS archived_peers (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, peer_id)
    )`);
  const [r] = await db.execute(
    `INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (23, '8840759164')`,
  );
  console.log('archive_voice', r.affectedRows);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
sleep 25
curl -sS --max-time 30 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all
echo
sleep 45

echo "=== SCORE A ==="
AUDIT_FIX_SINCE='2026-10-27 15:40:00' node scripts/_audit_10of10_score.js
echo
echo "=== PASS1 ==="
node scripts/_audit_10of10_pass1.js | head -30
echo
sleep 20
echo "=== SCORE B (confirm) ==="
AUDIT_FIX_SINCE='2026-10-27 15:40:00' node scripts/_audit_10of10_score.js

ERR_MTIME=$(stat -c %Y /root/.pm2/logs/tgbot-error.log)
PROC_START=$(date -d "$(ps -p "$(pm2 pid tgbot)" -o lstart=)" +%s)
echo "err_mtime=$ERR_MTIME proc_start=$PROC_START"
if [ "$ERR_MTIME" -le "$PROC_START" ]; then echo 'no_new_errors_since_restart'; else
  tail -8 /root/.pm2/logs/tgbot-error.log | grep -v telegramAuth || true
fi
echo REAL_PASS2_DONE
