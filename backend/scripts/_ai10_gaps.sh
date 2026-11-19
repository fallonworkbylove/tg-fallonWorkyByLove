#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node - <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [gap] = await db.execute(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,100) c, cm.created_at,
           TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_min
    FROM conversation_messages cm
    JOIN accounts a ON a.id = cm.account_id
    WHERE cm.role = 'user'
      AND cm.created_at > NOW() - INTERVAL 3 HOUR
      AND a.is_autoreply_enabled = 1
      AND IFNULL(a.prompt, '') != ''
      AND a.session_string IS NOT NULL AND a.session_string != ''
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
    ORDER BY cm.created_at ASC
    LIMIT 40
  `);
  console.log('GAPS', gap.length);
  for (const g of gap) {
    console.log(`acc${g.account_id} peer=${g.peer_id} age=${g.age_min}m :: ${String(g.c).replace(/\\n/g,' ')}`);
  }
  const [stubs] = await db.execute(`
    SELECT account_id, content, created_at
    FROM conversation_messages
    WHERE role='assistant' AND created_at >= '2026-11-04 17:00:00'
      AND TRIM(content) IN ('ага','ага)','угу','угу)','ок','ок)','ну да)','ну да','ладно','ладно)')
    ORDER BY id DESC LIMIT 20
  `);
  console.log('STUBS_SINCE_17UTC', stubs.length);
  for (const s of stubs) console.log(String(s.created_at), 'acc'+s.account_id, JSON.stringify(s.content));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
NODE
