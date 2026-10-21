/**
 * УВЕДОМЛЕНИЯ ОПЕРАТОРУ О СОГЛАСИИ ПОМОЧЬ (после голосового с просьбой).
 *
 * Сценарий:
 * 1. Бот (AI-персонаж) отправляет собеседнику голосовое с просьбой о помощи
 *    (например, nft.ogg — просит помочь с токеном). Мы фиксируем это в таблице
 *    help_requests со статусом "pending".
 * 2. На каждое СЛЕДУЮЩЕЕ сообщение этого собеседника мы проверяем — не
 *    согласился ли он помочь. Проверка двойная: быстрые ключевые слова +
 *    лёгкий AI-запрос (gpt-4o-mini) для смысловой оценки, чтобы не полагаться
 *    только на совпадение слов.
 * 3. Если согласие обнаружено — отправляем карточку в тот же
 *    Telegram-бот, что используется для miniapp (BOT_TOKEN). Карточку
 *    получают все, кто хоть раз написал этому боту /start (таблица
 *    notification_subscribers).
 *
 * Обработка /start и /stop реализована через простой long-polling
 * (getUpdates), без сторонних библиотек — только встроенный fetch. Это
 * безопасно совмещать с miniapp: BOT_TOKEN в остальном проекте используется
 * только для проверки подписи initData, никакой другой polling/webhook на
 * этом токене не висит.
 */

const db = require('../db');
const { buildOpenAIOptions } = require('./aiResponder');
const OpenAI = require('openai');

const NOTIFY_BOT_TOKEN = process.env.BOT_TOKEN;
const MINIAPP_URL = process.env.MINIAPP_URL || null;
const TELEGRAM_API = NOTIFY_BOT_TOKEN
  ? `https://api.telegram.org/bot${NOTIFY_BOT_TOKEN}`
  : null;

let scorerClient = null;
function getScorerClient() {
  if (!scorerClient) {
    scorerClient = new OpenAI(buildOpenAIOptions());
  }
  return scorerClient;
}

// ---------------------------------------------------------------------------
// СХЕМА БД
// ---------------------------------------------------------------------------

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS notification_subscribers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chat_id VARCHAR(64) NOT NULL UNIQUE,
        username VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS help_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        peer_username VARCHAR(255) NULL,
        voice_file VARCHAR(255) NOT NULL,
        status ENUM('pending', 'agreed', 'expired') NOT NULL DEFAULT 'pending',
        consent_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL,
        INDEX idx_pending (account_id, peer_id, status)
      )
    `);
    // Собеседники, которым бот отправил голосовое-просьбу — для них автоответ
    // отключается на этом конкретном диалоге (остальные диалоги аккаунта не
    // затрагиваются). Снять отключение можно вручную, удалив запись.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS autoreply_disabled_peers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        reason VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_account_peer (account_id, peer_id)
      )
    `);
    // Кого ещё уведомлять о лидах по номеру (кроме владельца).
    await db.execute(`
      CREATE TABLE IF NOT EXISTS account_notify_delegates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        owner_user_id INT NOT NULL,
        subscriber_chat_id VARCHAR(64) NOT NULL,
        subscriber_username VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_acc_sub (account_id, subscriber_chat_id),
        KEY idx_owner (owner_user_id),
        KEY idx_sub (subscriber_chat_id)
      )
    `);
  })();
  return schemaReady;
}

// ---------------------------------------------------------------------------
// ОТКЛЮЧЕНИЕ АВТООТВЕТА ДЛЯ КОНКРЕТНОГО СОБЕСЕДНИКА
// ---------------------------------------------------------------------------

/**
 * Отключает автоответ ИИ для конкретной пары аккаунт+собеседник. Вызывается
 * сразу после отправки голосового с просьбой о помощи — дальше в этом диалоге
 * отвечает оператор вручную, а не ИИ. Остальные диалоги этого аккаунта не
 * затрагиваются.
 */
