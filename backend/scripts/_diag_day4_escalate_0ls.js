#!/usr/bin/env node
/** Диагностика day4 escalate: уже nft? или ещё до кампании? */
require('dotenv').config({ quiet: true });
const db = require('../db');

const NAMES = [
  'Doeks67',
  'tkaaach31',
  'jeka9417',
  'Israil',
  'Иван',
  'Алексей',
  'bloodmoon071',
  'Sufi',
  'George_2288',
  'Shwepesssssss',
];

(async () => {
  const [rows] = await db.execute(
    `SELECT olf.account_id, olf.peer_id, olf.funnel_stage, olf.updated_at,
            MAX(cm.peer_username) AS uname,
            (SELECT content FROM conversation_messages c2
              WHERE c2.account_id=olf.account_id AND c2.peer_id=olf.peer_id AND c2.role='assistant'
              ORDER BY c2.created_at DESC LIMIT 1) AS last_bot,
            (SELECT MAX(created_at) FROM conversation_messages c3
              WHERE c3.account_id=olf.account_id AND c3.peer_id=olf.peer_id AND c3.role='user') AS last_user_at,
            (SELECT MAX(created_at) FROM conversation_messages c4
              WHERE c4.account_id=olf.account_id AND c4.peer_id=olf.peer_id AND c4.role='assistant') AS last_bot_at,
            (SELECT COUNT(*) FROM conversation_messages c5
              WHERE c5.account_id=olf.account_id AND c5.peer_id=olf.peer_id AND c5.role='assistant'
                AND (c5.content LIKE '%[голосовое: nft.ogg]%' OR c5.content LIKE '%nft.ogg%')) AS nft_voice,
            (SELECT work_mention_sent FROM nft_voice_schedule n
              WHERE n.account_id=olf.account_id AND n.peer_id=olf.peer_id LIMIT 1) AS work_sent,
            (SELECT scheduled_at FROM nft_voice_schedule n
              WHERE n.account_id=olf.account_id AND n.peer_id=olf.peer_id LIMIT 1) AS sched,
            (SELECT voice_skip_reason FROM nft_voice_schedule n
              WHERE n.account_id=olf.account_id AND n.peer_id=olf.peer_id LIMIT 1) AS skip,
            (SELECT reason FROM autoreply_disabled_peers ad
              WHERE ad.account_id=olf.account_id AND ad.peer_id=olf.peer_id LIMIT 1) AS ar_off
     FROM operator_lead_flags olf
     LEFT JOIN conversation_messages cm
       ON cm.account_id = olf.account_id AND cm.peer_id = olf.peer_id
     WHERE olf.funnel_stage IN ('day4','pitch','operator')
       AND olf.updated_at <= (NOW() - INTERVAL 6 HOUR)
       AND olf.updated_at >= (NOW() - INTERVAL 3 DAY)
     GROUP BY olf.account_id, olf.peer_id, olf.funnel_stage, olf.updated_at
     ORDER BY olf.updated_at ASC
     LIMIT 20`,
  );

  console.log('=== day4 escalate snapshot ===');
  for (const r of rows) {
    const name = r.uname || r.peer_id;
    console.log(
      JSON.stringify({
        acc: r.account_id,
        name,
        stage: r.funnel_stage,
        flag_age_h: Math.round((Date.now() - new Date(r.updated_at).getTime()) / 3600000),
        nft_voice: Number(r.nft_voice),
        work_sent: r.work_sent,
        sched: r.sched,
        skip: r.skip,
        ar_off: r.ar_off,
        last_user: r.last_user_at,
        last_bot: r.last_bot_at,
        last_bot_snip: String(r.last_bot || '').slice(0, 80),
      }),
    );
  }

  const needNft = rows.filter((r) => !Number(r.nft_voice));
  const doneNft = rows.filter((r) => Number(r.nft_voice) > 0);
  console.log(
    JSON.stringify({
      total: rows.length,
      alreadyHadNftVoice: doneNft.length,
      stillNeedNftPath: needNft.length,
      note:
        'pitch+nft_voice обычно = уже после ГС, ждёт оператора; дожимать до NFT нельзя — ГС уже ушёл',
    }),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
