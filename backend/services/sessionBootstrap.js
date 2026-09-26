const db = require('../db');
const { activateAccount } = require('./telegramClient');

/**
 * При старте сервера поднимает все аккаунты со статусом "Подключен",
 * у которых есть сохранённая session_string.
 */
async function bootstrapSessions() {
  try {
    const [rows] = await db.execute(
      `SELECT a.id, a.phone, a.session_string
      FROM accounts a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.session_string IS NOT NULL AND a.session_string != ''
        AND COALESCE(u.is_blocked, 0) = 0`,
    );

    if (rows.length === 0) {
      console.log('Активных сессий для восстановления нет.');
      return;
    }

    console.log(`Восстанавливаю ${rows.length} сессий...`);

    for (const account of rows) {
      const result = await activateAccount(account.id, account.session_string);
      const status = result === true
        ? 'активирован'
        : result === 'revoked'
          ? 'сессия мертва, удалён из базы'
          : 'ошибка';
      console.log(`  Аккаунт ${account.phone} (id=${account.id}): ${status}`);
    }

    console.log('Восстановление сессий завершено.');
  } catch (err) {
    console.error('Ошибка восстановления сессий:', err.message);
  }
}

module.exports = { bootstrapSessions };