async function disableAutoreplyForPeer(accountId, peerId, reason) {
  try {
    await ensureSchema();
    await db.execute(
      `INSERT INTO autoreply_disabled_peers (account_id, peer_id, reason)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
      [accountId, peerId, reason || null],
    );
  } catch (err) {
    console.error('[helpRequestNotifier] Не удалось отключить автоответ для собеседника:', err.message);
  }
}

/**
 * Проверяет, отключён ли автоответ для этой пары аккаунт+собеседник.
 */
async function isAutoreplyDisabledForPeer(accountId, peerId) {
  try {
    await ensureSchema();
    const [rows] = await db.execute(
      `SELECT id FROM autoreply_disabled_peers WHERE account_id = ? AND peer_id = ? LIMIT 1`,
      [accountId, peerId],
    );
    return rows.length > 0;
  } catch (err) {
    console.error('[helpRequestNotifier] Ошибка проверки отключения автоответа:', err.message);
    return false;
  }
}

/**
 * Включает автоответ обратно (например, если оператор решил вернуть чат ИИ).
 */
async function enableAutoreplyForPeer(accountId, peerId) {
  try {
    await db.execute(
      `DELETE FROM autoreply_disabled_peers WHERE account_id = ? AND peer_id = ?`,
      [accountId, peerId],
    );
  } catch (err) {
    console.error('[helpRequestNotifier] Не удалось включить автоответ обратно:', err.message);
  }
}

// ---------------------------------------------------------------------------
// ФИКСАЦИЯ ОТПРАВКИ ГОЛОСОВОГО С ПРОСЬБОЙ
// ---------------------------------------------------------------------------

/**
 * Вызывается сразу после того, как собеседнику реально ушло голосовое с
 * просьбой о помощи. Открывает "окно ожидания согласия" для этой пары
 * аккаунт+собеседник.
 */
async function recordVoiceSent(accountId, peerId, peerUsername, voiceFile, accountPhone, accountName) {
  try {
    await ensureSchema();
    // Не открываем второе окно ожидания, если предыдущее по этому же файлу
    // ещё не разрешено (на случай повторной отправки — хотя voiceTag и так
    // защищает от дублей отправки самого голосового).
    const [[existing]] = await db.execute(
      `SELECT id FROM help_requests
       WHERE account_id = ? AND peer_id = ? AND voice_file = ? AND status = 'pending'
       LIMIT 1`,
      [accountId, peerId, voiceFile],
    );
    if (existing) return;

      await db.execute(
      `INSERT INTO help_requests (account_id, peer_id, peer_username, voice_file, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [accountId, peerId, peerUsername || null, voiceFile],
    );

    await notifyVoiceSent({
      accountId,
      accountPhone,
      accountName,
      peerId,
      peerUsername,
      voiceFile,
    });
  } catch (err) {
    console.error('[helpRequestNotifier] Не удалось зафиксировать отправку голосового:', err.message);
  }
}

async function notifyVoiceSent({ accountId, accountPhone, accountName, peerId, peerUsername, voiceFile }) {
  if (!TELEGRAM_API) {
    console.error('[helpRequestNotifier] BOT_TOKEN не задан — уведомление об отправке не отправлено.');
    return;
  }

  const owner = await getAccountOwner(accountId);
  const subscribers = owner?.telegramUserId
    ? await getAccountNotificationSubscribers(accountId, owner.telegramUserId)
    : [];
  if (subscribers.length === 0) {
    console.error(
      `[helpRequestNotifier] Для аккаунта №${accountId} не найден подписанный владелец — уведомление не отправлено.`,
    );
    return;
  }

  const normalizedUsername = String(peerUsername || '').trim().replace(/^@/, '');
  const peerLabel = normalizedUsername
    ? `@${normalizedUsername} (id ${peerId})`
    : `id ${peerId}`;
  const accountLabel = formatAccountLabel(accountId, accountPhone, accountName);
  const text =
    '<b>ИИ отправила NFT-голосовое</b>\n\n' +
    `<b>Аккаунт:</b> ${escapeHtml(accountLabel)}\n` +
    `<b>Собеседник:</b> ${escapeHtml(peerLabel)}\n` +
    `<b>Голосовое:</b> ${escapeHtml(voiceFile)}\n\n` +
    'ИИ больше не отвечает в этом диалоге — дальше переписку ведёт оператор';

  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: subscribers[0].chat_id, text, parse_mode: 'HTML' }),
    });
    if (!response.ok) {
      console.error('[helpRequestNotifier] Ошибка отправки уведомления о голосовом:', await response.text());
    }
  } catch (err) {
    console.error('[helpRequestNotifier] Не удалось отправить уведомление о голосовом:', err.message);
  }
}

// ---------------------------------------------------------------------------
// ОПРЕДЕЛЕНИЕ СОГЛАСИЯ
// ---------------------------------------------------------------------------

