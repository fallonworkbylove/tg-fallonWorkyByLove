require('dotenv').config();
const db = require('../db');

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, status, is_autoreply_enabled,
            CASE WHEN session_string IS NULL OR session_string = '' THEN 0 ELSE 1 END AS has_session
     FROM accounts
     ORDER BY id`,
  );
  console.log('db_accounts', rows.length);
  for (const r of rows) {
    console.log(
      [r.id, r.phone, r.status, `ai=${r.is_autoreply_enabled}`, `sess=${r.has_session}`].join(
        ' | ',
      ),
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
