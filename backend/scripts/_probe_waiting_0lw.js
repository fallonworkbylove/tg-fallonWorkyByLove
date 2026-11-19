#!/usr/bin/env node
/**
 * List dialogs waiting >10m without assistant reply (same as waiting-leads watch).
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
try {
  require('dotenv').config();
} catch (_) {}

const db = require('../db');

(async () => {
  const [rows] = await db.query(`
    SELECT c.account_id, a.phone, a.name, a.is_autoreply_enabled,
           c.peer_id,
           (SELECT MAX(cm.peer_username) FROM conversation_messages cm
             WHERE cm.account_id=c.account_id AND cm.peer_id=c.peer_id) AS uname,
           c.last_user_at,
           TIMESTAMPDIFF(MINUTE, c.last_user_at, NOW()) AS wait_min,
           (SELECT LEFT(u.content, 100) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1) AS last_user,
           (SELECT LEFT(b.content, 80) FROM conversation_messages b
             WHERE b.account_id=c.account_id AND b.peer_id=c.peer_id AND b.role='assistant'
             ORDER BY b.id DESC LIMIT 1) AS last_bot,
           (SELECT ad.reason FROM autoreply_disabled_peers ad
             WHERE ad.account_id=c.account_id AND ad.peer_id=c.peer_id LIMIT 1) AS disabled_reason,
           (SELECT olf.funnel_stage FROM operator_lead_flags olf
             WHERE olf.account_id=c.account_id AND olf.peer_id=c.peer_id LIMIT 1) AS funnel,
           EXISTS(SELECT 1 FROM archived_peers ap
             WHERE ap.account_id=c.account_id AND ap.peer_id=c.peer_id) AS archived
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
    const t = String(r.last_user || '').replace(/\s+/g, ' ').slice(0, 70);
    console.log(
      JSON.stringify({
        acc: r.account_id,
        name: r.name || r.phone,
        peer: r.uname || r.peer_id,
        wait_min: r.wait_min,
        funnel: r.funnel,
        archived: !!r.archived,
        last_user: t,
        last_bot: String(r.last_bot || '').replace(/\s+/g, ' ').slice(0, 50),
      }),
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
