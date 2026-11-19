require('dotenv').config();
const db = require('../db');

(async () => {
  const [[tz]] = await db.execute(
    'SELECT NOW() AS n, UTC_TIMESTAMP() AS u, @@session.time_zone AS tz, @@system_time_zone AS stz',
  );
  console.log('TZ', tz);

  const [blocked] = await db.execute(
    `SELECT id, telegram_user_id, username, first_name, is_blocked,
            (SELECT COUNT(*) FROM accounts a WHERE a.user_id = users.id) AS accounts
     FROM users WHERE is_blocked = 1`,
  );
  console.log('BLOCKED', blocked);

  const [wiolova] = await db.execute(
    `SELECT u.id, u.telegram_user_id, u.username, u.is_blocked, a.id AS acc_id, a.phone, a.status
     FROM users u
     LEFT JOIN accounts a ON a.user_id = u.id
     WHERE LOWER(u.username) LIKE '%wiolova%' OR a.phone LIKE '%79601878715%'`,
  );
  console.log('WIOLOVA', wiolova);

  const [blPeers] = await db.execute('SELECT * FROM blacklist ORDER BY id DESC LIMIT 20').catch(() => [[]]);
  console.log('PEER_BL', blPeers);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
