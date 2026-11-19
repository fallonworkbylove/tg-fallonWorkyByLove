require('dotenv').config({ quiet: true });
const db = require('../db');
(async () => {
  const [[a]] = await db.execute(
    `SELECT COUNT(*) n FROM nft_voice_schedule nvs
     WHERE work_mention_sent=0
       AND (voice_skip_reason IS NULL OR voice_skip_reason='')
       AND EXISTS (
         SELECT 1 FROM conversation_messages u
         WHERE u.account_id=nvs.account_id AND u.peer_id=nvs.peer_id
           AND u.role='user' AND u.created_at>=NOW()-INTERVAL 90 MINUTE
       )`,
  );
  const [[b]] = await db.execute(
    `SELECT COUNT(*) n FROM nft_voice_schedule
     WHERE work_mention_sent=0 AND (voice_skip_reason IS NULL OR voice_skip_reason='')`,
  );
  console.log(JSON.stringify({ live90: Number(a.n), open_work: Number(b.n) }));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
