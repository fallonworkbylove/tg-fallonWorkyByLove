#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { isWithinNftCampaignHours } = require('../services/timing');
const { VOICES_DIR } = require('../services/voiceReplies');

(async () => {
  const nftPath = path.join(VOICES_DIR, 'nft.ogg');
  console.log(
    JSON.stringify(
      {
        nowUtc: new Date().toISOString(),
        withinNftHours: isWithinNftCampaignHours(),
        nftOgg: fs.existsSync(nftPath) ? nftPath : null,
      },
      null,
      2,
    ),
  );

  const [[c]] = await db.execute('SELECT COUNT(*) AS n FROM nft_voice_schedule');
  const [[pend]] = await db.execute(
    'SELECT COUNT(*) AS n FROM nft_voice_schedule WHERE work_mention_sent = 0',
  );
  const [[sent]] = await db.execute(
    'SELECT COUNT(*) AS n FROM nft_voice_schedule WHERE work_mention_sent = 1',
  );
  const [[due]] = await db.execute(
    'SELECT COUNT(*) AS n FROM nft_voice_schedule WHERE scheduled_at <= NOW()',
  );
  // history.voiceTag → «[голосовое: nft.ogg]» (не [voice:…])
  const [[voices]] = await db.execute(
    `SELECT COUNT(*) AS n FROM conversation_messages
     WHERE role='assistant'
       AND (content LIKE '%[голосовое: nft.ogg]%' OR content LIKE '%nft.ogg%')
       AND created_at >= NOW() - INTERVAL 7 DAY`,
  );
  const [[workAside]] = await db.execute(
    `SELECT COUNT(*) AS n FROM conversation_messages
     WHERE role='assistant'
       AND (content LIKE '%по работе%' OR content LIKE '%проблему с работой%')
       AND created_at >= NOW() - INTERVAL 7 DAY`,
  );
  const [[nftHintish]] = await db.execute(
    `SELECT COUNT(*) AS n FROM conversation_messages
     WHERE role='assistant'
       AND (content LIKE '%NFT%' OR content LIKE '%нфт%' OR content LIKE '%токен%' OR content LIKE '%флип%')
       AND created_at >= NOW() - INTERVAL 48 HOUR`,
  );
  console.log(
    JSON.stringify(
      {
        schedule_total: c.n,
        work_mention_pending: pend.n,
        work_mention_sent: sent.n,
        scheduled_at_passed: due.n,
        voice_nft_7d: voices.n,
        work_aside_7d: workAside.n,
        nftish_replies_48h: nftHintish.n,
      },
      null,
      2,
    ),
  );

  const [rows] = await db.execute(
    `SELECT account_id, peer_id, scheduled_at, work_mention_at, work_mention_sent
     FROM nft_voice_schedule
     ORDER BY scheduled_at DESC
     LIMIT 12`,
  );
  console.log('RECENT_SCHEDULE', JSON.stringify(rows, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
