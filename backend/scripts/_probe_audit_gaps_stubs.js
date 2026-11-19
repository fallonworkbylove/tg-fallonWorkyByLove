#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [stub] = await db.query(`
    SELECT account_id, peer_id, content, created_at
    FROM conversation_messages
    WHERE role = 'assistant'
      AND created_at > (NOW() - INTERVAL 24 HOUR)
      AND (
        content IN ('ну да)', 'ок)', 'ладно)', 'ладно', 'ага)', 'поняла)', 'хах ну да)')
        OR content REGEXP '^(ну да|ок|ладно|ага|поняла|хах ну да)\\\\)?$'
      )
    ORDER BY id DESC
    LIMIT 30
  `);
  console.log('STUBS24h', stub.length);
  for (const r of stub) {
    console.log(String(r.created_at), 'acc' + r.account_id, JSON.stringify(r.content));
  }

  const [gap] = await db.query(`
    SELECT a.id AS aid, a.phone, cm.peer_id,
           LEFT(cm.content, 120) AS last_user, cm.created_at
    FROM accounts a
    JOIN conversation_messages cm
      ON cm.account_id = a.id AND cm.role = 'user'
     AND cm.id = (
       SELECT MAX(id) FROM conversation_messages
       WHERE account_id = a.id AND peer_id = cm.peer_id
     )
    LEFT JOIN conversation_messages ca
      ON ca.account_id = a.id AND ca.peer_id = cm.peer_id AND ca.role = 'assistant'
     AND ca.id > (
       SELECT MAX(id) FROM conversation_messages
       WHERE account_id = a.id AND peer_id = cm.peer_id AND role = 'user'
     )
    WHERE a.is_autoreply_enabled = 1
      AND ca.id IS NULL
      AND cm.created_at > (NOW() - INTERVAL 12 HOUR)
    ORDER BY cm.created_at DESC
    LIMIT 20
  `);
  console.log('GAPS12h', gap.length);
  for (const r of gap) {
    console.log(String(r.created_at), 'acc' + r.aid, r.phone, r.peer_id, JSON.stringify(r.last_user));
  }

  const [[aiSilence]] = await db.query(`
    SELECT COUNT(*) AS c FROM (
      SELECT a.id
      FROM accounts a
      JOIN conversation_messages cm ON cm.account_id=a.id AND cm.role='user'
        AND cm.created_at > (NOW() - INTERVAL 2 HOUR)
      LEFT JOIN conversation_messages ca ON ca.account_id=a.id AND ca.peer_id=cm.peer_id
        AND ca.role='assistant' AND ca.created_at > cm.created_at
      WHERE a.is_autoreply_enabled=1 AND ca.id IS NULL
      GROUP BY a.id, cm.peer_id
    ) t
  `);
  console.log('open_unanswered_2h_pairs', aiSilence.c);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
