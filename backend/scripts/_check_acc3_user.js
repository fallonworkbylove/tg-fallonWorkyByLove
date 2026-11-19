require('dotenv').config();
const db = require('../db');

(async () => {
  const [rows] = await db.execute(
    `SELECT a.id, a.phone, a.user_id, u.is_blocked
     FROM accounts a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.id = 3`,
  );
  console.log(rows[0]);
  const [all] = await db.execute(
    `SELECT a.id, a.phone, a.user_id, COALESCE(u.is_blocked, -1) AS blocked
     FROM accounts a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.session_string IS NOT NULL AND a.session_string != ''
     ORDER BY a.id`,
  );
  for (const r of all) {
    console.log(`id=${r.id} phone=${r.phone} user=${r.user_id} blocked=${r.blocked}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
