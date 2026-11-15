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

// Профит-скрины ТОЛЬКО день 2 (24–48ч сессии), окно 18–20 МСК.
// Раньше день-3 (13–15) + закрытие слотов в 16:00 убивало день-2 (18–20) → скрины уезжали на 3–4 день.
const DAY2_AGE_MIN_H = 24;
const DAY2_AGE_MAX_H = 48;
const WINDOW_START_HOUR = Number(process.env.DAILY_PHOTO_START_HOUR || 18);
const WINDOW_END_HOUR = Number(process.env.DAILY_PHOTO_END_HOUR || 20);
// Не вклиниваться в живую переписку: скрин посреди разговора палит.
const ACTIVE_CHAT_QUIET_MIN = 10;
// Но и не кидать его в тишину: он должен был писать не позже этого.
const LIVE_DIALOG_MAX_IDLE_MIN = 60;
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
      image_file VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_account_peer_date (account_id, peer_id, send_date)
    )
  `);

  try {
    await db.execute(
      `ALTER TABLE daily_photo_sends ADD COLUMN image_file VARCHAR(255) NULL`,
    );
  } catch (_) {
    // колонка уже есть
  }

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

function pickFlipSend(isRussian, excludeBasenames = []) {
  const folders = isRussian ? getImagesFoldersRu() : getImagesFoldersEn();
  const imagePath = pickRandomImage(folders, excludeBasenames);
  if (!imagePath) return null;
  // И RU, и EN: цифры уже на карточке — только короткая живая подпись.
  const caption = pickRandomHook(isRussian);
  return { imagePath, caption };
}

function pickRandomImage(folders, excludeBasenames = []) {
  const exclude = new Set(
    (Array.isArray(excludeBasenames) ? excludeBasenames : [])
      .map((n) => String(n || '').toLowerCase())
      .filter(Boolean),
  );
  const allFiles = [];

  for (const folder of folders) {
    try {
      if (!fs.existsSync(folder)) continue;

      const files = fs
        .readdirSync(folder)
        .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .filter((name) => !exclude.has(name.toLowerCase()))
        .map((name) => path.join(folder, name));
      allFiles.push(...files);
    } catch (_) {
      // папка недоступна — пропускаем
    }
  }

  if (allFiles.length === 0) return null;
  return allFiles[Math.floor(Math.random() * allFiles.length)];
}

async function previouslySentFlipBasenames(accountId, peerId) {
  try {
    const [rows] = await db.execute(
      `SELECT image_file FROM daily_photo_sends
       WHERE account_id = ? AND peer_id = ?
         AND image_file IS NOT NULL AND image_file <> ''
         AND image_file <> '__claiming__'`,
      [accountId, String(peerId)],
    );
    return rows.map((r) => r.image_file).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** Календарная дата YYYY-MM-DD в PHOTO_TIMEZONE (не CURDATE() сервера). */
function moscowDateString(now = new Date()) {
  const p = zonedNowParts(now);
  const y = String(p.year);
  const m = String(p.month).padStart(2, '0');
  const d = String(p.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function moscowWindowBounds(now = new Date(), startHour = WINDOW_START_HOUR, endHour = WINDOW_END_HOUR) {
  const p = zonedNowParts(now);
  const start = zonedLocalToUtc(p.year, p.month, p.day, startHour, 0, 0);
  const end = zonedLocalToUtc(p.year, p.month, p.day, endHour, 0, 0);
  return { start, end, parts: p };
}

/** Только день 2 (24–48ч): 18–20 МСК. День 3+ — NFT, без профит-скринов. */
function photoWindowForAgeHours(ageHours, now = new Date()) {
  const age = Number(ageHours);
  if (!Number.isFinite(age) || age < DAY2_AGE_MIN_H || age >= DAY2_AGE_MAX_H) {
    return null;
  }
  return moscowWindowBounds(now, WINDOW_START_HOUR, WINDOW_END_HOUR);
}

function randomTimeBetween(from, to) {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return new Date(a);
  return new Date(a + Math.floor(Math.random() * (b - a)));
}

/** Не слать «профит-фото», если диалог уже в NFT-фазе или голосовое ушло. */
async function shouldSkipDailyPhoto(accountId, peerId) {
  // Явно выкл.: DAILY_PHOTO_ENABLED=0|false|off
  if (/^(0|false|no|off)$/i.test(String(process.env.DAILY_PHOTO_ENABLED || ''))) {
    return 'disabled';
  }

  if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) {
    return 'autoreply_disabled';
  }

  // Все карточки профита уже уходили этому peer — больше нечего слать без дубля файла.
  const used = await previouslySentFlipBasenames(accountId, peerId);
  if (used.length) {
    const hasRu = !!pickRandomImage(getImagesFoldersRu(), used);
    const hasEn = !!pickRandomImage(getImagesFoldersEn(), used);
    if (!hasRu && !hasEn) return 'all_flip_images_used';
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
  // День 1 (<24ч) — рано. День 2 (24–48ч) — один слот скрина. День 3+ — NFT, не скрины.
  if (ageHours < DAY2_AGE_MIN_H) return 'too_early';
  if (ageHours >= DAY2_AGE_MAX_H) return 'past_day2_nft_phase';

  return null;
}

/**
 * Минут до «тишины» в диалоге: >0 — сейчас идёт переписка или собеседник ждёт
 * нашего ответа, фото лучше отложить.
 */
async function activeChatWaitMinutes(accountId, peerId) {
  const [[last]] = await db.execute(
    `SELECT role, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_sec
     FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC LIMIT 1`,
    [accountId, String(peerId)],
  );
  if (!last) return 0;
  const ageMin = Number(last.age_sec) / 60;
  if (last.role === 'user' && ageMin < 120) return 15;
  if (ageMin < ACTIVE_CHAT_QUIET_MIN) return Math.ceil(ACTIVE_CHAT_QUIET_MIN - ageMin) + 5;
  return 0;
}

async function markSkipped(id, reason, accountId, peerId) {
  // sent_at без image_file = «слот дня закрыт», не «фото ушло»
  // (wasDailyFlipSentRecently требует image_file).
  await db.execute(
    `UPDATE daily_photo_sends
     SET sent_at = NOW(), image_file = NULL
     WHERE id = ? AND (sent_at IS NULL OR image_file = '__claiming__')`,
    [id],
  );
  console.log(
    `[Аккаунт ${accountId}] Ежедневное фото пропущено (${reason}) для ${peerId}.`,
  );
}

/** Атомарный claim строки перед sendFile — защита от двойной отправки. */
async function claimSendRow(id) {
  const [result] = await db.execute(
    `UPDATE daily_photo_sends
     SET sent_at = NOW(), image_file = '__claiming__'
     WHERE id = ? AND sent_at IS NULL`,
    [id],
  );
  return result.affectedRows > 0;
}

async function releaseClaim(id) {
  await db.execute(
    `UPDATE daily_photo_sends
     SET sent_at = NULL, image_file = NULL
     WHERE id = ? AND image_file = '__claiming__'`,
    [id],
  );
}

async function schedulePendingSends() {
  await ensureSchema();

  const now = new Date();
  const mskDate = moscowDateString(now);
  const parts = zonedNowParts(now);

  // Кандидаты: писали в календарные сутки МСК (не CURDATE() UTC-сервера).
  // Границы суток считаем в JS — CONVERT_TZ на VPS часто NULL без tz-tables.
  const dayStartUtc = zonedLocalToUtc(parts.year, parts.month, parts.day, 0, 0, 0);
  const dayEndUtc = zonedLocalToUtc(parts.year, parts.month, parts.day, 23, 59, 59);
  const [writers] = await db.execute(
    `SELECT DISTINCT cm.account_id, cm.peer_id, cm.peer_username
     FROM conversation_messages cm
     WHERE cm.role = 'user'
       AND cm.created_at >= ? AND cm.created_at <= ?`,
    [dayStartUtc, dayEndUtc],
  );

  for (const writer of writers) {
    if (await shouldSkipDailyPhoto(writer.account_id, writer.peer_id)) continue;

    const ageHours = await tg().getDialogAgeHours(writer.account_id, String(writer.peer_id));
    const win = photoWindowForAgeHours(ageHours, now);
    if (!win) continue;
    const { start: windowStart, end: windowEnd } = win;
    if (now >= windowEnd) continue;
    const lowerBound = now > windowStart ? now : windowStart;
    if (lowerBound >= windowEnd) continue;
    const scheduledAt = randomTimeBetween(lowerBound, windowEnd);

    try {
      await db.execute(
        `INSERT IGNORE INTO daily_photo_sends
           (account_id, peer_id, peer_username, send_date, scheduled_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          writer.account_id,
          writer.peer_id,
          writer.peer_username,
          mskDate,
          scheduledAt,
        ],
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
  // Окно дня 2 = 18–20 МСК (не дефолт 14–16 — иначе слоты 18–20 гасились в 16:00).
  const { start: windowStart, end: windowEnd } = moscowWindowBounds(
    now,
    WINDOW_START_HOUR,
    WINDOW_END_HOUR,
  );
  const mskDate = moscowDateString(now);

  // После конца окна дня 2 — закрываем оставшиеся слоты.
  if (now >= windowEnd) {
    await db.execute(
      `UPDATE daily_photo_sends
       SET sent_at = NOW()
       WHERE send_date = ? AND sent_at IS NULL`,
      [mskDate],
    );
    return;
  }

  // До начала окна — не шлём и не гасим (слот ждёт 18:00 МСК).
  if (now < windowStart) return;

  // Запланировано на после конца окна — гасим.
  await db.execute(
    `UPDATE daily_photo_sends
     SET sent_at = NOW()
     WHERE send_date = ? AND sent_at IS NULL AND scheduled_at >= ?`,
    [mskDate, windowEnd],
  );

  const [due] = await db.execute(
    `
    SELECT id, account_id, peer_id, peer_username
    FROM daily_photo_sends
    WHERE send_date = ? AND sent_at IS NULL AND scheduled_at <= NOW()
      AND scheduled_at < ?
  `,
    [mskDate, windowEnd],
  );

  for (const row of due) {
    try {
      const skip = await shouldSkipDailyPhoto(row.account_id, row.peer_id);
      if (skip) {
        await markSkipped(row.id, skip, row.account_id, row.peer_id);
        continue;
      }

      const waitMin = await activeChatWaitMinutes(row.account_id, row.peer_id);
      if (waitMin > 0) {
        const next = new Date(Date.now() + (waitMin + Math.floor(Math.random() * 10)) * 60 * 1000);
        if (next < windowEnd) {
          await db.execute('UPDATE daily_photo_sends SET scheduled_at = ? WHERE id = ?', [next, row.id]);
        } else {
          await markSkipped(row.id, 'active_chat', row.account_id, row.peer_id);
        }
        continue;
      }

      const idleMin = await tg().lastIncomingAgeMin(row.account_id, row.peer_id);
      if (idleMin == null || idleMin > LIVE_DIALOG_MAX_IDLE_MIN) {
        const next = new Date(Date.now() + (15 + Math.floor(Math.random() * 10)) * 60 * 1000);
        if (next < windowEnd) {
          await db.execute('UPDATE daily_photo_sends SET scheduled_at = ? WHERE id = ?', [next, row.id]);
        } else {
          await markSkipped(row.id, 'silent_peer', row.account_id, row.peer_id);
        }
        continue;
      }

      const { getActiveClient, isNeverContact, isPeerArchived, saveMessage, conversationIsRussian } =
        tg();
      const client = getActiveClient(row.account_id);
      if (!client) {
        const next = new Date(Date.now() + (5 + Math.floor(Math.random() * 5)) * 60 * 1000);
        if (next < windowEnd) {
          await db.execute('UPDATE daily_photo_sends SET scheduled_at = ? WHERE id = ?', [
            next,
            row.id,
          ]);
          console.error(
            `[Аккаунт ${row.account_id}] Нет клиента — фото для ${row.peer_username || row.peer_id} отложено.`,
          );
        } else {
          await markSkipped(row.id, 'offline', row.account_id, row.peer_id);
        }
        continue;
      }

      const isRussian = await conversationIsRussian(row.account_id, row.peer_id);
      const usedFiles = await previouslySentFlipBasenames(row.account_id, row.peer_id);
      const flip = pickFlipSend(isRussian, usedFiles);
      if (!flip) {
        if (usedFiles.length) {
          await markSkipped(row.id, 'all_flip_images_used', row.account_id, row.peer_id);
          continue;
        }
        await markSkipped(row.id, 'no_assets', row.account_id, row.peer_id);
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

      // Claim до sendFile — параллельный тик не возьмёт ту же строку.
      if (!(await claimSendRow(row.id))) continue;

      const { imagePath, caption } = flip;
      const imageFile = path.basename(imagePath);
      try {
        await client.sendFile(entity, { file: imagePath, caption });
      } catch (sendErr) {
        await releaseClaim(row.id);
        throw sendErr;
      }
      try {
        require('./humanHardening').noteFlipPhotoSent(row.account_id, row.peer_id);
        require('./humanHardening').notePitchSent(row.account_id, row.peer_id);
      } catch (_) {
        /* optional */
      }

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

      await db.execute(
        'UPDATE daily_photo_sends SET sent_at = NOW(), image_file = ? WHERE id = ?',
        [imageFile, row.id],
      );

      console.log(
        `[Аккаунт ${row.account_id}] Отправлено ежедневное фото ${imageFile} пользователю с ID ${row.peer_id}${row.peer_username ? ` (@${row.peer_username})` : ''}.`,
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

  if (/^(0|false|no|off)$/i.test(String(process.env.DAILY_PHOTO_ENABLED || ''))) {
    console.log('[dailyPhotos] Планировщик профит-скринов выключен (DAILY_PHOTO_ENABLED).');
    return;
  }

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
  photoWindowForAgeHours,
  DAY2_AGE_MIN_H,
  DAY2_AGE_MAX_H,
  WINDOW_START_HOUR,
  WINDOW_END_HOUR,
  FLIP_PHOTO_HISTORY_TAG_RU,
  FLIP_PHOTO_HISTORY_TAG_EN,
  // backwards-compatible alias
  FLIP_PHOTO_HISTORY_TAG: FLIP_PHOTO_HISTORY_TAG_RU,
  flipPhotoHistoryContent,
};