// Быстрые ключевые слова согласия — если есть явное совпадение, не тратим
// токены на AI-запрос и сразу считаем согласием.
// Границы слова заданы вручную: \b в JS опирается на латиницу, поэтому с
// кириллицей он не срабатывает вообще.
const WORD_START = '(?<![а-яёa-z0-9_])';
const WORD_END = '(?![а-яёa-z0-9_])';

const AGREE_KEYWORDS_RE = new RegExp(
  `${WORD_START}(?:да|ладно|ок|окей|хорошо|конечно|давай|помогу|сделаю|скину|отправлю|переведу|пришлю|` +
    `отправл(?:ю|яю)|перевед(?:у|ём|ем)|(?:без|нет)\\s+проблем|не\\s+вопрос|no\\s+problem|sure|ok|okay|yes)${WORD_END}`,
  'i',
);

// Явные слова отказа — если есть, согласием не считаем, даже если рядом
// встретилось слово из списка выше ("да ну нет", "нет, не буду").
// «нет проблем» / «no problem» — это согласие, а не отказ, поэтому «нет»/«no»
// перед словом «проблем» намеренно не засчитываются.
const REFUSE_KEYWORDS_RE = new RegExp(
  `${WORD_START}(?:нет(?!\\s+проблем)|не\\s+буду|не\\s+могу|не\\s+хочу|не\\s+сейчас|не\\s+готов|откажусь|` +
    `not\\s+now|can'?t|won'?t|no(?!\\s+(?:problem|worries|prob)))${WORD_END}`,
  'i',
);

/**
 * Лёгкий AI-запрос: анализирует, согласился ли собеседник помочь после того,
 * как ему прислали голосовое с просьбой. Возвращает true/false.
 */
async function aiDetectAgreement(message) {
  try {
    const client = getScorerClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Ты классификатор. Тебе дают ответ собеседника ПОСЛЕ того, как ему в голосовом ' +
            'сообщении попросили помочь (например, перевести немного денег или помочь с чем-то). ' +
            'Определи, согласился ли он помочь. Ответь ТОЛЬКО одним словом: "yes" — если согласился ' +
            'или проявил готовность помочь, "no" — если отказался, уклонился, задал вопрос или ' +
            'ответ не связан с согласием.',
        },
        { role: 'user', content: message.slice(0, 500) },
      ],
      max_tokens: 5,
      temperature: 0,
    });
    const answer = response.choices[0]?.message?.content?.trim().toLowerCase() || '';
    return answer.startsWith('yes');
  } catch (err) {
    console.error('[helpRequestNotifier] Не удалось оценить согласие через AI:', err.message);
    return false;
  }
}

/**
 * Проверяет входящее сообщение собеседника на согласие помочь, если для этой
 * пары аккаунт+собеседник есть открытое ("pending") голосовое-просьба.
 * При обнаружении согласия — уведомляет операторов и закрывает окно.
 * Ничего не бросает наружу: ошибки только логируются, чтобы не мешать
 * основной генерации ответа бота.
 */
async function checkConsent(accountId, peerId, peerUsername, accountPhone, incomingText, accountName) {
  try {
    await ensureSchema();

    const [[pending]] = await db.execute(
      `SELECT id, voice_file FROM help_requests
       WHERE account_id = ? AND peer_id = ? AND status = 'pending'
       ORDER BY id DESC LIMIT 1`,
      [accountId, peerId],
    );
    if (!pending || !incomingText) return;

    const hasRefusal = REFUSE_KEYWORDS_RE.test(incomingText);
    const trimmed = String(incomingText || '').trim();
    // Голое «ок/да/ладно» без контекста помощи — не согласие (часто просто реакция).
    const bareAck = /^(?:да|ладно|ок|окей|хорошо|конечно|давай|ok|okay|yes|sure)\s*[).!]*$/i.test(
      trimmed,
    );
    const helpish =
      /(помог|сделаю|скин|отправ|перевод|пришлю|деньг|бабк|средств|токен|нфт|nft|без\s+проблем|не\s+вопрос)/i.test(
        trimmed,
      );
    const hasKeyword =
      !hasRefusal && AGREE_KEYWORDS_RE.test(incomingText) && (!bareAck || helpish);

    const agreed =
      hasKeyword ||
      (!hasRefusal && !bareAck && (await aiDetectAgreement(incomingText)));
    if (!agreed) return;

    await db.execute(
      `UPDATE help_requests SET status = 'agreed', consent_message = ?, resolved_at = NOW()
       WHERE id = ?`,
      [incomingText.slice(0, 500), pending.id],
    );

    await notifyOperators({
      accountId,
      accountPhone,
      accountName,
      peerId,
      peerUsername,
      voiceFile: pending.voice_file,
      consentMessage: incomingText,
    });
  } catch (err) {
    console.error('[helpRequestNotifier] Ошибка проверки согласия:', err.message);
  }
}

