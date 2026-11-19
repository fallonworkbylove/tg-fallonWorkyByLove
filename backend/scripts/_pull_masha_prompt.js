const db = require('../db');

(async () => {
  const { rows } = await db.query(`
    SELECT id,
           COALESCE(display_name, username, phone::text) AS n,
           system_prompt AS p
    FROM accounts
    WHERE id = 29
       OR system_prompt ILIKE '%Анапа%'
       OR system_prompt ILIKE '%Маша%'
       OR COALESCE(display_name,'') ILIKE '%маш%'
    ORDER BY id
    LIMIT 10
  `);
  for (const x of rows) {
    console.log('====', x.id, x.n);
    console.log(String(x.p || '').slice(0, 2000));
    console.log('');
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
