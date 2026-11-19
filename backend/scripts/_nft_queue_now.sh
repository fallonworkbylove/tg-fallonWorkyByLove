#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [[tot]] = await db.execute('SELECT COUNT(*) AS n FROM nft_voice_schedule');
  const [[pend]] = await db.execute(
    `SELECT COUNT(*) AS n FROM nft_voice_schedule
     WHERE work_mention_sent = 0
       AND (voice_skip_reason IS NULL OR voice_skip_reason = '')`,
  );
  const [[awaitVoice]] = await db.execute(
    `SELECT COUNT(*) AS n FROM nft_voice_schedule
     WHERE work_mention_sent = 1
       AND (voice_skip_reason IS NULL OR voice_skip_reason = '')
       AND NOT EXISTS (
         SELECT 1 FROM conversation_messages cm
         WHERE cm.account_id = nft_voice_schedule.account_id
           AND cm.peer_id = nft_voice_schedule.peer_id
           AND cm.role = 'assistant'
           AND (cm.content LIKE '%[голосовое: nft.ogg]%' OR cm.content LIKE '%nft.ogg%')
           AND cm.created_at >= COALESCE(work_mention_at, scheduled_at)
       )`,
  );
  const [[stale]] = await db.execute(
    `SELECT COUNT(*) AS n FROM nft_voice_schedule WHERE voice_skip_reason = 'stale_dialog'`,
  );
  const [[forbid]] = await db.execute(
    `SELECT COUNT(*) AS n FROM nft_voice_schedule
     WHERE voice_skip_reason IS NOT NULL AND voice_skip_reason <> '' AND voice_skip_reason <> 'stale_dialog'`,
  );
  const [[voiceDone]] = await db.execute(
    `SELECT COUNT(*) AS n FROM nft_voice_schedule nvs
     WHERE EXISTS (
       SELECT 1 FROM conversation_messages cm
       WHERE cm.account_id = nvs.account_id AND cm.peer_id = nvs.peer_id
         AND cm.role = 'assistant'
         AND (cm.content LIKE '%[голосовое: nft.ogg]%' OR cm.content LIKE '%nft.ogg%')
     )`,
  );
  const [[voice7d]] = await db.execute(
    `SELECT COUNT(*) AS n FROM conversation_messages
     WHERE role='assistant'
       AND (content LIKE '%[голосовое: nft.ogg]%' OR content LIKE '%nft.ogg%')
       AND created_at >= NOW() - INTERVAL 7 DAY`,
  );
  const [[dueVoiceNow]] = await db.execute(
    `SELECT COUNT(*) AS n FROM nft_voice_schedule
     WHERE work_mention_sent = 1
       AND (voice_skip_reason IS NULL OR voice_skip_reason = '')
       AND scheduled_at <= NOW()`,
  );
  const [[dueWorkLive]] = await db.execute(
    `SELECT COUNT(*) AS n FROM nft_voice_schedule nvs
     WHERE nvs.work_mention_sent = 0
       AND (nvs.voice_skip_reason IS NULL OR nvs.voice_skip_reason = '')
       AND EXISTS (
         SELECT 1 FROM conversation_messages u
         WHERE u.account_id = nvs.account_id AND u.peer_id = nvs.peer_id
           AND u.role = 'user'
           AND u.created_at >= (NOW() - INTERVAL 30 MINUTE)
       )`,
  );
  console.log(JSON.stringify({
    scheduleTotal: Number(tot.n),
    stillOpenWorkPending: Number(pend.n),
    stillOpenAwaitVoice: Number(awaitVoice.n),
    stillOpenTotal: Number(pend.n) + Number(awaitVoice.n),
    closedStaleDialog: Number(stale.n),
    closedOtherSkip: Number(forbid.n),
    alreadyHadNftVoice: Number(voiceDone.n),
    voiceSent7d: Number(voice7d.n),
    dueVoiceSlotNow: Number(dueVoiceNow.n),
    workPendingWithLiveChat30m: Number(dueWorkLive.n),
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
NODE
