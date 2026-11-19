#!/bin/bash
# Clear overdue busy_deferred + recount waiting with new filter semantics (read-only count).
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [del] = await db.execute(
    `DELETE FROM busy_deferred WHERE due_at < (NOW() - INTERVAL 15 MINUTE)`,
  );
  console.log('busy_overdue_deleted', del.affectedRows || 0);

  const [rows] = await db.query(`
    SELECT COUNT(*) AS c FROM (
       SELECT c.account_id, c.peer_id,
              (SELECT LEFT(u.content, 120) FROM conversation_messages u
                WHERE u.account_id = c.account_id AND u.peer_id = c.peer_id
                  AND u.role = 'user'
                ORDER BY u.id DESC LIMIT 1) AS last_user_text
       FROM (
         SELECT account_id, peer_id, MAX(created_at) AS last_user_at
         FROM conversation_messages
         WHERE role = 'user'
           AND created_at >= (NOW() - INTERVAL 6 HOUR)
           AND created_at <= (NOW() - INTERVAL 10 MINUTE)
         GROUP BY account_id, peer_id
       ) c
       JOIN accounts a ON a.id = c.account_id AND a.is_autoreply_enabled = 1
       LEFT JOIN autoreply_disabled_peers ad
         ON ad.account_id = c.account_id AND ad.peer_id = c.peer_id
       LEFT JOIN archived_peers ap
         ON ap.account_id = c.account_id AND ap.peer_id = c.peer_id
       LEFT JOIN operator_lead_flags olf
         ON olf.account_id = c.account_id AND olf.peer_id = c.peer_id
       WHERE ap.peer_id IS NULL
         AND ad.id IS NULL
         AND (olf.funnel_stage IS NULL OR olf.funnel_stage <> 'filtered')
         AND NOT EXISTS (
           SELECT 1 FROM conversation_messages b
           WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
             AND b.role = 'assistant' AND b.created_at >= c.last_user_at
         )
     ) t
     WHERE TRIM(IFNULL(t.last_user_text, '')) <> ''
       AND t.last_user_text NOT REGEXP '^(бери[[:space:]]+трубку|подними[[:space:]]+трубку|возьми[[:space:]]+трубку|позвони|набери|дай[[:space:]]+номер|скинь[[:space:]]+номер)'
       AND t.last_user_text NOT REGEXP '^(пока|ппк|спокойной[[:space:]]+ночи|до[[:space:]]+завтра|я[[:space:]]+спать)([.!?…)]|[[:space:]])*$'
  `);
  console.log('waiting_real_now', Number(rows[0].c));

  const [detail] = await db.query(`
    SELECT c.account_id,
           (SELECT MAX(cm.peer_username) FROM conversation_messages cm
             WHERE cm.account_id=c.account_id AND cm.peer_id=c.peer_id) AS uname,
           TIMESTAMPDIFF(MINUTE, c.last_user_at, NOW()) AS wait_min,
           (SELECT LEFT(u.content, 70) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1) AS last_user
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
    ORDER BY wait_min DESC LIMIT 15
  `);
  for (const r of detail) {
    const t = String(r.last_user || '').replace(/\s+/g, ' ');
    const skip =
      /^(бери\s+трубку|позвони|пока|ппк|я\s+спать|до\s+завтра|спокойной\s+ночи)/i.test(t.trim());
    console.log(JSON.stringify({
      acc: r.account_id,
      peer: r.uname || r.peer_id,
      wait_min: r.wait_min,
      skip,
      t: t.slice(0, 60),
    }));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