// ---------------------------------------------------------------------------
// ОТПРАВКА КАРТОЧКИ ОПЕРАТОРАМ
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Возвращает всех подписчиков уведомляющего бота, у которых есть хотя бы
 * один привязанный Telegram-аккаунт в Mini App.
 */
async function getAccountOwner(accountId) {
  const [[row]] = await db.execute(
    `SELECT u.telegram_user_id AS telegram_user_id
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     WHERE a.id = ? AND u.telegram_user_id IS NOT NULL
     LIMIT 1`,
    [accountId],
  );
  return row ? { telegramUserId: String(row.telegram_user_id) } : null;
}

async function getAccountNotificationSubscribers(accountId, telegramUserId) {
  const [rows] = await db.execute(
    `SELECT DISTINCT ns.chat_id
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     JOIN notification_subscribers ns ON CAST(ns.chat_id AS CHAR) = CAST(u.telegram_user_id AS CHAR)
     WHERE a.id = ? AND u.telegram_user_id = ?`,
    [accountId, telegramUserId],
  );
  return rows;
}

/**
 * Все chat_id, кому слать лиды/согласие по аккаунту:
 * владелец (если /start) + делегаты с /start.
 */
async function getLeadNotifyChatIds(accountId) {
  await ensureSchema();
  const chats = new Set();
  const owner = await getAccountOwner(accountId);
  if (owner?.telegramUserId) {
    const own = await getAccountNotificationSubscribers(accountId, owner.telegramUserId);
    for (const row of own) chats.add(String(row.chat_id));
  }
  const [delegates] = await db.execute(
    `SELECT DISTINCT d.subscriber_chat_id AS chat_id
     FROM account_notify_delegates d
     INNER JOIN notification_subscribers ns
       ON CAST(ns.chat_id AS CHAR) = CAST(d.subscriber_chat_id AS CHAR)
     WHERE d.account_id = ?`,
    [accountId],
  );
  for (const row of delegates || []) chats.add(String(row.chat_id));
  return [...chats].map((chat_id) => ({ chat_id }));
}

async function listNotifyDelegates(accountId) {
  await ensureSchema();
  const [rows] = await db.execute(
    `SELECT d.subscriber_chat_id, d.subscriber_username, d.created_at,
            (ns.chat_id IS NOT NULL) AS is_subscribed
     FROM account_notify_delegates d
     LEFT JOIN notification_subscribers ns
       ON CAST(ns.chat_id AS CHAR) = CAST(d.subscriber_chat_id AS CHAR)
     WHERE d.account_id = ?
     ORDER BY d.id ASC`,
    [accountId],
  );
  return rows || [];
}

async function addNotifyDelegate({ accountId, ownerUserId, subscriberChatId, subscriberUsername }) {
  await ensureSchema();
  const chatId = String(subscriberChatId || '').trim();
  if (!chatId) throw new Error('Нужен chat_id подписчика');
  await db.execute(
    `INSERT INTO account_notify_delegates
       (account_id, owner_user_id, subscriber_chat_id, subscriber_username)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       subscriber_username = COALESCE(VALUES(subscriber_username), subscriber_username),
       owner_user_id = VALUES(owner_user_id)`,
    [accountId, ownerUserId, chatId, subscriberUsername || null],
  );
  return true;
}

async function removeNotifyDelegate(accountId, subscriberChatId) {
  await ensureSchema();
  const [result] = await db.execute(
    `DELETE FROM account_notify_delegates
     WHERE account_id = ? AND subscriber_chat_id = ?`,
    [accountId, String(subscriberChatId)],
  );
  return (result?.affectedRows || 0) > 0;
}

