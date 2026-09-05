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
  })();
  return schemaReady;
}

// ---------------------------------------------------------------------------
// ФИКСАЦИЯ ОТПРАВКИ ГОЛОСОВОГО С ПРОСЬБОЙ
// ---------------------------------------------------------------------------

/**
 * Вызывается сразу после того, как собеседнику реально ушло голосовое с
 * просьбой о помощи. Открывает "окно ожидания согласия" для этой пары
 * аккаунт+собеседник.
 */
async function recordVoiceSent(accountId, peerId, peerUsername, voiceFile) {
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
  } catch (err) {
    console.error('[helpRequestNotifier] Не удалось зафиксировать отправку голосового:', err.message);
  }
}

// ---------------------------------------------------------------------------
// ОПРЕДЕЛЕНИЕ СОГЛАСИЯ
// ---------------------------------------------------------------------------

// Быстрые ключевые слова согласия — если есть явное совпадение, не тратим
// токены на AI-запрос и сразу считаем согласием.
const AGREE_KEYWORDS_RE =
  /\b(да|ладно|ок|окей|хорошо|конечно|давай|помогу|сделаю|скину|отправлю|переведу|пришлю|отправл(ю|яю)|перевед(у|ем)|no problem|sure|ok|okay|yes)\b/i;

// Явные слова отказа — если есть, согласием не считаем, даже если рядом
// встретилось слово из списка выше ("да ну нет", "нет, не буду").
const REFUSE_KEYWORDS_RE = /\b(нет|не буду|не могу|не хочу|не сейчас|not now|can'?t|won'?t|no)\b/i;

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
async function checkConsent(accountId, peerId, peerUsername, accountPhone, incomingText) {
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
    const hasKeyword = !hasRefusal && AGREE_KEYWORDS_RE.test(incomingText);

    const agreed = hasKeyword || (!hasRefusal && (await aiDetectAgreement(incomingText)));
    if (!agreed) return;

    await db.execute(
      `UPDATE help_requests SET status = 'agreed', consent_message = ?, resolved_at = NOW()
       WHERE id = ?`,
      [incomingText.slice(0, 500), pending.id],
    );

    await notifyOperators({
      accountId,
      accountPhone,
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

async function notifyOperators({ accountId, accountPhone, peerId, peerUsername, voiceFile, consentMessage }) {
  if (!TELEGRAM_API) {
    console.error('[helpRequestNotifier] BOT_TOKEN не задан — уведомление не отправлено.');
    return;
  }

  const [subscribers] = await db.execute('SELECT chat_id FROM notification_subscribers');
  if (subscribers.length === 0) {
    console.log(
      '[helpRequestNotifier] Собеседник согласился помочь, но нет подписчиков на уведомления ' +
        '(никто не написал /start уведомляющему боту).',
    );
    return;
  }

  const peerLabel = peerUsername ? `@${peerUsername} (id ${peerId})` : `id ${peerId}`;
  const card =
    `<b>✅ Собеседник согласился помочь</b>\n\n` +
    `<b>��ккаунт:</b> №${accountId} (${escapeHtml(accountPhone || '—')})\n` +
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

// ---------------------------------------------------------------------------
// БОТ-УВЕДОМИТЕЛЬ (long polling, /start подписывает оператора)
// ---------------------------------------------------------------------------

let pollingOffset = 0;
let pollingActive = false;

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.chat) return;

  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  if (text === '/start') {
    await ensureSchema();
    await db.execute(
      `INSERT INTO notification_subscribers (chat_id, username)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE username = VALUES(username)`,
      [chatId, msg.chat.username || msg.from?.username || null],
    );
    const payload = {
      chat_id: chatId,
      text:
        'Готово! Теперь сюда будут приходить уведомления, когда собеседник соглашается ' +
        'помочь после голосового сообщения.\n\nЧтобы отписаться — /stop',
    };
    if (MINIAPP_URL) {
      payload.reply_markup = {
        inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: MINIAPP_URL } }]],
      };
    }
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
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
    `${TELEGRAM_API}/getUpdates?timeout=25&offset=${pollingOffset}`,
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
    console.log('[helpRequestNotifier] BOT_TOKEN_2 не задан — бот-уведомитель не запущен.');
    return;
  }
  if (pollingActive) return;
  pollingActive = true;

  ensureSchema().catch((err) =>
    console.error('[helpRequestNotifier] Не удалось создать таблицы:', err.message),
  );

  console.log('[helpRequestNotifier] Бот-уведомитель запущен (long polling).');

  const loop = async () => {
    while (pollingActive) {
      try {
        await pollOnce();
      } catch (err) {
        console.error('[helpRequestNotifier] Ошибка long polling:', err.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  loop();
}

module.exports = {
  ensureSchema,
  recordVoiceSent,
  checkConsent,
  startNotificationBot,
};
