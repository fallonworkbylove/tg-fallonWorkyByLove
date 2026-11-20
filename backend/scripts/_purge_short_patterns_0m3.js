#!/usr/bin/env node
/** Purge ultra-short / kaif-stub patterns from bot_patterns (live DB). */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const db = require('../db');

(async () => {
  const [[before]] = await db.execute(
    `SELECT COUNT(*) AS c FROM bot_patterns
     WHERE CHAR_LENGTH(TRIM(bot_reply)) <= 8
        OR TRIM(bot_reply) REGEXP '^(ну[[:space:]]+)?(кайф|хм|мм|аа|угу|ага|ок)\\)?[.!]*$'`,
  );
  const [del] = await db.execute(
    `DELETE FROM bot_patterns
     WHERE CHAR_LENGTH(TRIM(bot_reply)) <= 8
        OR TRIM(bot_reply) REGEXP '^(ну[[:space:]]+)?(кайф|хм|мм|аа|угу|ага|ок)\\)?[.!]*$'`,
  );
  console.log(JSON.stringify({ short_before: Number(before.c) || 0, deleted: del.affectedRows || 0 }));
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
