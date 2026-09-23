const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  getActiveClient,
  isPeerArchived,
  isNeverContact,
  saveMessage,
  NFT_VOICE_AFTER_HOURS,
} = require('./telegramClient');
const helpRequestNotifier = require('./helpRequestNotifier');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Окно по Москве (не UTC сервера!): 13:00–15:00 МСК — строго до NFT 16:00–21:00 МСК.
const WINDOW_START_HOUR = 13;
const WINDOW_END_HOUR = 15;
const PHOTO_TIMEZONE = process.env.WORK_TIMEZONE || 'Europe/Moscow';
const NFT_VOICE_TAG = '[голосовое: nft.ogg]';

// Метка в истории диалога: модель должна понимать, что это наш скрин флипа,
// а не «фото от собеседника». objectionHandler ищет этот префикс.
const FLIP_PHOTO_HISTORY_TAG =
  '[фото от меня: скриншот прибыли с флиппинга NFT — купила дешевле, продала дороже]';

const CAPTIONS = [
  'сегодня повезло 😊',
  'вот так бы всегда 🥹',
  'работает же, хаха',
  'на ужин заработала 👍',
  'неожиданно, приятно 🙃',
];

function flipPhotoHistoryContent(caption) {
  const cap = String(caption || '').trim();
  return cap ? `${FLIP_PHOTO_HISTORY_TAG} Подпись: "${cap}"` : FLIP_PHOTO_HISTORY_TAG;
}

function pickRandomCaption() {
  return CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)];
}

let schemaReady = false;

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

function getImagesFolders() {
  return [process.env.IMAGES_FOLDER, process.env.IMAGES_FOLDER_2]
    .filter((folder) => folder && folder.trim())
    .map((folder) => folder.trim());
}

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
    } catch (_) {
      // папка недоступна — пропускаем
    }
  }

  if (allFiles.length === 0) return null;
  return allFiles[Math.floor(Math.random() * allFiles.length)];
}

/** Части даты/времени «сейчас» в PHOTO_TIMEZONE. */
function zonedNowParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: PHOTO_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * UTC-инстант, когда в PHOTO_TIMEZONE на часах y-m-d h:min:s.
 * Через подбор смещения (сервер может быть в UTC).
 */
function zonedLocalToUtc(year, month, day, hour, minute = 0, second = 0) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const shown = zonedNowParts(new Date(utcGuess));
  const asUtcFromShown = Date.UTC(
    shown.year,
    shown.month - 1,
    shown.day,
    shown.hour,
    shown.minute,
    shown.second,
  );
  const offset = asUtcFromShown - utcGuess;
  return new Date(utcGuess - offset);
}

function moscowWindowBounds(now = new Date()) {
  const p = zonedNowParts(now);
  const start = zonedLocalToUtc(p.year, p.month, p.day, WINDOW_START_HOUR, 0, 0);
  const end = zonedLocalToUtc(p.year, p.month, p.day, WINDOW_END_HOUR, 0, 0);
  return { start, end, parts: p };
}

function randomTimeBetween(from, to) {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return new Date(a);
  return new Date(a + Math.floor(Math.random() * (b - a)));
}

