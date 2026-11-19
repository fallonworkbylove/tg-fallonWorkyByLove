require('dotenv').config();
const db = require('../db');
(async () => {
  const [r] = await db.execute(
    `SELECT id, phone, status, user_id, updated_at,
            CASE WHEN session_string IS NULL OR session_string='' THEN 0 ELSE 1 END AS has_session
     FROM accounts
     WHERE phone LIKE ? OR phone LIKE ? OR phone LIKE ?`,
    ['%244855206%', '%9779994852%', '%9244855206%'],
  );
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
