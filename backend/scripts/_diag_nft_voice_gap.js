#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [tags] = await db.execute(
    `SELECT content, COUNT(*) n, MAX(created_at) last
     FROM conversation_messages
     WHERE content LIKE '%nft.ogg%' OR content LIKE '%voice:nft%'
     GROUP BY content
     ORDER BY last DESC
     LIMIT 20`,
  );
  console.log('TAGS', JSON.stringify(tags, null, 2));

  const [[dueReady]] = await db.execute(
    `SELECT COUNT(*) n FROM nft_voice_schedule
     WHERE work_mention_sent=1 AND scheduled_at<=NOW()`,
  );
  console.log('due_with_work_sent', dueReady.n);

  const [[dueNoWork]] = await db.execute(
    `SELECT COUNT(*) n FROM nft_voice_schedule
     WHERE work_mention_sent=0 AND scheduled_at<=NOW()`,
  );
  console.log('due_without_work_mention', dueNoWork.n);

  // peers due+work sent, with last user age
  const [ready] = await db.execute(
    `SELECT s.account_id, s.peer_id, s.scheduled_at, s.work_mention_sent,
            (SELECT MAX(created_at) FROM conversation_messages m
             WHERE m.account_id=s.account_id AND m.peer_id=s.peer_id AND m.role='user') last_user,
            TIMESTAMPDIFF(MINUTE,
              (SELECT MAX(created_at) FROM conversation_messages m
               WHERE m.account_id=s.account_id AND m.peer_id=s.peer_id AND m.role='user'),
              NOW()) idle_min
     FROM nft_voice_schedule s
     WHERE s.work_mention_sent=1 AND s.scheduled_at<=NOW()
     ORDER BY s.scheduled_at DESC
     LIMIT 20`,
  );
  console.log('READY_SAMPLE', JSON.stringify(ready, null, 2));

  const liveReady = ready.filter((r) => r.idle_min != null && r.idle_min <= 60);
  console.log('ready_and_live_60m', liveReady.length);

  const [recentWork] = await db.execute(
    `SELECT account_id, peer_id, LEFT(content,90) c, created_at
     FROM conversation_messages
     WHERE role='assistant'
       AND (content LIKE '%по работе%' OR content LIKE '%проблему с работой%'
            OR content LIKE '%убегу по работе%' OR content LIKE '%позже напишу)%')
       AND created_at >= NOW() - INTERVAL 3 DAY
     ORDER BY created_at DESC
     LIMIT 12`,
  );
  console.log('WORK_ASIDE_3D', JSON.stringify(recentWork, null, 2));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
