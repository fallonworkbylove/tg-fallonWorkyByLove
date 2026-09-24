const fs = require('fs');
const path = require('path');
const db = require('../db');
const helpRequestNotifier = require('./helpRequestNotifier');

// telegramClient тянет много зависимостей; saveMessage берём лениво,
// чтобы не словить циклический require (иначе история флип-фото не пишется).
function tg() {
  return require('./telegramClient');
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Окно по Москве (не UTC сервера!): 13:00–15:00 МСК — строго до NFT 16:00–21:00 МСК.
const WINDOW_START_HOUR = 13;
const WINDOW_END_HOUR = 15;
const PHOTO_TIMEZONE = process.env.WORK_TIMEZONE || 'Europe/Moscow';
const NFT_VOICE_TAG = '[голосовое: nft.ogg]';

// Метка в истории диалога: модель должна понимать, что это наш скрин флипа,
// а не «фото от собеседника». objectionHandler ищет этот префикс (RU/EN).
const FLIP_PHOTO_HISTORY_TAG_RU =
  '[фото от меня: скриншот прибыли с флиппинга NFT — купила дешевле, продала дороже]';
const FLIP_PHOTO_HISTORY_TAG_EN =
  '[photo from me: NFT flip profit screenshot — bought cheaper, sold higher]';

const CAPTIONS_RU = [
  'сегодня повезло 😊',
  'вот так бы всегда 🥹',
  'работает же, хаха',
  'на ужин заработала 👍',
  'неожиданно, приятно 🙃',
];

const CAPTIONS_EN = [
  'got lucky today 😊',
  'wish it was always like this 🥹',
  'it actually works lol',
  'made enough for dinner 👍',
  'unexpected but nice 🙃',
];

// Цифры в подписи сообщения (не вшиты в картинку) — в чате это фото + текст, не «карточка».
const FLIP_DEALS = {
  'profits1.png': {
    title: 'T1000 #32',
    buyTon: '450.9021',
    sellTon: '716.09',
    diffTon: '265.1879',
    buyRu: '62,022.80₽',
    sellRu: '98,500.11₽',
    diffRu: '36,477.31₽',
    buyEn: '$689.14',
    sellEn: '$1,094.45',
    diffEn: '$405.30',
  },
  'profits2.jpg': {
    title: 'BOXER #25',
    buyTon: '301.5967',
    sellTon: '578.22',
    diffTon: '276.6233',
    buyRu: '29,938.04₽',
    sellRu: '57,397.08₽',
    diffRu: '27,459.04₽',
    buyEn: '$332.64',
    sellEn: '$637.75',
    diffEn: '$305.10',
  },
  'profits3.png': {
    title: 'Meebit #18494',
    buyTon: '232.6196',
    sellTon: '460.91',
    diffTon: '228.2904',
    buyRu: '31,997.45₽',
    sellRu: '63,399.41₽',
    diffRu: '31,401.96₽',
    buyEn: '$355.53',
    sellEn: '$704.44',
    diffEn: '$348.91',
  },
  'profits4.png': {
    title: 'alien fren #9671',
    buyTon: '872.98',
    sellTon: '1043.24',
    diffTon: '170.26',
    buyRu: '120,080.75₽',
    sellRu: '143,500.47₽',
    diffRu: '23,419.72₽',
    buyEn: '$1,334.23',
    sellEn: '$1,594.45',
    diffEn: '$260.22',
  },
};

function flipPhotoHistoryContent(caption, isRussian = true) {
  const tag = isRussian ? FLIP_PHOTO_HISTORY_TAG_RU : FLIP_PHOTO_HISTORY_TAG_EN;
  const cap = String(caption || '').trim();
  if (!cap) return tag;
  return isRussian ? `${tag} Подпись: "${cap}"` : `${tag} Caption: "${cap}"`;
}

function pickRandomHook(isRussian = true) {
  const bank = isRussian ? CAPTIONS_RU : CAPTIONS_EN;
  return bank[Math.floor(Math.random() * bank.length)];
}

function formatDealCaption(deal, isRussian, hook) {
  if (!deal) return hook;
  if (isRussian) {
    return [
      hook,
      '',
      deal.title,
      `Цена покупки: ${deal.buyTon} TON (${deal.buyRu})`,
      `Цена продажи: ${deal.sellTon} TON (${deal.sellRu})`,
      `Разница: ${deal.diffTon} TON (${deal.diffRu})`,
    ].join('\n');
  }
  return [
    hook,
    '',
    deal.title,
    `Purchase price: ${deal.buyTon} TON (${deal.buyEn})`,
    `Sale price: ${deal.sellTon} TON (${deal.sellEn})`,
    `Difference: ${deal.diffTon} TON (${deal.diffEn})`,
  ].join('\n');
}

function buildFlipCaption(imagePath, isRussian = true) {
  const base = path.basename(String(imagePath || ''));
  const deal = FLIP_DEALS[base] || null;
  return formatDealCaption(deal, isRussian, pickRandomHook(isRussian));
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

function getImagesFoldersRu() {
  // Оригинальные карточки с русским текстом на картинке.
  return [process.env.IMAGES_FOLDER, process.env.IMAGES_FOLDER_2]
    .filter((folder) => folder && folder.trim())
    .map((folder) => folder.trim());
}

function getImagesFoldersEn() {
  // EN-карточки того же формата, что RU, но TON/$ (без рублей).
  return [process.env.IMAGES_FOLDER_EN, process.env.IMAGES_FOLDER_EN_2]
    .filter((folder) => folder && folder.trim())
    .map((folder) => folder.trim());
}

/** @deprecated use getImagesFoldersRu / getImagesFoldersEn */
function getImagesFolders() {
  return getImagesFoldersRu();
}

function pickFlipSend(isRussian) {
  const folders = isRussian ? getImagesFoldersRu() : getImagesFoldersEn();
  const imagePath = pickRandomImage(folders);
  if (!imagePath) return null;
  // И RU, и EN: цифры уже на карточке — только короткая живая подпись.
  const caption = pickRandomHook(isRussian);
  return { imagePath, caption };
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

  // Возраст ТЕКУЩЕЙ сессии (пауза ≥72ч сбрасывает счётчик), как у NFT-кампании.
  // MIN(created_at) по всей истории ошибочно считал старые диалоги «3-м днём».
  const ageHours = await tg().getDialogAgeHours(accountId, String(peerId));
  if (ageHours == null) return 'no_active_dialog';
  if (ageHours >= tg().NFT_VOICE_AFTER_HOURS) return 'nft_day';
  // Первый день знакомства в текущей сессии — ещё рано для профит-скрина.
  if (ageHours < 20) return 'too_early';

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

  // Кандидаты: сегодня писали. День/сессия — в shouldSkipDailyPhoto
  // (getDialogAgeHours: ~20–48ч текущей сессии, не MIN по всей истории).
  const [writers] = await db.execute(
    `SELECT DISTINCT cm.account_id, cm.peer_id, cm.peer_username
     FROM conversation_messages cm
     WHERE cm.role = 'user' AND DATE(cm.created_at) = CURDATE()`,
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

      const { getActiveClient, isNeverContact, isPeerArchived, saveMessage, conversationIsRussian } =
        tg();
      const client = getActiveClient(row.account_id);
      if (!client) {
        console.error(
          `[Аккаунт ${row.account_id}] Нет активного клиента — фото для ${row.peer_username || row.peer_id} отложено.`,
        );
        continue;
      }

      const isRussian = await conversationIsRussian(row.account_id, row.peer_id);
      const flip = pickFlipSend(isRussian);
      if (!flip) {
        console.error(
          'Нет фото для daily flip (IMAGES_FOLDER для RU / IMAGES_FOLDER_EN для EN).',
        );
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

      const { imagePath, caption } = flip;
      await client.sendFile(entity, { file: imagePath, caption });

      // Пишем в историю, чтобы на «что это?» / «this one?» модель знала:
      // это наш скрин прибыли с NFT-флипа, а не загадочная картинка.
      try {
        await saveMessage(
          row.account_id,
          String(row.peer_id),
          row.peer_username || null,
          'assistant',
          flipPhotoHistoryContent(caption, isRussian),
        );
        console.log(
          `[Аккаунт ${row.account_id}] Daily flip (${isRussian ? 'RU' : 'EN'}): история записана для ${row.peer_id}`,
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
  FLIP_PHOTO_HISTORY_TAG_RU,
  FLIP_PHOTO_HISTORY_TAG_EN,
  // backwards-compatible alias
  FLIP_PHOTO_HISTORY_TAG: FLIP_PHOTO_HISTORY_TAG_RU,
  flipPhotoHistoryContent,
};
