require('dotenv').config();
const db = require('../db');

(async () => {
  const [cols] = await db.execute('SHOW COLUMNS FROM accounts');
  const names = cols.map((c) => c.Field);
  console.log(
    'cols:',
    names.filter((n) => /media|phone|id|prompt|link/i.test(n)).join(', '),
  );
  const [rows] = await db.execute(
    `SELECT id, phone, media_chat_link
     FROM accounts
     WHERE phone LIKE '%9324437506%' OR id = 28
     LIMIT 5`,
  );
  console.log(JSON.stringify(rows, null, 2));

  // count media cache if any
  try {
    const [m] = await db.execute(
      `SHOW TABLES LIKE 'media%'`,
    );
    console.log('media tables', m);
  } catch (_) {}

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
