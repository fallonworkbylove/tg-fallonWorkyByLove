#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const db = require('../db');
(async () => {
  const [[acc]] = await db.execute(
    `SELECT id, phone, name, is_autoreply_enabled,
            session_string IS NOT NULL AND session_string!='' AS has_sess
     FROM accounts WHERE id=31`,
  ).catch(async () => {
    const [r] = await db.execute(`SELECT id, phone, is_autoreply_enabled,
      session_string IS NOT NULL AND session_string!='' AS has_sess FROM accounts WHERE id=31`);
    return r;
  });
  console.log('account', acc);

  const [gaps] = await db.execute(
    `SELECT cm.peer_id, LEFT(cm.content,80) c,
            TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m, cm.created_at
     FROM conversation_messages cm
     WHERE cm.account_id=31 AND cm.role='user'
       AND cm.created_at > NOW()-INTERVAL 6 HOUR
       AND NOT EXISTS (
         SELECT 1 FROM conversation_messages x
         WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id
           AND x.role='assistant' AND x.id>cm.id
       )
       AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
       AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
     ORDER BY cm.created_at ASC LIMIT 20`,
  );
  console.log('open_gaps', gaps);

  const [tail] = await db.execute(
    `SELECT peer_id, role, LEFT(content,90) c, created_at
     FROM conversation_messages WHERE account_id=31
       AND created_at > NOW()-INTERVAL 90 MINUTE
     ORDER BY id DESC LIMIT 30`,
  );
  console.log('tail90', tail);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
