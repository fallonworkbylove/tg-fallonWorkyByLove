require('dotenv').config({ quiet: true });
const db = require('../db');

(async () => {
  const [gap] = await db.execute(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,90) c, cm.created_at, a.phone
    FROM conversation_messages cm
    JOIN accounts a ON a.id = cm.account_id
    WHERE cm.role = 'user'
      AND cm.created_at > NOW() - INTERVAL 3 HOUR
      AND a.is_autoreply_enabled = 1
      AND IFNULL(a.prompt, '') != ''
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages x
        WHERE x.account_id = cm.account_id AND x.peer_id = cm.peer_id
          AND x.role = 'assistant' AND x.id > cm.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM autoreply_disabled_peers ad
        WHERE ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM archived_peers ap
        WHERE ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
      )
    ORDER BY cm.id DESC
    LIMIT 30
  `);
  console.log('=== unanswered (AI on, not paused) ===', gap.length);
  for (const r of gap) {
    console.log(String(r.created_at), 'acc' + r.account_id, r.phone, r.peer_id, r.c);
  }

  const [leaksSent] = await db.execute(`
    SELECT account_id, peer_id, LEFT(content,140) c, created_at
    FROM conversation_messages
    WHERE role = 'assistant'
      AND created_at > NOW() - INTERVAL 24 HOUR
      AND (
        content REGEXP '\\\\{фото:|\\\\{кружок:|\\\\{видео:'
        OR content LIKE '%[отправила %'
        OR content LIKE '%[медиа:#%]%{%'
      )
      AND content NOT LIKE '[медиа:#%'
    ORDER BY id DESC
    LIMIT 20
  `);
  console.log('=== possible text leaks (not media marker alone) ===', leaksSent.length);
  for (const r of leaksSent) {
    console.log(String(r.created_at), 'acc' + r.account_id, r.c);
  }

  const [weak] = await db.execute(`
    SELECT account_id, peer_id, content, created_at
    FROM conversation_messages
    WHERE role = 'assistant'
      AND created_at > NOW() - INTERVAL 6 HOUR
      AND CHAR_LENGTH(TRIM(content)) BETWEEN 1 AND 8
      AND content NOT REGEXP '[❤😁☺️😊🥰🔥👍]'
      AND content NOT LIKE '[медиа:%'
      AND content NOT LIKE '[голосовое:%'
    ORDER BY id DESC
    LIMIT 25
  `);
  console.log('=== weak short replies ===', weak.length);
  for (const r of weak) {
    console.log(String(r.created_at), 'acc' + r.account_id, JSON.stringify(r.content));
  }

  const [robot] = await db.execute(`
    SELECT account_id, peer_id, LEFT(content,120) c, created_at
    FROM conversation_messages
    WHERE role = 'assistant'
      AND created_at > NOW() - INTERVAL 12 HOUR
      AND (
        content LIKE '%чем могу помочь%'
        OR content LIKE '%зависит от восприятия%'
        OR content LIKE '%остаётся ждать%'
        OR content LIKE '%продолжим общение%'
        OR content LIKE '%всегда рада общению%'
        OR content LIKE '%[отправила%'
        OR content REGEXP 'для вас|для тех, кто'
      )
    ORDER BY id DESC
    LIMIT 15
  `);
  console.log('=== robotic phrases ===', robot.length);
  for (const r of robot) {
    console.log(String(r.created_at), 'acc' + r.account_id, r.c);
  }

  const [[online]] = await db.execute(`
    SELECT COUNT(*) c FROM accounts WHERE is_autoreply_enabled = 1 AND session_string IS NOT NULL AND session_string != ''
  `);
  console.log('ai_enabled_with_session', online.c);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
