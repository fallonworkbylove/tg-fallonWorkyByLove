require('dotenv').config();
const db = require('../db');

(async () => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS archived_peers (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, peer_id)
    )
  `);

  const [flags] = await db.execute(
    'SELECT funnel_stage, COUNT(*) c FROM operator_lead_flags GROUP BY funnel_stage',
  );
  console.log('operator_lead_flags by stage:', flags);

  const [[arch]] = await db.execute('SELECT COUNT(*) c FROM archived_peers');
  console.log('archived_peers rows:', arch.c);

  const [pitchRows] = await db.execute(`
    SELECT cm.account_id, cm.peer_id,
           MAX(olf.funnel_stage) AS st,
           MAX(ad.reason) AS reason,
           SUM(cm.role = 'assistant' AND cm.content LIKE '%nft.ogg%') AS nft,
           MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_user,
           MAX(ap.peer_id) IS NOT NULL AS in_archived_table,
           COUNT(*) AS msgs
    FROM conversation_messages cm
    JOIN accounts a ON a.id = cm.account_id
    LEFT JOIN archived_peers ap
      ON ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
    LEFT JOIN operator_lead_flags olf
      ON olf.account_id = cm.account_id AND olf.peer_id = cm.peer_id
    LEFT JOIN autoreply_disabled_peers ad
      ON ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
    GROUP BY cm.account_id, cm.peer_id
    HAVING st = 'pitch'
        OR reason = 'nft_voice_sent'
        OR nft > 0
    ORDER BY last_user DESC
  `);

  const visible = pitchRows.filter((r) => !r.in_archived_table);
  const archivedButPitch = pitchRows.filter((r) => r.in_archived_table);
  const old = visible.filter((r) => {
    if (!r.last_user) return true;
    return Date.now() - new Date(r.last_user).getTime() > 24 * 3600 * 1000;
  });

  console.log('pitch-ish total (any):', pitchRows.length);
  console.log('visible (not in archived_peers):', visible.length);
  console.log('in archived_peers but still pitch-ish:', archivedButPitch.length);
  console.log('visible with last_user >24h ago (or null):', old.length);
  console.log(
    'sample visible:',
    visible.slice(0, 12).map((r) => ({
      a: r.account_id,
      p: r.peer_id,
      st: r.st,
      reason: r.reason,
      nft: Number(r.nft),
      last_user: r.last_user,
      msgs: Number(r.msgs),
    })),
  );

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
