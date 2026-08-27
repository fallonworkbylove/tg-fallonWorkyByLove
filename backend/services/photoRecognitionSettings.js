const db = require('../db');

// ---------------------------------------------------------------------------
// СПИСОК ЧАТОВ С ОТКЛЮЧЁННЫМ РАСПОЗНАВАНИЕМ ФОТО.
//
// Список общий для ВСЕХ Telegram-сессий (аккаунтов) одного пользователя
// панели: если чат (по User ID или @username собеседника) добавлен сюда,
// ни один из аккаунтов не будет отправлять его фото в vision-модель —
// сообщение просто пройдёт как текст (подпись) или будет проигнорировано,
// как обычное фото без описания.
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
 * (по numeric peerId ИЛИ по username) для ВСЕХ сессий владельца аккаунта.
 */
async function isPhotoRecognitionDisabled(accountId, peerId, username) {
  try {
    const userId = await getUserIdForAccount(accountId);
    if (!userId) return false;

    const peerIdentifier = normalizeIdentifier(peerId);
    const usernameIdentifier = username ? normalizeIdentifier(username) : peerIdentifier;

    const [rows] = await db.execute(
      `SELECT id FROM photo_recognition_disabled_chats
       WHERE user_id = ? AND chat_identifier IN (?, ?)
       LIMIT 1`,
      [userId, peerIdentifier, usernameIdentifier],
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
