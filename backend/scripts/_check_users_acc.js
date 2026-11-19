require('dotenv').config();
const db = require('../db');
(async () => {
  const [dev] = await db.execute(
    'SELECT id, telegram_user_id, username FROM users WHERE telegram_user_id = ?',
    [999999999],
  );
  console.log('dev', dev);
  if (dev[0]) {
    const [c] = await db.execute('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ?', [dev[0].id]);
    console.log('dev accounts', c[0]);
  }
  const [admin] = await db.execute(
    'SELECT id, telegram_user_id, username FROM users WHERE telegram_user_id = ?',
    [8588744561],
  );
  console.log('admin', admin);
  if (admin[0]) {
    const [c] = await db.execute('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ?', [
      admin[0].id,
    ]);
    console.log('admin accounts', c[0]);
  }
  const [[t]] = await db.execute('SELECT COUNT(*) AS c FROM accounts');
  console.log('total accounts', t);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
