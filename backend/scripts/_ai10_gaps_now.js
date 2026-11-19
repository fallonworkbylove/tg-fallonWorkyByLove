require('dotenv').config({ quiet: true });
const db = require('../db');

(async () => {
  const [gap] = await db.execute(`
    SELECT cm.account_id acc, cm.peer_id peer, LEFT(cm.content,80) c, cm.created_at,
           TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
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
    console.log(
      `acc${g.acc} peer=${g.peer} age=${g.age_m}m`,
      JSON.stringify(String(g.c || '').replace(/\s+/g, ' ').slice(0, 60)),
    );
  }

  const since = process.env.AUDIT_FIX_SINCE || '2026-10-27 15:24:00';
  const [stubs] = await db.execute(
    `
    SELECT account_id, content, created_at
    FROM conversation_messages
    WHERE role = 'assistant'
      AND created_at >= ?
      AND TRIM(content) IN (
        'а ещё)', 'а ещё', 'ой и ещё)', 'забыла сказать)', 'кстати да)',
        'ага', 'ага)', 'угу', 'угу)', 'ладно', 'ладно)',
        'ок', 'ок)', 'окей', 'окей)', 'круто', 'круто)',
        'здорово', 'здорово)', 'хм ок', 'хм ок)', 'ну да)', 'ну да'
      )
    ORDER BY id DESC
    LIMIT 30
  `,
    [since],
  );
  console.log('STUBS_SINCE', since, stubs.length);
  for (const s of stubs.slice(0, 15)) {
    console.log('STUB', String(s.created_at), 'acc' + s.account_id, JSON.stringify(s.content));
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
