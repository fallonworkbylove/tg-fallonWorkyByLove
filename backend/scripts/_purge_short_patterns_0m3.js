#!/usr/bin/env node
/** Purge ultra-short / stub patterns from bot_patterns (live DB). MySQL-safe. */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const db = require('../db');

(async () => {
  const [[before]] = await db.execute(
    `SELECT COUNT(*) AS c FROM bot_patterns WHERE CHAR_LENGTH(TRIM(bot_reply)) <= 8`,
  );
  const [delLen] = await db.execute(
    `DELETE FROM bot_patterns WHERE CHAR_LENGTH(TRIM(bot_reply)) <= 8`,
  );
  const stubs = ['кайф)', 'кайф', 'хм)', 'мм)', 'аа)', 'угу)', 'ага)', 'ок)', 'ну ок)', 'ну ок'];
  let delStub = 0;
  for (const s of stubs) {
    const [r] = await db.execute(
      `DELETE FROM bot_patterns WHERE TRIM(bot_reply) = ? OR LOWER(TRIM(bot_reply)) = ?`,
      [s, s.toLowerCase()],
    );
    delStub += r.affectedRows || 0;
  }
  console.log(
    JSON.stringify({
      short_before: Number(before.c) || 0,
      deleted_len: delLen.affectedRows || 0,
      deleted_stub: delStub,
    }),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
