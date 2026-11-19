#!/bin/bash
set -euo pipefail
echo "=== PM2 / PROXY ==="
python3 <<'PY'
import json
from subprocess import check_output
j=json.loads(check_output(['pm2','jlist'],text=True))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=e.get('PROXY_LIST') or ''
print({'status':e.get('status'),'restarts':e.get('restart_time'),'PROXY':len([x for x in pl.split(';') if x.strip()]),'uptime_ms':e.get('pm_uptime')})
PY

echo "=== SILENCE ALERTS / ACC 31 ==="
grep -aE 'AI замолчал|silence|OnlyFansOfficialRussia|akstazi_01|#31 |account_id.?31|acc.?31' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -60 || true
grep -aE 'OnlyFansOfficialRussia|akstazi_01|PEER_ID|FROZEN|OPENAI|REFUSE|error|Error|timeout' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -40 || true

echo "=== DB gaps #31 ==="
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [[acc]] = await db.execute(
    `SELECT id, phone, display_name, is_autoreply_enabled,
            session_string IS NOT NULL AND session_string!='' AS has_sess,
            LEFT(IFNULL(prompt,''),40) prompt
     FROM accounts WHERE id=31`,
  );
  console.log('account', acc);
  const [peers] = await db.execute(
    `SELECT peer_id, username, first_name FROM account_peers WHERE account_id=31
     AND (username IN ('OnlyFansOfficialRussia','akstazi_01') OR peer_id LIKE '%akstazi%' OR peer_id LIKE '%OnlyFans%')
     LIMIT 20`,
  ).catch(() => [[]]);
  console.log('peers_lookup', peers);

  const [last] = await db.execute(
    `SELECT id, peer_id, role, LEFT(content,80) c, created_at
     FROM conversation_messages
     WHERE account_id=31
       AND (peer_id IN (
         SELECT peer_id FROM conversation_messages WHERE account_id=31
         GROUP BY peer_id HAVING MAX(created_at) > NOW()-INTERVAL 2 HOUR
       ) OR content LIKE '%OnlyFans%' )
     ORDER BY id DESC LIMIT 40`,
  );

  // recent msgs for those usernames via joining if possible
  const [recent] = await db.execute(
    `SELECT cm.id, cm.peer_id, cm.role, LEFT(cm.content,100) c, cm.created_at,
            TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
     FROM conversation_messages cm
     WHERE cm.account_id=31 AND cm.created_at > NOW()-INTERVAL 3 HOUR
     ORDER BY cm.id DESC LIMIT 50`,
  );
  console.log('recent_50', JSON.stringify(recent, null, 2));

  const [gaps] = await db.execute(
    `SELECT cm.peer_id, LEFT(cm.content,80) c,
            TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m, cm.created_at
     FROM conversation_messages cm
     WHERE cm.account_id=31 AND cm.role='user'
       AND cm.created_at > NOW()-INTERVAL 6 HOUR
       AND NOT EXISTS (
         SELECT 1 FROM conversation_messages x
         WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id
           AND x.role='assistant' AND x.id>cm.id
       )
       AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
       AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
     ORDER BY cm.created_at ASC LIMIT 20`,
  );
  console.log('open_gaps', JSON.stringify(gaps, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
