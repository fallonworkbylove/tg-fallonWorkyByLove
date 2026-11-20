#!/usr/bin/env node
/** Purge «отвлеклась» stub patterns from bot_patterns. */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const db = require('../db');

(async () => {
  const [[before]] = await db.execute(
    `SELECT COUNT(*) AS c FROM bot_patterns WHERE bot_reply LIKE '%отвлеклась%'`,
  );
  const [del] = await db.execute(
    `DELETE FROM bot_patterns WHERE bot_reply LIKE '%отвлеклась%' AND CHAR_LENGTH(TRIM(bot_reply)) <= 80`,
  );
  console.log(
    JSON.stringify({
      otv_before: Number(before.c) || 0,
      deleted: del.affectedRows || 0,
    }),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
