#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend || exit 1
node <<'NODE'
require('dotenv').config({ quiet: true });
const silence = require('./services/silenceCatchup');
(async () => {
  const gaps = await silence.findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 3, limit: 20 });
  console.log('gaps', gaps.length);
  for (const g of gaps) {
    console.log(JSON.stringify({
      a: g.account_id,
      p: g.peer_id,
      u: g.peer_username,
      t: String(g.last_user_text || '').replace(/\s+/g, ' ').slice(0, 60),
      at: g.last_user_at,
    }));
  }

  // new waiting count SQL
  const db = require('./db');
  const [rows] = await db.query(`
    SELECT COUNT(*) AS c FROM (
       SELECT c.account_id, c.peer_id,
              (SELECT LEFT(u.content, 120) FROM conversation_messages u
                WHERE u.account_id = c.account_id AND u.peer_id = c.peer_id
                  AND u.role = 'user'
                ORDER BY u.id DESC LIMIT 1) AS last_user_text
       FROM (
         SELECT account_id, peer_id, MAX(created_at) AS last_user_at
         FROM conversation_messages
         WHERE role = 'user'
           AND created_at >= (NOW() - INTERVAL 6 HOUR)
           AND created_at <= (NOW() - INTERVAL 10 MINUTE)
         GROUP BY account_id, peer_id
       ) c
       JOIN accounts a ON a.id = c.account_id AND a.is_autoreply_enabled = 1
       LEFT JOIN autoreply_disabled_peers ad
         ON ad.account_id = c.account_id AND ad.peer_id = c.peer_id
       LEFT JOIN archived_peers ap
         ON ap.account_id = c.account_id AND ap.peer_id = c.peer_id
       LEFT JOIN operator_lead_flags olf
         ON olf.account_id = c.account_id AND olf.peer_id = c.peer_id
       WHERE ap.peer_id IS NULL
         AND ad.id IS NULL
         AND (olf.funnel_stage IS NULL OR olf.funnel_stage <> 'filtered')
         AND NOT EXISTS (
           SELECT 1 FROM conversation_messages b
           WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
             AND b.role = 'assistant' AND b.created_at >= c.last_user_at
         )
     ) t
     WHERE TRIM(IFNULL(t.last_user_text, '')) <> ''
       AND t.last_user_text NOT REGEXP '^(бери[[:space:]]+трубку|подними[[:space:]]+трубку|возьми[[:space:]]+трубку|позвони|набери|дай[[:space:]]+номер|скинь[[:space:]]+номер)'
       AND t.last_user_text NOT REGEXP '(^|[[:space:][:punct:]]+)(пока|ппк)([.!?…)]|[[:space:]])*$'
       AND t.last_user_text NOT REGEXP '^(спокойной[[:space:]]+ночи|до[[:space:]]+завтра|я[[:space:]]+спать)([.!?…)]|[[:space:]])*$'
  `);
  console.log('waiting_filtered', Number(rows[0].c));

  const [samples] = await db.query(`
    SELECT t.last_user_text,
           t.last_user_text REGEXP '(^|[[:space:][:punct:]]+)(пока|ппк)([.!?…)]|[[:space:]])*$' AS re_pokа
    FROM (
      SELECT 'понял, пока' AS last_user_text
      UNION SELECT 'Пока'
      UNION SELECT 'но есть нюанс, боты заебали'
    ) t
  `);
  console.log('regex_samples', samples);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
echo "--- recent heal ---"
grep -aE 'silence-heal|healed |silence-heal fail' /root/.pm2/logs/tgbot-out.log | tail -20
grep -aE 'silence-heal fail|Connection error' /root/.pm2/logs/tgbot-error.log | tail -10
