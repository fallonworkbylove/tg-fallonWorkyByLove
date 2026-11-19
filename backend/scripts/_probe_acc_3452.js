require('dotenv').config();
const db = require('../db');
(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, LEFT(prompt, 200) head, CHAR_LENGTH(prompt) plen
     FROM accounts WHERE phone LIKE '%3452' OR phone LIKE '%63452' OR id IN (
       SELECT id FROM accounts WHERE phone LIKE '%3452%'
     ) LIMIT 10`,
  );
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
