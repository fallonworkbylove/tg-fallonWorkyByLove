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
  // Gate shipped ~2026-10-31 19:00 UTC (22:00 MSK)
  const since = '2026-10-31 19:00:00';
  const [early] = await db.query(
    `SELECT COUNT(*) n FROM (
       SELECT cm.account_id, cm.peer_id,
         MIN(CASE WHEN cm.role='user' THEN cm.created_at END) first_user,
         MIN(CASE WHEN cm.role='assistant' AND (cm.content LIKE '%флип%' OR cm.content LIKE '%токен%' OR cm.content LIKE '%NFT%') THEN cm.created_at END) first_flip
       FROM conversation_messages cm
       WHERE cm.created_at >= ?
       GROUP BY cm.account_id, cm.peer_id
       HAVING first_flip IS NOT NULL AND first_user IS NOT NULL
          AND TIMESTAMPDIFF(HOUR, first_user, first_flip) < 2
          AND first_flip >= ?
     ) t`,
    [since, since],
  );

  const [samples] = await db.query(
    `SELECT account_id, peer_id, first_user, first_flip, TIMESTAMPDIFF(MINUTE, first_user, first_flip) mins,
            LEFT(flip_text, 100) flip_text
     FROM (
       SELECT cm.account_id, cm.peer_id,
         MIN(CASE WHEN cm.role='user' THEN cm.created_at END) first_user,
         MIN(CASE WHEN cm.role='assistant' AND (cm.content LIKE '%флип%' OR cm.content LIKE '%токен%') THEN cm.created_at END) first_flip,
         SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN cm.role='assistant' AND (cm.content LIKE '%флип%' OR cm.content LIKE '%токен%') THEN cm.content END ORDER BY cm.created_at SEPARATOR '|||'), '|||', 1) flip_text
       FROM conversation_messages cm
       WHERE cm.created_at >= ?
       GROUP BY cm.account_id, cm.peer_id
       HAVING first_flip IS NOT NULL AND first_user IS NOT NULL
          AND TIMESTAMPDIFF(HOUR, first_user, first_flip) < 2
          AND first_flip >= ?
     ) t
     ORDER BY first_flip DESC LIMIT 12`,
    [since, since],
  );

  const [newPeers] = await db.query(
    `SELECT COUNT(DISTINCT peer_id) n FROM conversation_messages WHERE created_at >= ? AND role='user'`,
    [since],
  );

  console.log(JSON.stringify({ since, earlyPostGate: early[0].n, newPeers: newPeers[0].n, samples }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
