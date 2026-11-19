#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1

echo "=== waiting now $(date -u +%H:%M)UTC / MSK $(TZ=Europe/Moscow date +%H:%M) ==="
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [rows] = await db.query(`
    SELECT c.account_id, c.peer_id,
           (SELECT MAX(cm.peer_username) FROM conversation_messages cm
             WHERE cm.account_id=c.account_id AND cm.peer_id=c.peer_id) AS uname,
           TIMESTAMPDIFF(MINUTE, c.last_user_at, NOW()) AS wait_min,
           c.last_user_at,
           (SELECT LEFT(u.content, 100) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1) AS last_user,
           (SELECT LEFT(b.content, 60) FROM conversation_messages b
             WHERE b.account_id=c.account_id AND b.peer_id=c.peer_id AND b.role='assistant'
             ORDER BY b.id DESC LIMIT 1) AS last_bot
    FROM (
      SELECT account_id, peer_id, MAX(created_at) AS last_user_at
      FROM conversation_messages
      WHERE role='user'
        AND created_at >= (NOW() - INTERVAL 6 HOUR)
        AND created_at <= (NOW() - INTERVAL 10 MINUTE)
      GROUP BY account_id, peer_id
    ) c
    JOIN accounts a ON a.id=c.account_id AND a.is_autoreply_enabled=1
    LEFT JOIN autoreply_disabled_peers ad ON ad.account_id=c.account_id AND ad.peer_id=c.peer_id
    LEFT JOIN archived_peers ap ON ap.account_id=c.account_id AND ap.peer_id=c.peer_id
    LEFT JOIN operator_lead_flags olf ON olf.account_id=c.account_id AND olf.peer_id=c.peer_id
    WHERE ap.peer_id IS NULL AND ad.id IS NULL
      AND (olf.funnel_stage IS NULL OR olf.funnel_stage <> 'filtered')
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages b
        WHERE b.account_id=c.account_id AND b.peer_id=c.peer_id
          AND b.role='assistant' AND b.created_at >= c.last_user_at
      )
      AND TRIM(IFNULL((SELECT LEFT(u.content,120) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1),'')) <> ''
      AND TRIM((SELECT LEFT(u.content,120) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1)) NOT REGEXP '^[.!?…]+$'
      AND (SELECT LEFT(u.content,120) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1)
          NOT REGEXP '(^|[[:space:][:punct:]]+)(пока|ппк)([.!?…)]|[[:space:]])*$'
    ORDER BY wait_min DESC LIMIT 20
  `);
  console.log('waiting', rows.length);
  for (const r of rows) {
    console.log(JSON.stringify({
      acc: r.account_id,
      peer: r.uname || r.peer_id,
      peer_id: r.peer_id,
      wait_min: r.wait_min,
      t: String(r.last_user||'').replace(/\s+/g,' ').slice(0,70),
    }));
  }
  // clear overdue busy
  const [del] = await db.execute(`DELETE FROM busy_deferred WHERE due_at < (NOW() - INTERVAL 5 MINUTE)`);
  console.log('busy_cleared', del.affectedRows||0);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE

echo "--- health ---"
curl -sS -m 8 http://127.0.0.1:3000/api/health; echo

echo "--- recent heal/err ---"
grep -aE 'silence-heal|очереди/Занята|healed ' /root/.pm2/logs/tgbot-out.log | tail -15
grep -aE 'Ошибка обработки|сдох →|circuit' /root/.pm2/logs/tgbot-error.log | tail -12