/** Найти chat_id по @username среди тех, кто уже жали /start. */
async function resolveSubscriberByUsername(username) {
  const uname = String(username || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  if (!uname || !/^[a-z0-9_]{4,32}$/i.test(uname)) return null;
  await ensureSchema();
  const [[ns]] = await db.execute(
    `SELECT chat_id, username FROM notification_subscribers
     WHERE LOWER(REPLACE(username, '@', '')) = ?
     LIMIT 1`,
    [uname],
  );
  if (ns) return { chatId: String(ns.chat_id), username: ns.username || uname };
  const [[u]] = await db.execute(
    `SELECT telegram_user_id AS chat_id, username FROM users
     WHERE LOWER(REPLACE(username, '@', '')) = ? AND telegram_user_id IS NOT NULL
     LIMIT 1`,
    [uname],
  );
  if (!u) return null;
  // Должен быть в подписчиках бота, иначе sendMessage не дойдёт.
  const [[sub]] = await db.execute(
    `SELECT chat_id FROM notification_subscribers
     WHERE CAST(chat_id AS CHAR) = CAST(? AS CHAR) LIMIT 1`,
    [String(u.chat_id)],
  );
  if (!sub) return null;
  return { chatId: String(u.chat_id), username: u.username || uname };
}

async function isNotificationSubscriber(chatId) {
  await ensureSchema();
  const [[row]] = await db.execute(
    `SELECT chat_id FROM notification_subscribers
     WHERE CAST(chat_id AS CHAR) = CAST(? AS CHAR) LIMIT 1`,
    [String(chatId)],
  );
  return !!row;
}

function formatAccountLabel(accountId, accountPhone, accountName) {
  const name = String(accountName || '').trim();
  const phone = accountPhone ? ` (${accountPhone})` : '';
  return name ? `${name}${phone}` : `аккаунт${phone}`;
}

async function notifyOperators({ accountId, accountPhone, accountName, peerId, peerUsername, voiceFile, consentMessage }) {
  if (!TELEGRAM_API) {
    console.error('[helpRequestNotifier] BOT_TOKEN не задан — уведомление не отправлено.');
    return;
  }

  const subscribers = await getLeadNotifyChatIds(accountId);
  if (subscribers.length === 0) {
    console.log(
      `[helpRequestNotifier] Собеседник согласился помочь (аккаунт №${accountId}), ` +
        'но нет подписчиков (владелец/делегаты не в /start).',
    );
    return;
  }

  const peerLabel = peerUsername ? `@${peerUsername} (id ${peerId})` : `id ${peerId}`;
  const accountLabel = formatAccountLabel(accountId, accountPhone, accountName);
  const card =
    '<b>✅ Собеседник согласился помочь</b>\n\n' +
    `<b>Аккаунт:</b> ${escapeHtml(accountLabel)}\n` +
    `<b>Собеседник:</b> ${escapeHtml(peerLabel)}\n` +
    `<b>Голосовое:</b> ${escapeHtml(voiceFile)}\n` +
    `<b>Ответ собеседника:</b> «${escapeHtml(consentMessage.slice(0, 500))}»`;

  for (const { chat_id } of subscribers) {
    try {
      const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text: card, parse_mode: 'HTML' }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[helpRequestNotifier] sendMessage failed для ${chat_id}:`, body);
      }
    } catch (err) {
      console.error(`[helpRequestNotifier] Не удалось отправить уведомление ${chat_id}:`, err.message);
    }
  }
}

/**
 * Лид «готов» (предложка / оператор): короткий дайджест диалога владельцу.
 */
async function notifyLeadReady({
  accountId,
  accountPhone,
  accountName,
  peerId,
  peerUsername,
  reason,
  digest,
}) {
  if (!TELEGRAM_API) {
    console.error('[helpRequestNotifier] BOT_TOKEN не задан — дайджест не отправлен.');
    return false;
  }

  const subscribers = await getLeadNotifyChatIds(accountId);
  if (subscribers.length === 0) {
    console.log(
      `[helpRequestNotifier] Лид готов (аккаунт №${accountId}), но нет подписчиков (владелец/делегаты).`,
    );
    return false;
  }

  const peerLabel = peerUsername
    ? `@${String(peerUsername).replace(/^@/, '')} (id ${peerId})`
    : `id ${peerId}`;
  const accountLabel = formatAccountLabel(accountId, accountPhone, accountName);
  const reasonLabel =
    reason === 'nft_voice_sent' || reason === 'pitch'
      ? 'предложка'
      : reason === 'operator'
        ? 'оператор'
        : String(reason || 'готов');
  const digestBlock = String(digest || '')
    .split('\n')
    .filter(Boolean)
    .slice(-10)
    .map((line) => escapeHtml(line))
    .join('\n');

  const card =
    '<b>🔥 Лид готов</b>\n\n' +
    `<b>Этап:</b> ${escapeHtml(reasonLabel)}\n` +
    `<b>Аккаунт:</b> ${escapeHtml(accountLabel)}\n` +
    `<b>Собеседник:</b> ${escapeHtml(peerLabel)}\n` +
    (digestBlock ? `\n<b>Диалог:</b>\n<pre>${digestBlock}</pre>` : '') +
    '\n\nИИ на паузе в этом чате — дальше оператор.';

  let ok = false;
  for (const { chat_id } of subscribers) {
    try {
      const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text: card, parse_mode: 'HTML' }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[helpRequestNotifier] leadReady failed для ${chat_id}:`, body);
      } else {
        ok = true;
      }
    } catch (err) {
      console.error(`[helpRequestNotifier] leadReady error ${chat_id}:`, err.message);
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// БОТ-УВЕДОМИТЕЛЬ (long polling, /start подписывает оператора)
// ---------------------------------------------------------------------------

let pollingOffset = 0;
let pollingActive = false;

async function handleUpdate(update) {
  const adminMenu = require('./adminMenu');
  const workerConnect = require('./workerConnect');

  if (update.callback_query) {
    const data = String(update.callback_query.data || '');
    if (data.startsWith('wrk:')) {
      await workerConnect.handleCallback(TELEGRAM_API, update.callback_query);
      return;
    }
    await adminMenu.handleCallback(TELEGRAM_API, update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg || !msg.chat) return;

  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();
  const from = msg.from;
  await require('./operatorAccess').isAdmin(chatId, from?.username).catch(() => false);
  const isAdmin = adminMenu.isAdminChat(chatId);

  if (msg.from?.username) {
    await db
      .execute('UPDATE users SET username = ? WHERE telegram_user_id = ? AND NOT (username <=> ?)', [
        msg.from.username,
        String(msg.from.id),
        msg.from.username,
      ])
      .catch(() => {});
  }

  // Мастер подключения аккаунта (телефон / код / 2FA) — до админ-текста
  if (text && (await workerConnect.handleText(TELEGRAM_API, chatId, text, from))) return;

  if (isAdmin && text && (await adminMenu.handleAdminText(TELEGRAM_API, chatId, text))) return;

  if ((text.split(/\s+/)[0] || '').split('@')[0] === '/connect') {
    try {
      await workerConnect.startWizard(TELEGRAM_API, chatId, from);
    } catch (err) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `Не удалось начать: ${err.message || 'ошибка'}`,
        }),
      });
    }
    return;
  }

  if (text === '/menu' || text === '/admin') {
    if (isAdmin) {
      await adminMenu.sendMenu(TELEGRAM_API, chatId);
      return;
    }
    try {
      if (await workerConnect.canConnectAccounts(chatId, from?.username)) {
        await workerConnect.sendWorkerMenu(TELEGRAM_API, chatId);
      } else {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: 'Нет доступа к меню. Нужна роль воркера.',
          }),
        });
      }
    } catch (err) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `Не удалось открыть меню: ${err.message || 'ошибка'}`,
        }),
      });
    }
    return;
  }

  if (text === '/start' || text.startsWith('/start ')) {
    const [[blocked]] = await db.execute(
      'SELECT id FROM users WHERE telegram_user_id = ? AND is_blocked = 1 LIMIT 1',
      [chatId],
    );
    if (blocked) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: 'Доступ закрыт.' }),
      });
      return;
    }
    await ensureSchema();
    await db.execute(
      `INSERT INTO notification_subscribers (chat_id, username)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE username = VALUES(username)`,
      [chatId, msg.chat.username || msg.from?.username || null],
    );
    const canConnect = await workerConnect.canConnectAccounts(chatId, from?.username);
    const payload = {
      chat_id: chatId,
      text:
        'Готово! Теперь сюда будут приходить уведомления, когда собеседник соглашается ' +
        'помочь после голосового сообщения.\n\nЧтобы отписаться — /stop' +
        (canConnect && !isAdmin
          ? '\n\nЧтобы подключить рабочий аккаунт — /connect'
          : ''),
      parse_mode: 'HTML',
    };
    const keyboard = [];
    if (canConnect) {
      keyboard.push([{ text: '📲 Подключить аккаунт', callback_data: 'wrk:connect' }]);
      keyboard.push([{ text: '🗑 Мои номера', callback_data: 'wrk:my' }]);
      keyboard.push([{ text: '🔔 Уведомления', callback_data: 'wrk:ntf' }]);
    }
    if (MINIAPP_URL) {
      keyboard.push([{ text: 'Открыть приложение', web_app: { url: MINIAPP_URL } }]);
    }
    if (keyboard.length) payload.reply_markup = { inline_keyboard: keyboard };
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (isAdmin) await adminMenu.sendMenu(TELEGRAM_API, chatId);
  } else if (text === '/stop') {
    await db.execute('DELETE FROM notification_subscribers WHERE chat_id = ?', [chatId]);
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: 'Уведомления отключены.' }),
    });
  }
}