/** Не слать «профит-фото», если диалог уже в NFT-фазе или голосовое ушло. */
async function shouldSkipDailyPhoto(accountId, peerId) {
  if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) {
    return 'autoreply_disabled';
  }

  const [[voice]] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant' AND content = ?
     LIMIT 1`,
    [accountId, String(peerId), NFT_VOICE_TAG],
  );
  if (voice) return 'nft_voice_sent';

  const [[age]] = await db.execute(
    `SELECT TIMESTAMPDIFF(HOUR, MIN(created_at), NOW()) AS hours
     FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?`,
    [accountId, String(peerId)],
  );
  if (Number(age?.hours) >= NFT_VOICE_AFTER_HOURS) return 'nft_day';

  return null;
}

async function markSkipped(id, reason, accountId, peerId) {
  await db.execute('UPDATE daily_photo_sends SET sent_at = NOW() WHERE id = ?', [id]);
  console.log(
    `[Аккаунт ${accountId}] Ежедневное фото пропущено (${reason}) для ${peerId}.`,
  );
}

async function schedulePendingSends() {
  await ensureSchema();

  const now = new Date();
  const { start: windowStart, end: windowEnd } = moscowWindowBounds(now);

  if (now >= windowEnd) return;

  const lowerBound = now > windowStart ? now : windowStart;

  // Только 2-й день (< 48ч). С 3-го дня — NFT, профит-скрин мешает кампании.
  const [writers] = await db.execute(
    `SELECT DISTINCT cm.account_id, cm.peer_id, cm.peer_username,
       (SELECT MIN(cm2.created_at) FROM conversation_messages cm2
        WHERE cm2.account_id = cm.account_id AND cm2.peer_id = cm.peer_id) AS started_at
     FROM conversation_messages cm
     WHERE cm.role = 'user' AND DATE(cm.created_at) = CURDATE()
     HAVING DATE(started_at) < CURDATE()
       AND TIMESTAMPDIFF(HOUR, started_at, NOW()) < ?`,
    [NFT_VOICE_AFTER_HOURS],
  );

  for (const writer of writers) {
    if (await shouldSkipDailyPhoto(writer.account_id, writer.peer_id)) continue;

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

async function sendDuePhotos() {
  await ensureSchema();

  const now = new Date();
  const { end: windowEnd } = moscowWindowBounds(now);

  // Всё, что запланировано на после конца окна (или ошибочно в NFT-часы) — гасим.
  await db.execute(
    `UPDATE daily_photo_sends
     SET sent_at = NOW()
     WHERE send_date = CURDATE() AND sent_at IS NULL AND scheduled_at >= ?`,
    [windowEnd],
  );

  const [due] = await db.execute(
    `
    SELECT id, account_id, peer_id, peer_username
    FROM daily_photo_sends
    WHERE send_date = CURDATE() AND sent_at IS NULL AND scheduled_at <= NOW()
      AND scheduled_at < ?
  `,
    [windowEnd],
  );

  for (const row of due) {
    try {
      const skip = await shouldSkipDailyPhoto(row.account_id, row.peer_id);
      if (skip) {
        await markSkipped(row.id, skip, row.account_id, row.peer_id);
        continue;
      }

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

      const entity = await resolvePeerEntity(client, row.peer_id, row.peer_username);
      if (isNeverContact(entity) || isNeverContact(row.peer_username)) {
        await markSkipped(row.id, 'never_contact', row.account_id, row.peer_id);
        continue;
      }

      if (await isPeerArchived(client, entity)) {
        await markSkipped(row.id, 'archived', row.account_id, row.peer_id);
        continue;
      }

      const imagePath = pickRandomImage(folders);
      if (!imagePath) {
        console.error(`[Аккаунт ${row.account_id}] В папке с фото нет доступных файлов.`);
        continue;
      }

      const caption = pickRandomCaption();
      await client.sendFile(entity, { file: imagePath, caption });

      // Пишем в историю, чтобы на «что это?» / «this one?» модель знала:
      // это наш скрин прибыли с NFT-флипа, а не загадочная картинка.
      try {
        await saveMessage(
          row.account_id,
          row.peer_id,
          row.peer_username,
          'assistant',
          flipPhotoHistoryContent(caption),
        );
      } catch (histErr) {
        console.error(
          `[Аккаунт ${row.account_id}] Фото ушло, но историю не записали (${row.peer_id}):`,
          histErr.message,
        );
      }

      await db.execute('UPDATE daily_photo_sends SET sent_at = NOW() WHERE id = ?', [row.id]);

      console.log(
        `[Аккаунт ${row.account_id}] Отправлено ежедневное фото пользователю с ID ${row.peer_id}${row.peer_username ? ` (@${row.peer_username})` : ''}.`,
      );
    } catch (err) {
      console.error(
        `[Аккаунт ${row.account_id}] Ошибка отправки ежедневного фото ${row.peer_username || row.peer_id}:`,
        err.message,
      );

      if (isPermanentSendError(err)) {
        await markSkipped(row.id, 'permanent_error', row.account_id, row.peer_id);
      }
    }
  }
}

async function resolvePeerEntity(client, peerId, peerUsername) {
  const normalizedId = String(peerId || '').trim();
  if (normalizedId && /^-?\d+$/.test(normalizedId)) {
    try {
      return await client.getEntity(Number(normalizedId));
    } catch (idError) {
      if (!peerUsername) throw idError;
    }
  }

  const normalizedUsername = String(peerUsername || '').trim().replace(/^@/, '');
  if (normalizedUsername) return client.getEntity(normalizedUsername);

  throw new Error(`Не удалось найти Telegram-сущность по ID ${normalizedId || 'не указан'}`);
}

const PERMANENT_SEND_ERROR_CODES = [
  'CHAT_WRITE_FORBIDDEN',
  'USER_IS_BLOCKED',
  'USER_BANNED_IN_CHANNEL',
  'PEER_ID_INVALID',
  'USER_PRIVACY_RESTRICTED',
];

function isPermanentSendError(err) {
  const message = err && err.message ? err.message : '';
  return PERMANENT_SEND_ERROR_CODES.some((code) => message.includes(code));
}

let schedulerStarted = false;

function startDailyPhotoScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    try {
      await schedulePendingSends();
      await sendDuePhotos();
    } catch (err) {
      console.error('[dailyPhotos] tick failed:', err.message);
    }
  };

  tick();
  setInterval(tick, 60 * 1000);
  console.log(
    `[dailyPhotos] Планировщик запущен: окно ${WINDOW_START_HOUR}:00–${WINDOW_END_HOUR}:00 ${PHOTO_TIMEZONE} (до NFT-кампании).`,
  );
}

module.exports = {
  startDailyPhotoScheduler,
  schedulePendingSends,
  sendDuePhotos,
  FLIP_PHOTO_HISTORY_TAG,
  flipPhotoHistoryContent,
};
