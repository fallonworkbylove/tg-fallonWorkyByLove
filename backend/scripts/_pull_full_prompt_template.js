require('dotenv').config();
const db = require('../db');

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, CHAR_LENGTH(prompt) plen, prompt
     FROM accounts WHERE id IN (3, 24, 27, 30, 36)
     ORDER BY id`,
  );
  for (const r of rows) {
    console.log(`\n===== id=${r.id} phone=${r.phone} len=${r.plen} =====`);
    console.log(r.prompt);
    console.log('===== END =====');
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
