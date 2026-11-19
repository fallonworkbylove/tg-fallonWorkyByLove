#!/usr/bin/env node
const fs = require('fs');
for (const line of fs.readFileSync(require('path').join(__dirname, '../.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const db = require('../db');
(async () => {
  const [span] = await db.query(
    `SELECT COUNT(*) n, MIN(created_at) first_at, MAX(created_at) last_at
     FROM conversation_messages WHERE peer_username='suport_service_v'`,
  );
  console.log('SPAN', span[0]);

  const [byDay] = await db.query(
    `SELECT DATE(created_at) d, COUNT(*) n
     FROM conversation_messages WHERE peer_username='suport_service_v'
     GROUP BY DATE(created_at) ORDER BY d`,
  );
  console.log('BY_DAY', byDay);

  const [firstFlip] = await db.query(
    `SELECT account_id, peer_id, role, content, created_at,
            DATEDIFF(created_at, (SELECT MIN(created_at) FROM conversation_messages WHERE peer_username='suport_service_v')) AS day_index
     FROM conversation_messages
     WHERE peer_username='suport_service_v'
       AND role='assistant'
       AND (content LIKE '%флип%' OR content LIKE '%токен%' OR content LIKE '%NFT%' OR content LIKE '%нфт%')
     ORDER BY created_at ASC LIMIT 10`,
  );
  console.log('FIRST_FLIP_OUT', firstFlip);

  const [firstMsgs] = await db.query(
    `SELECT role, LEFT(content,100) c, created_at
     FROM conversation_messages WHERE peer_username='suport_service_v'
     ORDER BY created_at ASC LIMIT 12`,
  );
  console.log('FIRST_MSGS', firstMsgs);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
