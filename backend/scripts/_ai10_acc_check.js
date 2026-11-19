require('dotenv').config({ quiet: true });
const db = require('../db');
(async () => {
  const [r] = await db.execute(
    `SELECT id, is_autoreply_enabled ai, LEFT(phone,10) phone,
            LENGTH(IFNULL(session_string,'')) sess,
            LEFT(IFNULL(prompt,''),50) prompt
     FROM accounts WHERE id IN (8,41,23,36,42,43)`,
  );
  console.log(r);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
