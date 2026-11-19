#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cd "$B/backend"
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)

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
  // 352m gap — catch-up не видит/не дожимает; архив чтобы не thrash
  const [r1] = await db.execute(
    `INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (10, '691610845')`,
  );
  console.log('archive_old', r1.affectedRows);
  // стикер 28m — ещё свежий: не архивируем, пусть catch-up
  const peers = [[10, '691610845'], [10, '1355605766']];
  for (const [acc, peer] of peers) {
    const [tail] = await db.execute(
      `SELECT role, LEFT(content,70) c, created_at FROM conversation_messages
       WHERE account_id=? AND peer_id=? ORDER BY id DESC LIMIT 3`,
      [acc, peer],
    );
    const [arch] = await db.execute(
      `SELECT 1 x FROM archived_peers WHERE account_id=? AND peer_id=?`,
      [acc, peer],
    );
    console.log(JSON.stringify({ acc, peer, archived: arch.length > 0, tail }));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

curl -sS --max-time 30 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all
echo
sleep 55

# soft-fix glued "нетсейчас" if still happening — deploy tiny softHuman if needed later
echo '---ULTRA A---'
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const m=d.match(/\{[\s\S]*\}\nP0_COUNT/);
  // print summary lines
  const score=d.match(/\"score\": \{[\s\S]*?\n  \}/);
  const overall=d.match(/\"overall\": [0-9.]+/);
  const checks=d.match(/\"checks\": \{[\s\S]*?\n  \}/);
  const findings=d.match(/\"findings\": \[[\s\S]*?\n  \]/);
  const vol=d.match(/\"volume\": \{[\s\S]*?\n  \}/);
  const lens=d.match(/\"reply_length_since_fix\": \{[\s\S]*?\n  \}/);
  const acc=d.match(/\"accounts\": \{[\s\S]*?\n  \}/);
  console.log(score&&score[0]);
  console.log(overall&&overall[0]);
  console.log(checks&&checks[0]);
  console.log(findings&&findings[0]);
  console.log(vol&&vol[0]);
  console.log(lens&&lens[0]);
  console.log(acc&&acc[0]);
  const v=d.match(/VERDICT.*/);
  console.log(v&&v[0]);
  const p0=d.match(/P0_COUNT.*/);
  console.log(p0&&p0[0]);
  // write full for canvas
  fs=require('fs');
  fs.writeFileSync('/tmp/ultra_full.json', d.slice(d.indexOf('{'), d.lastIndexOf('}')+1));
});
"

echo '---ULTRA B---'
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js | grep -E 'VERDICT|P0_COUNT|CHECKS|overall|findings|stale'

# err freshness
PID=$(pm2 pid tgbot)
PROC=$(date -d "$(ps -p "$PID" -o lstart=)" +%s)
ERR=$(stat -c %Y /root/.pm2/logs/tgbot-error.log)
echo "proc_start=$PROC err_mtime=$ERR"
if [ "$ERR" -le "$PROC" ]; then echo 'err_log_not_newer_than_process'; else
  echo 'recent_err_tail:';
  tail -8 /root/.pm2/logs/tgbot-error.log | grep -v telegramAuth || true
fi
echo CLEAR_DONE
