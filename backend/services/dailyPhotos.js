const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getActiveClient } = require('./telegramClient');

// Разрешённые расширения для готовых фото.
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Окно отправки: каждому написавшему за день собеседнику уходит 1 фото
// в случайный момент внутри этого диапазона (часы, 24ч формат).
const WINDOW_START_HOUR = 13;
const WINDOW_END_HOUR = 20;

// Случайная подпись к фото — придаёт сообщению живой, неформальный тон.
const CAPTIONS = [
  'сегодня повезло 😊',
  'вот так бы всегда 🥹',
  'работает же, хаха',
  'на ужин заработала 👍',
  'неожиданно, приятно 🙃',
];

function pickRandomCaption() {
  return CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)];
}

let schemaReady = false;

/**
 * Создаёт таблицу учёта ежедневных рассылок фото, если её ещё нет.
 * account_id + peer_id + send_date — уникальны, чтобы не запланировать
 * повторную отправку одному собеседнику в тот же день.
 */
async function ensureSchema() {
  if (schemaReady) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS daily_photo_sends (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      peer_username VARCHAR(255) NULL,
      send_date DATE NOT NULL,
      scheduled_at DATETIME NOT NULL,
      sent_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_account_peer_date (account_id, peer_id, send_date)
    )
  `);

  schemaReady = true;
}

/**
 * Возвращает все настроенные папки с готовыми фото. Все наборы аккаунтов
 * синхронизированы — фото берутся из общего пула (IMAGES_FOLDER +
 * IMAGES_FOLDER_2), независимо от того, к какому набору принадлежит аккаунт.
 */
function getImagesFolders() {
  return [process.env.IMAGES_FOLDER, process.env.IMAGES_FOLDER_2]
    .filter((folder) => folder && folder.trim())
    .map((folder) => folder.trim());
}

/**
 * Выбирает случайное фото из объединённого пула всех настроенных папок.
 * Возвращает полный путь или null, если ни одна папка не существует / не
 * содержит подходящих файлов.
 */
function pickRandomImage(folders) {
  const allFiles = [];

  for (const folder of folders) {
    try {
      if (!fs.existsSync(folder)) continue;

      const files = fs
        .readdirSync(folder)
        .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .map((name) => path.join(folder, name));

      allFiles.push(...files);
    } catch (err) {
      console.error(`Не удалось прочитать папку с фото (${folder}):`, err.message);
    }
  }

  if (allFiles.length === 0) return null;

  return allFiles[Math.floor(Math.random() * allFiles.length)];
}

/**
 * Возвращает случайную дату-время в диапазоне [from, to] (объекты Date).
 */
function randomTimeBetween(from, to) {
  if (from >= to) return from;
  const time = from.getTime() + Math.random() * (to.getTime() - from.getTime());
  return new Date(time);
}

/**
 * Находит всех собеседников, которые сегодня писали хотя бы одно сообщение
 * (по всем аккаунтам), и планирует каждому из них ровно одну отправку фото
 * на случайное время внутри окна 13:00–20:00 (если ещё не запланировано).
 */
async function schedulePendingSends() {
  await ensureSchema();

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setHours(WINDOW_END_HOUR, 0, 0, 0);

  // Окно на сегодня уже закрылось — новых отправок на сегодня не планируем.
  if (now >= windowEnd) return;

  const windowStart = new Date(now);
  windowStart.setHours(WINDOW_START_HOUR, 0, 0, 0);

  // Нижняя граница случайного времени: не раньше начала окна и не раньше «сейчас».
  const lowerBound = now > windowStart ? now : windowStart;

  // Фото отправляем только начиная со 2-го дня знакомства: собеседник должен
  // писать сегодня, но переписка с ним должна быть начата не сегодня.
  const [writers] = await db.execute(`
    SELECT DISTINCT cm.account_id, cm.peer_id, cm.peer_username
    FROM conversation_messages cm
    WHERE cm.role = 'user' AND DATE(cm.created_at) = CURDATE()
      AND EXISTS (
        SELECT 1 FROM conversation_messages cm2
        WHERE cm2.account_id = cm.account_id
          AND cm2.peer_id = cm.peer_id
          AND DATE(cm2.created_at) < CURDATE()
      )
  `);

  for (const writer of writers) {
    const scheduledAt = randomTimeBetween(lowerBound, windowEnd);

    try {
      await db.execute(
        `INSERT IGNORE INTO daily_photo_sends
           (account_id, peer_id, peer_username, send_date, scheduled_at)
         VALUES (?, ?, ?, CURDATE(), ?)`,
        [writer.account_id, writer.peer_id, writer.peer_username, scheduledAt],
      );
    } catch (err) {
      console.error(
        `Не удалось запланировать фото для ${writer.peer_username || writer.peer_id}:`,
        err.message,
      );
    }
  }
}

/**
 * Отправляет все фото, для которых наступило запланированное время
 * и они ещё не были отправлены.
 */
async function sendDuePhotos() {
  await ensureSchema();

  const [due] = await db.execute(`
    SELECT id, account_id, peer_id, peer_username
    FROM daily_photo_sends
    WHERE send_date = CURDATE() AND sent_at IS NULL AND scheduled_at <= NOW()
  `);

  for (const row of due) {
    try {
      const client = getActiveClient(row.account_id);
      if (!client) {
        console.error(
          `[Аккаунт ${row.account_id}] Нет активного клиента — фото для ${row.peer_username || row.peer_id} отложено.`,
        );
        continue;
      }

      const folders = getImagesFolders();
      if (folders.length === 0) {
        console.error('Не настроена ни одна папка с готовыми фото (IMAGES_FOLDER / IMAGES_FOLDER_2).');
        continue;
      }

      const imagePath = pickRandomImage(folders);
      if (!imagePath) {
        console.error(`[Аккаунт ${row.account_id}] В папке с фото нет доступных файлов.`);
        continue;
      }

      await client.sendFile(row.peer_id, { file: imagePath, caption: pickRandomCaption() });

      await db.execute(
        'UPDATE daily_photo_sends SET sent_at = NOW() WHERE id = ?',
        [row.id],
      );

      console.log(
        `[Аккаунт ${row.account_id}] Отправлено ежедневное фото ${row.peer_username || row.peer_id}.`,
      );
    } catch (err) {
      console.error(
        `[Аккаунт ${row.account_id}] Ошибка отправки ежедневного фото ${row.peer_username || row.peer_id}:`,
        err.message,
      );
    }
  }
}

let schedulerStarted = false;

/**
 * Запускает фоновый планировщик: каждую минуту проверяет новых написавших
 * сегодня собеседников (планирует им случайное время в окне 13:00–20:00)
 * и отправляет тем, у кого это время уже наступило.
 */
function startDailyPhotoScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    try {
      await schedulePendingSends();
      await sendDuePhotos();
    } catch (err) {
      console.error('Ошибка планировщика ежедневных фото:', err.message);
    }
  };

  tick();
  setInterval(tick, 60 * 1000);
}

module.exports = {
  ensureSchema,
  startDailyPhotoScheduler,
};