async function pollOnce() {
  const res = await fetch(
    `${TELEGRAM_API}/getUpdates?timeout=25&offset=${pollingOffset}` +
      `&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'callback_query']))}`,
  );
  if (!res.ok) throw new Error(`getUpdates HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok || !Array.isArray(data.result)) return;

  for (const update of data.result) {
    pollingOffset = update.update_id + 1;
    await handleUpdate(update).catch((err) =>
      console.error('[helpRequestNotifier] Ошибка обработки обновления:', err.message),
    );
  }
}

/**
 * Запускает фоновый long-polling для бота-уведомителя (BOT_TOKEN_2).
 * Безопасно вызывать один раз при старте сервера. Если BOT_TOKEN_2 не задан,
 * просто ничего не делает.
 */
function startNotificationBot() {
  if (!TELEGRAM_API) {
    console.log('[helpRequestNotifier] BOT_TOKEN не задан — бот-уведомитель не запущен.');
    return;
  }
  if (pollingActive) return;
  pollingActive = true;

  ensureSchema().catch((err) =>
    console.error('[helpRequestNotifier] Не удалось создать таблицы:', err.message),
  );

  require('./adminMenu')
    .registerCommands(TELEGRAM_API)
    .catch((err) => console.error('[helpRequestNotifier] setMyCommands:', err.message));

  console.log('[helpRequestNotifier] Бот-уведомитель запущен (long polling).');

  let failStreak = 0;
  let lastLogAt = 0;
  const loop = async () => {
    while (pollingActive) {
      try {
        await pollOnce();
        failStreak = 0;
      } catch (err) {
        failStreak += 1;
        // Экспоненциальный backoff: 5с → 10с → … → 5мин (сеть/DNS часто мигает).
        const waitMs = Math.min(5 * 60 * 1000, 5000 * 2 ** Math.min(failStreak - 1, 6));
        const now = Date.now();
        // Не чаще раза в 5 минут — иначе fetch failed забивает err при мигающей сети.
        if (now - lastLogAt > 300000) {
          console.error(
            `[helpRequestNotifier] Ошибка long polling (×${failStreak}, пауза ${Math.round(waitMs / 1000)}с):`,
            err.message,
          );
          lastLogAt = now;
        }
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  };
  loop();
}

// ---------------------------------------------------------------------------
// ТРЕВОГА: OpenAI НЕ ОТВЕЧАЕТ ИЗ-ЗА ДЕНЕГ / КЛЮЧА
// ---------------------------------------------------------------------------

const OPENAI_ALERT_REPEAT_MS = 30 * 60 * 1000;
// Только админу (@fallonsociapat). По chat_id: username в Telegram меняется.
const ADMIN_ALERT_CHAT_ID = process.env.ADMIN_ALERT_CHAT_ID || '8588744561';
const openAiAlert = { active: false, kind: null, sentAt: 0, lost: 0 };

// Счётчики ошибок ответов с момента запуска процесса — для админ-меню.
const openAiErrors = { since: Date.now(), billing: 0, auth: 0, rate_limit: 0, other: 0, last: null };

function noteOpenAiError(err) {
  const status = err?.status || err?.response?.status;
  const kind = classifyOpenAiError(err) || (status === 429 ? 'rate_limit' : 'other');
  openAiErrors[kind] += 1;
  openAiErrors.last = { kind, at: Date.now(), message: String(err?.message || '').slice(0, 200) };
}

function getOpenAiHealth() {
  return { errors: { ...openAiErrors }, alert: { ...openAiAlert } };
}

/** 'billing' — кончились кредиты, 'auth' — ключ не принимают, иначе null. */
function classifyOpenAiError(err) {
  const status = err?.status || err?.response?.status;
  const code = String(err?.code || err?.error?.code || '');
  const msg = String(err?.message || '');
  if (code === 'insufficient_quota' || /no credits remaining|exceeded your current quota|billing/i.test(msg)) {
    return 'billing';
  }
  if (status === 401 || code === 'invalid_api_key' || /incorrect api key|invalid api key/i.test(msg)) {
    return 'auth';
  }
  return null;
}

async function sendAdminAlert(text) {
  if (!TELEGRAM_API) {
    console.error('[helpRequestNotifier] BOT_TOKEN не задан — тревога OpenAI не отправлена.');
    return;
  }
  const chatId = ADMIN_ALERT_CHAT_ID;
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) console.error(`[helpRequestNotifier] Тревога OpenAI не ушла админу ${chatId}:`, await res.text());
  } catch (err) {
    console.error(`[helpRequestNotifier] Тревога OpenAI не ушла админу ${chatId}:`, err.message);
  }
}

/**
 * Ответ собеседнику не сгенерирован из-за денег/ключа OpenAI. Шлёт тревогу
 * сразу и повторяет не чаще раза в 30 минут, пока проблема не уйдёт.
 * @returns {boolean} true, если ошибка из этой категории.
 */
function reportOpenAiFailure(err) {
  const kind = classifyOpenAiError(err);
  if (!kind) return false;
  openAiAlert.lost += 1;
  const now = Date.now();
  if (openAiAlert.active && openAiAlert.kind === kind && now - openAiAlert.sentAt < OPENAI_ALERT_REPEAT_MS) {
    return true;
  }
  Object.assign(openAiAlert, { active: true, kind, sentAt: now });
  const title =
    kind === 'billing'
      ? '⚠️ OpenAI: закончились деньги на балансе'
      : '⚠️ OpenAI: ключ API не принимается';
  const action =
    kind === 'billing'
      ? 'Пополни баланс: https://platform.openai.com/settings/organization/billing'
      : 'Проверь OPENAI_API_KEY в .env на сервере.';
  const text =
    `<b>${title}</b>\n\n` +
    'ИИ сейчас не может отвечать — сообщения собеседников остаются без ответа.\n' +
    `Без ответа за время сбоя: <b>${openAiAlert.lost}</b>\n` +
    'Пока не починится — буду напоминать раз в 30 минут.\n\n' +
    `${action}\n\n` +
    `<code>${escapeHtml(String(err?.message || '').slice(0, 200))}</code>`;
  console.error(`[helpRequestNotifier] ${title} — отправляю тревогу.`);
  sendAdminAlert(text).catch((e) =>
    console.error('[helpRequestNotifier] Не удалось отправить тревогу OpenAI:', e.message),
  );
  return true;
}

/** Первый успешный ответ после тревоги — сообщаем, что всё снова работает. */
function reportOpenAiRecovered() {
  if (!openAiAlert.active) return;
  const lost = openAiAlert.lost;
  Object.assign(openAiAlert, { active: false, kind: null, sentAt: 0, lost: 0 });
  sendAdminAlert(
    '<b>✅ OpenAI снова работает</b>\n\nИИ опять отвечает собеседникам.' +
      (lost ? `\nЗа время сбоя без ответа осталось: <b>${lost}</b>` : ''),
  ).catch((e) => console.error('[helpRequestNotifier] Не удалось отправить «OpenAI снова работает»:', e.message));
}

module.exports = {
  ensureSchema,
  recordVoiceSent,
  checkConsent,
  startNotificationBot,
  reportOpenAiFailure,
  reportOpenAiRecovered,
  classifyOpenAiError,
  noteOpenAiError,
  getOpenAiHealth,
  disableAutoreplyForPeer,
  isAutoreplyDisabledForPeer,
  enableAutoreplyForPeer,
  notifyLeadReady,
  getLeadNotifyChatIds,
  listNotifyDelegates,
  addNotifyDelegate,
  removeNotifyDelegate,
  resolveSubscriberByUsername,
  isNotificationSubscriber,
};
