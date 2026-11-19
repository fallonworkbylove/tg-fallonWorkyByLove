#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
for (const line of fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const db = require('../db');
(async () => {
  const out = {};

  const [earlyWin] = await db.query(
    `SELECT
       SUM(TIMESTAMPDIFF(HOUR, first_user, first_flip) < 2) AS early_lt2h,
       SUM(TIMESTAMPDIFF(HOUR, first_user, first_flip) < 24) AS early_lt24h,
       SUM(TIMESTAMPDIFF(HOUR, first_user, first_flip) >= 24) AS ok_ge24h,
       COUNT(*) AS with_flip
     FROM (
       SELECT cm.account_id, cm.peer_id,
         MIN(CASE WHEN cm.role='user' THEN cm.created_at END) first_user,
         MIN(CASE WHEN cm.role='assistant' AND (cm.content LIKE '%флип%' OR cm.content LIKE '%токен%' OR cm.content LIKE '%NFT%') THEN cm.created_at END) first_flip
       FROM conversation_messages cm
       WHERE cm.created_at > (NOW() - INTERVAL 7 DAY)
       GROUP BY cm.account_id, cm.peer_id
       HAVING first_flip IS NOT NULL AND first_user IS NOT NULL
     ) t`,
  );
  out.early7d = earlyWin[0];

  const [early12h] = await db.query(
    `SELECT COUNT(*) n FROM (
       SELECT cm.account_id, cm.peer_id,
         MIN(CASE WHEN cm.role='user' THEN cm.created_at END) first_user,
         MIN(CASE WHEN cm.role='assistant' AND (cm.content LIKE '%флип%' OR cm.content LIKE '%токен%') THEN cm.created_at END) first_flip
       FROM conversation_messages cm
       WHERE cm.created_at > (NOW() - INTERVAL 12 HOUR)
       GROUP BY cm.account_id, cm.peer_id
       HAVING first_flip IS NOT NULL AND first_user IS NOT NULL
          AND TIMESTAMPDIFF(HOUR, first_user, first_flip) < 2
     ) t`,
  );
  out.earlyFlipLast12h = early12h[0].n;

  const [acc] = await db.query(
    `SELECT COUNT(*) total,
      SUM(CASE WHEN session_string IS NOT NULL AND session_string != '' THEN 1 ELSE 0 END) with_session
     FROM accounts`,
  ).catch(async () => {
    const [c] = await db.query(`SHOW COLUMNS FROM accounts`);
    out.accountCols = c.map((x) => x.Field);
    const [a] = await db.query(`SELECT COUNT(*) total FROM accounts`);
    return [a];
  });
  out.accounts = acc[0];

  // online-ish from recent outbound
  const [activeAcc] = await db.query(
    `SELECT COUNT(DISTINCT account_id) n FROM conversation_messages
     WHERE role='assistant' AND created_at > (NOW() - INTERVAL 6 HOUR)`,
  );
  out.activeAccounts6h = activeAcc[0].n;

  const [profitAge] = await db.query(
    `SELECT AVG(TIMESTAMPDIFF(HOUR, first_user, first_photo)) avg_h,
            MIN(TIMESTAMPDIFF(HOUR, first_user, first_photo)) min_h,
            COUNT(*) n
     FROM (
       SELECT cm.account_id, cm.peer_id,
         MIN(CASE WHEN cm.role='user' THEN cm.created_at END) first_user,
         MIN(CASE WHEN cm.role='assistant' AND cm.content LIKE '%[фото от меня:%' AND (cm.content LIKE '%флип%' OR cm.content LIKE '%профит%' OR cm.content LIKE '%NFT%') THEN cm.created_at END) first_photo
       FROM conversation_messages cm
       WHERE cm.created_at > (NOW() - INTERVAL 7 DAY)
       GROUP BY cm.account_id, cm.peer_id
       HAVING first_photo IS NOT NULL AND first_user IS NOT NULL
     ) t`,
  );
  out.profitPhotoAgeHours = profitAge[0];

  const [appearance] = await db.query(
    `SELECT COUNT(*) n FROM conversation_messages
     WHERE role='assistant' AND created_at > (NOW() - INTERVAL 7 DAY)
       AND content LIKE '%[фото от меня:%'
       AND (content LIKE '%это я%' OR content LIKE '%бород%' OR content LIKE '%к лицу%')`,
  );
  out.appearanceBugs7d = appearance[0].n;

  const [softOnlineDay1] = await db.query(
    `SELECT COUNT(*) n FROM (
       SELECT cm.account_id, cm.peer_id,
         MIN(CASE WHEN cm.role='user' THEN cm.created_at END) first_user,
         MIN(CASE WHEN cm.role='assistant' AND (cm.content LIKE '%работаю онлайн%' OR cm.content LIKE '%гибкий график%' OR cm.content LIKE '%сама на себя%')
           AND cm.content NOT LIKE '%флип%' AND cm.content NOT LIKE '%токен%' THEN cm.created_at END) first_soft
       FROM conversation_messages cm
       WHERE cm.created_at > (NOW() - INTERVAL 12 HOUR)
       GROUP BY cm.account_id, cm.peer_id
       HAVING first_soft IS NOT NULL AND first_user IS NOT NULL
          AND TIMESTAMPDIFF(HOUR, first_user, first_soft) < 24
     ) t`,
  );
  out.softJobDay1_12h = softOnlineDay1[0].n;

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
