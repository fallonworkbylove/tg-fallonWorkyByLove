#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [cols] = await db.query('SHOW COLUMNS FROM accounts');
  const names = cols.map((c) => c.Field);
  const nameCol = names.includes('first_name')
    ? 'first_name'
    : names.includes('name')
      ? 'name'
      : 'phone';

  const [rows] = await db.query(`
    SELECT c.account_id, a.phone, a.${nameCol} AS aname,
           c.peer_id,
           (SELECT MAX(cm.peer_username) FROM conversation_messages cm
             WHERE cm.account_id=c.account_id AND cm.peer_id=c.peer_id) AS uname,
           TIMESTAMPDIFF(MINUTE, c.last_user_at, NOW()) AS wait_min,
           (SELECT LEFT(u.content,70) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1) AS last_user
    FROM (
      SELECT account_id, peer_id, MAX(created_at) AS last_user_at
      FROM conversation_messages
      WHERE role='user'
        AND created_at >= (NOW() - INTERVAL 2 HOUR)
        AND created_at <= (NOW() - INTERVAL 3 MINUTE)
      GROUP BY account_id, peer_id
    ) c
    JOIN accounts a ON a.id=c.account_id AND a.is_autoreply_enabled=1
    LEFT JOIN autoreply_disabled_peers ad
      ON ad.account_id=c.account_id AND ad.peer_id=c.peer_id
    LEFT JOIN archived_peers ap
      ON ap.account_id=c.account_id AND ap.peer_id=c.peer_id
    WHERE ap.peer_id IS NULL AND ad.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages b
        WHERE b.account_id=c.account_id AND b.peer_id=c.peer_id
          AND b.role='assistant' AND b.created_at >= c.last_user_at
      )
    ORDER BY wait_min DESC
    LIMIT 25
  `);

  console.log('stuck_count', rows.length);
  for (const r of rows) {
    const t = String(r.last_user || '')
      .replace(/\s+/g, ' ')
      .slice(0, 55);
    console.log(
      `#${r.account_id} ${r.aname || r.phone || ''} @${r.uname || r.peer_id} wait=${r.wait_min}m :: ${t}`,
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
