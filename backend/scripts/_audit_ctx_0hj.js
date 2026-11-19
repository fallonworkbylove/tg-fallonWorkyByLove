#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

async function dump(label, accountId, peerId) {
  const [rows] = await db.query(
    `SELECT role, LEFT(content,140) c, created_at FROM conversation_messages
     WHERE account_id=? AND peer_id=? ORDER BY id DESC LIMIT 10`,
    [accountId, peerId],
  );
  console.log('---', label, '---');
  console.log(JSON.stringify(rows, null, 2));
}

(async () => {
  await dump('stub ekaterina', 8, '825977620');
  await dump('stub liza ok', 36, '6005022669');
  await dump('video life', 27, '6868829215');
  await dump('voice gap liza', 36, '5173080926');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
