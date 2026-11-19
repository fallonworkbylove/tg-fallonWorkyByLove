#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [asks] = await db.execute(
    `SELECT account_id, peer_id, peer_username, content, created_at
     FROM conversation_messages
     WHERE role = 'assistant'
       AND (content LIKE '%на дв?%' OR content LIKE '%давно тут сидишь%')
       AND created_at > NOW() - INTERVAL 7 DAY
     ORDER BY created_at DESC
     LIMIT 40`,
  );
  console.log('asks_7d', asks.length);
  console.log(asks.slice(0, 15));

  const [asksToday] = await db.execute(
    `SELECT COUNT(*) n FROM conversation_messages
     WHERE role='assistant'
       AND (content LIKE '%на дв?%' OR content LIKE '%давно тут сидишь%')
       AND created_at > CURDATE()`,
  );
  console.log('asks_today', asksToday[0]);

  // sample parse: user msgs right after howlong asks — hard; instead count archive log via admin if any
  const [arch] = await db.execute(
    `SELECT COUNT(*) n FROM archived_peers WHERE archived_at > NOW() - INTERVAL 7 DAY`,
  ).catch(() => [[{ n: '?' }]]);
  console.log('archived_peers_7d', arch[0]);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
