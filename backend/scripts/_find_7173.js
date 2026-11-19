require('dotenv').config();
const db = require('../db');

(async () => {
  const [all] = await db.query(
    `SELECT id, user_id, phone, LENGTH(session_string) AS sess_len,
            LEFT(COALESCE(prompt,''), 40) AS prompt, status, is_autoreply_enabled
     FROM accounts ORDER BY id DESC LIMIT 40`,
  );
  console.log(JSON.stringify(all, null, 2));
  const hit = all.filter((a) => String(a.phone || '').includes('7173'));
  console.log('hit7173', hit.length, hit);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
