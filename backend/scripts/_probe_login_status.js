'use strict';
const db = require('../db');

(async () => {
  console.log('=== recent login-related accounts ===');
  const [rows] = await db.execute(
    `SELECT id, user_id, phone, status,
            CHAR_LENGTH(IFNULL(session_string,'')) AS slen,
            is_autoreply_enabled AS ai,
            LEFT(CAST(IFNULL(updated_at, created_at) AS CHAR), 19) AS upd
     FROM accounts
     ORDER BY id DESC
     LIMIT 15`,
  );
  console.table(rows);

  console.log('=== phone 9324436535 ===');
  const [hit] = await db.execute(
    `SELECT id, user_id, phone, status,
            CHAR_LENGTH(IFNULL(session_string,'')) AS slen
     FROM accounts
     WHERE phone LIKE '%9324436535%'
     LIMIT 5`,
  );
  console.log(hit);

  console.log('=== users with accounts ===');
  const [u] = await db.execute(
    `SELECT u.id, u.telegram_user_id, u.username, COUNT(a.id) AS n
     FROM users u
     LEFT JOIN accounts a ON a.user_id = u.id
     GROUP BY u.id
     HAVING n > 0
     ORDER BY n DESC
     LIMIT 10`,
  );
  console.table(u);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
