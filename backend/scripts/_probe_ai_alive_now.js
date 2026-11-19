#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');
(async () => {
  const [recent] = await db.execute(
    `SELECT account_id, peer_username, role, LEFT(content,70) AS c, created_at
     FROM conversation_messages
     WHERE created_at > (NOW() - INTERVAL 20 MINUTE)
     ORDER BY created_at DESC LIMIT 30`,
  );
  console.log('msgs_20m', recent.length);
  console.log(recent);

  const [[a]] = await db.execute(
    `SELECT
       SUM(role='assistant' AND created_at > NOW() - INTERVAL 20 MINUTE) AS bot_20m,
       SUM(role='user' AND created_at > NOW() - INTERVAL 20 MINUTE) AS user_20m,
       SUM(role='assistant' AND created_at > NOW() - INTERVAL 5 MINUTE) AS bot_5m,
       SUM(role='user' AND created_at > NOW() - INTERVAL 5 MINUTE) AS user_5m
     FROM conversation_messages`,
  );
  console.log('counts', a);

  const [waiting] = await db.execute(
    `SELECT cm.account_id, cm.peer_id, MAX(cm.peer_username) AS u,
            MAX(CASE WHEN cm.role='user' THEN cm.created_at END) AS last_u,
            MAX(CASE WHEN cm.role='assistant' THEN cm.created_at END) AS last_b
     FROM conversation_messages cm
     LEFT JOIN autoreply_disabled_peers ad ON ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id
     WHERE ad.id IS NULL
     GROUP BY cm.account_id, cm.peer_id
     HAVING last_u IS NOT NULL AND last_u > NOW() - INTERVAL 30 MINUTE
       AND (last_b IS NULL OR last_b < last_u)
     ORDER BY last_u DESC LIMIT 15`,
  );
  console.log('waiting_unanswered', waiting.length);
  console.log(waiting);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
