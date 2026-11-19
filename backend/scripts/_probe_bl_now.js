require('dotenv').config();
const db = require('../db');

(async () => {
  const [bl] = await db.execute(
    `SELECT b.id, b.user_telegram_id AS peer, b.user_id, u.username AS owner
     FROM blacklist b LEFT JOIN users u ON u.id = b.user_id
     ORDER BY b.id DESC LIMIT 30`,
  );
  console.log('PEER_BLACKLIST', JSON.stringify(bl, null, 2));

  const [blocked] = await db.execute(
    `SELECT id, telegram_user_id, username, first_name, is_blocked
     FROM users WHERE is_blocked = 1 ORDER BY username`,
  );
  console.log('WORKER_BLOCKED', JSON.stringify(blocked, null, 2));

  const [named] = await db.execute(
    `SELECT id, telegram_user_id, username, first_name, is_blocked
     FROM users
     WHERE LOWER(username) IN ('sicretsolo','wiolova','fallonsociapat','demo')
        OR telegram_user_id IN (1008886229, 123456789)`,
  );
  console.log('NAMED', JSON.stringify(named, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
