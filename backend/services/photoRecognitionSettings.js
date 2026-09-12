const db = require('../db');

// ---------------------------------------------------------------------------
// СПИСОК ПОЛЬЗОВАТЕЛЕЙ С ОТКЛЮЧЁННЫМ РАСПОЗНАВАНИЕМ ФОТО.
//
// Список общий для ВСЕХ Telegram-сессий (аккаунтов) одного пользователя
// панели: если собеседник добавлен сюда по его @username, ни один из
// аккаунтов не будет отправлять его фото в vision-модель — сообщение
// просто пройдёт как текст (подпись) или будет проигнорировано, как
// обычное фото без описания. Определение строго по username: у
// собеседников без username распознавание фото заблокировать нельзя.
// ---------------------------------------------------------------------------

/**
 * Создаёт таблицу, если её ещё нет (аналогично bootstrap для сессий —
 * никаких отдельных миграций в проекте нет, схема поднимается лениво).
 */
async function ensureSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS photo_recognition_disabled_chats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      chat_identifier VARCHAR(64) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_chat (user_id, chat_identifier)
    )
  `);
}

/**
 * Приводит ввод к единому виду для сравнения: убирает "@", пробелы,
 * регистр — так "@Ivan", "ivan", " Ivan " считаются одним и тем же.
 */
function normalizeIdentifier(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

async function getUserIdForAccount(accountId) {
  const [[row]] = await db.execute(
    'SELECT user_id FROM accounts WHERE id = ? LIMIT 1',
    [accountId],
  );
  return row ? row.user_id : null;
}

/**
 * Проверяет, отключено ли распознавание фото для этого собеседника
 * ПО USERNAME (без @, без учёта регистра) для ВСЕХ сессий владельца аккаунта.
 * Если у собеседника нет username — считаем, что он не может быть добавлен
 * в список, и распознавание не блокируется.
 */
async function isPhotoRecognitionDisabled(accountId, peerId, username) {
  try {
    if (!username) return false;

    const userId = await getUserIdForAccount(accountId);
    if (!userId) return false;

    const usernameIdentifier = normalizeIdentifier(username);
    if (!usernameIdentifier) return false;

    const [rows] = await db.execute(
      `SELECT id FROM photo_recognition_disabled_chats
       WHERE user_id = ? AND chat_identifier = ?
       LIMIT 1`,
      [userId, usernameIdentifier],
    );
    return rows.length > 0;
  } catch (err) {
    console.error(
      'Ошибка проверки списка отключённого распознавания фото:',
      err.message,
    );
    // При сбое проверки не блокируем работу бота — просто распознаём как обычно.
    return false;
  }
}

module.exports = { ensureSchema, isPhotoRecognitionDisabled, normalizeIdentifier };
