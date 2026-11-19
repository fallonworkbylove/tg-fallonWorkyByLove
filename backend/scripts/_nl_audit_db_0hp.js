#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const db = require('../db');

(async () => {
  const [[acc]] = await db.execute(`
    SELECT COUNT(*) total,
      SUM(is_autoreply_enabled=1) ai_on,
      SUM(session_string IS NOT NULL AND session_string!='') with_session,
      SUM(is_autoreply_enabled=1 AND session_string IS NOT NULL AND session_string!='') ai_sess
    FROM accounts`);
  const [[arch]] = await db.execute(`SELECT COUNT(*) c FROM archived_peers`);
  let arOff = 0;
  try {
    const [[r]] = await db.execute(`SELECT COUNT(*) c FROM autoreply_disabled_peers`);
    arOff = Number(r.c);
  } catch (_) {
    try {
      const [[r]] = await db.execute(
        `SELECT COUNT(*) c FROM dialog_state WHERE autoreply_disabled=1`,
      );
      arOff = Number(r.c);
    } catch (_) {}
  }
  const [[vol]] = await db.execute(`
    SELECT
      SUM(role='assistant' AND created_at > NOW()-INTERVAL 24 HOUR) asst_24h,
      SUM(role='user' AND created_at > NOW()-INTERVAL 24 HOUR) user_24h,
      SUM(role='assistant' AND created_at > NOW()-INTERVAL 2 HOUR) asst_2h
    FROM conversation_messages`);
  const [typos] = await db.execute(`
    SELECT account_id, peer_id, LEFT(content,80) c, created_at
    FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 24 HOUR
      AND (content LIKE '%поддеож%' OR content LIKE '%звкчит%' OR TRIM(content)=')')
    ORDER BY id DESC LIMIT 10`);
  const [stubs] = await db.execute(`
    SELECT COUNT(*) c FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 24 HOUR
      AND TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','круто','ну да)','хм ок','хм ок)','ладно')`);
  const [leaks] = await db.execute(`
    SELECT COUNT(*) c FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 7 DAY
      AND (content LIKE '%[отправила %' OR content REGEXP '\\\\{фото:|\\\\{кружок:')
      AND content NOT LIKE '[медиа:%'`);
  const [stale] = await db.execute(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,50) c,
           TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm
    JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user'
      AND cm.created_at < NOW() - INTERVAL 20 MINUTE
      AND cm.created_at > NOW() - INTERVAL 6 HOUR
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
      AND a.session_string IS NOT NULL AND a.session_string!=''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
      AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
    ORDER BY cm.created_at ASC LIMIT 15`);
  console.log(
    JSON.stringify(
      {
        accounts: acc,
        archived: Number(arch.c),
        autoreply_off: arOff,
        volume: vol,
        stubs_24h: Number(stubs[0].c),
        leaks_7d: Number(leaks[0].c),
        stale_unanswered: stale.length,
        stale_sample: stale.slice(0, 5),
        typo_hits: typos,
      },
      null,
      2,
    ),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
