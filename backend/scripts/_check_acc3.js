require('dotenv').config();
const db = require('../db');

(async () => {
  const [[r]] = await db.execute(
    `SELECT id, phone, status, is_autoreply_enabled,
            CHAR_LENGTH(session_string) AS sess_len,
            LEFT(session_string, 24) AS sess_head
     FROM accounts WHERE id = 3`,
  );
  console.log(r);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
