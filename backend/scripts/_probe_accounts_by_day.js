const db = require('../db');

(async () => {
  const [rows] = await db.execute(`
    SELECT DATE(created_at) AS d,
           COUNT(*) AS n,
           GROUP_CONCAT(phone ORDER BY id SEPARATOR ', ') AS phones
    FROM accounts
    GROUP BY DATE(created_at)
    ORDER BY d DESC
    LIMIT 25
  `);
  for (const r of rows) {
    console.log(`${r.d}  x${r.n}  ${r.phones}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
