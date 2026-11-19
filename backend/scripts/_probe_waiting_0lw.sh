#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [cols] = await db.query('SHOW COLUMNS FROM accounts');
  const fields = cols.map((c) => c.Field);
  const nameCol = ['name', 'account_name', 'label', 'username'].find((f) => fields.includes(f)) || 'phone';

  const [rows] = await db.query(`
    SELECT c.account_id, a.phone, a.\`${nameCol}\` AS aname, a.is_autoreply_enabled,
           c.peer_id,
           (SELECT MAX(cm.peer_username) FROM conversation_messages cm
             WHERE cm.account_id=c.account_id AND cm.peer_id=c.peer_id) AS uname,
           TIMESTAMPDIFF(MINUTE, c.last_user_at, NOW()) AS wait_min,
           (SELECT LEFT(u.content, 90) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1) AS last_user,
           (SELECT LEFT(b.content, 60) FROM conversation_messages b
             WHERE b.account_id=c.account_id AND b.peer_id=c.peer_id AND b.role='assistant'
             ORDER BY b.id DESC LIMIT 1) AS last_bot,
           (SELECT olf.funnel_stage FROM operator_lead_flags olf
             WHERE olf.account_id=c.account_id AND olf.peer_id=c.peer_id LIMIT 1) AS funnel,
           EXISTS(SELECT 1 FROM archived_peers ap
             WHERE ap.account_id=c.account_id AND ap.peer_id=c.peer_id) AS archived,
           EXISTS(SELECT 1 FROM autoreply_disabled_peers ad
             WHERE ad.account_id=c.account_id AND ad.peer_id=c.peer_id) AS disabled
    FROM (
      SELECT account_id, peer_id, MAX(created_at) AS last_user_at
      FROM conversation_messages
      WHERE role='user'
        AND created_at >= (NOW() - INTERVAL 6 HOUR)
        AND created_at <= (NOW() - INTERVAL 10 MINUTE)
      GROUP BY account_id, peer_id
    ) c
    JOIN accounts a ON a.id = c.account_id AND a.is_autoreply_enabled = 1
    LEFT JOIN autoreply_disabled_peers ad
      ON ad.account_id = c.account_id AND ad.peer_id = c.peer_id
    WHERE ad.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages b
        WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
          AND b.role = 'assistant' AND b.created_at >= c.last_user_at
      )
    ORDER BY wait_min DESC
    LIMIT 40
  `);

  console.log('waiting_gt10m', rows.length);
  for (const r of rows) {
    console.log(JSON.stringify({
      acc: r.account_id,
      name: r.aname || r.phone,
      peer: r.uname || r.peer_id,
      wait_min: r.wait_min,
      funnel: r.funnel,
      archived: !!Number(r.archived),
      last_user: String(r.last_user || '').replace(/\s+/g, ' ').slice(0, 70),
      last_bot: String(r.last_bot || '').replace(/\s+/g, ' ').slice(0, 40),
    }));
  }

  // busy deferred if table exists
  try {
    const [busy] = await db.query(`
      SELECT account_id, peer_id, due_at, TIMESTAMPDIFF(MINUTE, NOW(), due_at) AS due_in_min
      FROM busy_deferred
      WHERE due_at > NOW() - INTERVAL 1 HOUR
      ORDER BY due_at ASC LIMIT 20
    `);
    console.log('busy_deferred_open', busy.length);
    for (const b of busy) console.log(JSON.stringify(b));
  } catch (e) {
    console.log('busy_deferred_skip', e.message.slice(0, 80));
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
