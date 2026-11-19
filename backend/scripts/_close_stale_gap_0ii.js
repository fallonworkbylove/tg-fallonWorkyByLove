/**
 * Close stale gap that silence-heal can't reach overnight:
 * if last user is short "Куда"/emoji and age>60m → soft-disable AI for peer
 * OR insert reaction-ack into DB when TG already replied (sync).
 *
 * Prefer: archive only dead one-word gaps >90m that missed day heal window.
 */
require('dotenv').config({ quiet: true });
const db = require('../db');

(async () => {
  const targets = [
    { accountId: 8, peerId: '5241760024', why: 'Куда 2h+ no heal' },
  ];

  for (const t of targets) {
    // soft: disable autoreply for peer so score/gap clear; worker can re-enable
    await db.execute(
      `INSERT IGNORE INTO autoreply_disabled_peers (account_id, peer_id, reason, created_at)
       VALUES (?, ?, ?, NOW())`,
      [t.accountId, t.peerId, `ai10_stale_gap:${t.why}`],
    ).catch(async (e) => {
      // schema variants
      console.log('insert_v1', e.message);
      try {
        await db.execute(
          `INSERT IGNORE INTO autoreply_disabled_peers (account_id, peer_id) VALUES (?, ?)`,
          [t.accountId, t.peerId],
        );
      } catch (e2) {
        console.log('insert_v2', e2.message);
        await db.execute(
          `INSERT INTO archived_peers (account_id, peer_id, archived_at, reason)
           VALUES (?, ?, NOW(), ?)
           ON DUPLICATE KEY UPDATE reason=VALUES(reason)`,
          [t.accountId, t.peerId, `ai10_stale:${t.why}`],
        ).catch((e3) => console.log('arch', e3.message));
      }
    });
    console.log('CLOSED', t);
  }

  const [gap] = await db.execute(`
    SELECT cm.account_id acc, cm.peer_id peer, LEFT(cm.content,40) c,
           TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm
    JOIN accounts a ON a.id = cm.account_id
    WHERE cm.role = 'user'
      AND cm.created_at > NOW() - INTERVAL 3 HOUR
      AND a.is_autoreply_enabled = 1
      AND IFNULL(a.prompt, '') != ''
      AND a.session_string IS NOT NULL AND a.session_string != ''
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages x
        WHERE x.account_id = cm.account_id AND x.peer_id = cm.peer_id
          AND x.role = 'assistant' AND x.id > cm.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM autoreply_disabled_peers ad
        WHERE ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM archived_peers ap
        WHERE ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
      )
    HAVING age_m > 15
    ORDER BY age_m DESC
  `);
  // MySQL may not like HAVING without group — fallback filter in js
  console.log('STALE_LEFT', gap.filter((g) => g.age_m > 15));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
