/**
 * Диагностика stuck «по работе» без nft.ogg.
 */
require('dotenv').config({ quiet: true });
const db = require('../db');

(async () => {
  const [rows] = await db.execute(
    `SELECT nvs.account_id, nvs.peer_id, nvs.scheduled_at, nvs.work_mention_at,
            nvs.voice_skip_reason,
            TIMESTAMPDIFF(MINUTE, nvs.scheduled_at, NOW()) AS overdue_min,
            (SELECT COUNT(*) FROM conversation_messages c
              WHERE c.account_id=nvs.account_id AND c.peer_id=nvs.peer_id) AS msg_n,
            (SELECT MAX(c.created_at) FROM conversation_messages c
              WHERE c.account_id=nvs.account_id AND c.peer_id=nvs.peer_id AND c.role='user') AS last_user,
            (SELECT ad.reason FROM autoreply_disabled_peers ad
              WHERE ad.account_id=nvs.account_id AND ad.peer_id=nvs.peer_id LIMIT 1) AS pause_reason,
            (SELECT olf.funnel_stage FROM operator_lead_flags olf
              WHERE olf.account_id=nvs.account_id AND olf.peer_id=nvs.peer_id LIMIT 1) AS stage
     FROM nft_voice_schedule nvs
     WHERE nvs.work_mention_sent = 1
       AND (nvs.voice_skip_reason IS NULL OR nvs.voice_skip_reason = '')
       AND nvs.scheduled_at < (NOW() - INTERVAL 90 MINUTE)
       AND NOT EXISTS (
         SELECT 1 FROM conversation_messages cm
         WHERE cm.account_id = nvs.account_id AND cm.peer_id = nvs.peer_id
           AND cm.role = 'assistant'
           AND (cm.content LIKE '%[голосовое: nft.ogg]%' OR cm.content LIKE '%nft.ogg%')
           AND cm.created_at >= nvs.work_mention_at
       )
     ORDER BY nvs.scheduled_at ASC
     LIMIT 40`,
  );
  console.log('stuck_count', rows.length);
  for (const r of rows) {
    console.log(
      JSON.stringify({
        account_id: r.account_id,
        peer_id: String(r.peer_id),
        overdue_min: r.overdue_min,
        msg_n: r.msg_n,
        last_user: r.last_user,
        pause_reason: r.pause_reason,
        stage: r.stage,
        skip: r.voice_skip_reason,
        scheduled_at: r.scheduled_at,
      }),
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
