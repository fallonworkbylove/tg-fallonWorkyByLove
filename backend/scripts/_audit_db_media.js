require('dotenv').config();
const db = require('../db');

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, is_autoreply_enabled,
            LEFT(IFNULL(media_chat_link, ''), 90) AS link
     FROM accounts
     WHERE IFNULL(media_chat_link, '') != ''
     ORDER BY id`,
  );
  for (const r of rows) {
    console.log(`${r.id}\t${r.phone}\ton=${r.is_autoreply_enabled}\t${r.link}`);
  }
  const [[a2]] = await db.execute(
    `SELECT id, phone, is_autoreply_enabled FROM accounts WHERE id = 2`,
  );
  console.log('account2:', a2);
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
