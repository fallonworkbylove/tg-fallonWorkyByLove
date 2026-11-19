/* Probe: is fallonsociapat recognized as admin? */
require('dotenv').config();
const db = require('../db');
const oa = require('../services/operatorAccess');

(async () => {
  console.log('ADMIN_ALERT_CHAT_ID=', process.env.ADMIN_ALERT_CHAT_ID || '(empty)');
  console.log('SUPER_ADMIN_ID=', oa.SUPER_ADMIN_ID || '(empty)');

  const [users] = await db.execute(
    `SELECT id, telegram_user_id, username
     FROM users
     WHERE LOWER(username) LIKE '%fallon%'
        OR LOWER(username) LIKE '%sociapat%'
     LIMIT 20`,
  );
  console.log('users:', JSON.stringify(users, null, 2));

  await oa.ensureSchema();
  const [ops] = await db.execute(
    `SELECT id, telegram_user_id, username, role, note
     FROM operator_roles
     ORDER BY role DESC, id ASC
     LIMIT 50`,
  );
  console.log('operator_roles:', JSON.stringify(ops, null, 2));

  for (const u of users) {
    const ok = await oa.isAdmin(u.telegram_user_id, u.username);
    console.log(
      `isAdmin(${u.telegram_user_id}, @${u.username}) =>`,
      ok,
      'super=',
      oa.isSuperAdmin(u.telegram_user_id),
    );
  }

  // Also try by username alone if no row
  const byName = await oa.isAdmin(null, 'fallonsociapat');
  console.log('isAdmin(null, fallonsociapat) =>', byName);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
