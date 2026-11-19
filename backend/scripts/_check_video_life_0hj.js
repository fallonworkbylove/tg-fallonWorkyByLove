#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');
(async () => {
  const [r] = await db.query(
    `SELECT role, LEFT(content,140) c, created_at FROM conversation_messages
     WHERE account_id=27 AND peer_id='6868829215' ORDER BY id DESC LIMIT 8`,
  );
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
