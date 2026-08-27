const db = require('../db');
const { activateAccount } = require('./telegramClient');

/**
 * При старте сервера поднимает все аккаунты со статусом "Подключен",
 * у которых есть сохранённая session_string.
 */
async function bootstrapSessions() {
  try {
    const [rows] = await db.execute(
      `SELECT id, phone, session_string
      FROM accounts
      WHERE session_string IS NOT NULL AND session_string != ''`,
    );

    if (rows.length === 0) {
      console.log('Активных сессий для восстановления нет.');
      return;
    }

    console.log(`Восстанавливаю ${rows.length} сессий...`);

    for (const account of rows) {
      const ok = await activateAccount(account.id, account.session_string);
      console.log(
        `  Аккаунт ${account.phone} (id=${account.id}): ${ok ? 'активирован' : 'ошибка'}`,
      );
    }

    console.log('Восстановление сессий завершено.');
  } catch (err) {
    console.error('Ошибка восстановления сессий:', err.message);
  }
}

module.exports = { bootstrapSessions };