#!/usr/bin/env node
/** 0mr: purge vague / soft-yes / age platitude stubs from bot_patterns. */
require('dotenv').config({
  path: require('path').join(__dirname, '../.env'),
  quiet: true,
});
const db = require('../db');

const PATTERNS = [
  ['%бывает по-разному%', 90],
  ['%мелочи иногда%', 90],
  ['%что-то не так%', 60],
  ['%могу попробовать%', 80],
  ['%жизнь только начинается%', 120],
  ['%новый 20%', 80],
  ['%отвлеклась%', 80],
  ['%кофе пью%', 60],
  ['%ну такое)%', 40],
];

(async () => {
  const report = [];
  for (const [like, maxLen] of PATTERNS) {
    const [[before]] = await db.execute(
      `SELECT COUNT(*) AS c FROM bot_patterns
       WHERE bot_reply LIKE ? AND CHAR_LENGTH(TRIM(bot_reply)) <= ?`,
      [like, maxLen],
    );
    const [del] = await db.execute(
      `DELETE FROM bot_patterns
       WHERE bot_reply LIKE ? AND CHAR_LENGTH(TRIM(bot_reply)) <= ?`,
      [like, maxLen],
    );
    report.push({
      like,
      before: Number(before.c) || 0,
      deleted: del.affectedRows || 0,
    });
  }
  console.log(JSON.stringify({ ok: true, report }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
