#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [accCols] = await db.execute(`SHOW COLUMNS FROM accounts`);
  console.log(
    'ACC_COLS',
    accCols.map((c) => c.Field).join(','),
  );
  const [userCols] = await db.execute(`SHOW COLUMNS FROM users`);
  console.log(
    'USER_COLS',
    userCols.map((c) => c.Field).join(','),
  );

  const [matches] = await db.execute(
    `SELECT a.*
     FROM accounts a
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(a.phone,' ',''),'-',''),'(',''),')','') LIKE ?
        OR REPLACE(REPLACE(REPLACE(REPLACE(a.phone,' ',''),'-',''),'(',''),')','') LIKE ?
     ORDER BY a.id`,
    ['%9601878670%', '%79601878670%'],
  );
  console.log('TARGET', JSON.stringify(matches, null, 2));

  const [samples] = await db.execute(
    `SELECT a.id, a.phone, a.user_id, CHAR_LENGTH(IFNULL(a.prompt,'')) AS plen,
            LEFT(IFNULL(a.prompt,''), 180) AS head
     FROM accounts a
     WHERE a.prompt IS NOT NULL AND CHAR_LENGTH(a.prompt) > 200
     ORDER BY CHAR_LENGTH(a.prompt) DESC
     LIMIT 6`,
  );
  console.log('SAMPLES', JSON.stringify(samples, null, 2));

  if (samples[0]) {
    const [[full]] = await db.execute(
      `SELECT id, phone, user_id, prompt FROM accounts WHERE id = ? LIMIT 1`,
      [samples[0].id],
    );
    console.log('FULL_TEMPLATE_ID', full.id, full.phone, 'user', full.user_id);
    console.log('---PROMPT START---');
    console.log(full.prompt);
    console.log('---PROMPT END---');
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
