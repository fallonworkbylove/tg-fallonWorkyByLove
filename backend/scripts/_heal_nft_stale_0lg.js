/**
 * One-shot: закрыть все stale stuck «по работе» без ГС по всем аккам.
 */
require('dotenv').config({ quiet: true });
const db = require('../db');
const nft = require('../services/nftCampaign');

(async () => {
  await nft.ensureNftScheduleTable();
  const [accs] = await db.execute(
    `SELECT DISTINCT account_id AS id FROM nft_voice_schedule WHERE work_mention_sent = 1`,
  );
  let total = 0;
  for (const a of accs || []) {
    total += Number(await nft.expireStaleNftAfterWork(a.id)) || 0;
  }
  const [[left]] = await db.execute(
    `SELECT COUNT(*) AS n FROM nft_voice_schedule nvs
     WHERE nvs.work_mention_sent = 1
       AND (nvs.voice_skip_reason IS NULL OR nvs.voice_skip_reason = '')
       AND nvs.scheduled_at < (NOW() - INTERVAL 90 MINUTE)
       AND NOT EXISTS (
         SELECT 1 FROM conversation_messages cm
         WHERE cm.account_id = nvs.account_id AND cm.peer_id = nvs.peer_id
           AND cm.role = 'assistant'
           AND (cm.content LIKE '%[голосовое: nft.ogg]%' OR cm.content LIKE '%nft.ogg%')
           AND cm.created_at >= nvs.work_mention_at
       )`,
  );
  console.log(JSON.stringify({ expired: total, stuckLeft: Number(left.n) }));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
