/**
 * ОБРАБОТКА ВОЗРАЖЕНИЙ + напоминание при молчании 2-3 дня.
 *
 * Детекция возражений — ключевыми словами по входящему тексту (текст уже
 * расшифрован из голосовых на этапе extractIncomingText в telegramClient.js).
 * Даёт модели готовую подсказку, КАК среагировать — сам ответ всё равно
 * генерирует AI, чтобы звучало естественно в контексте конкретного диалога.
 */

const db = require('../db');
// require отложенный (внутри функции), а не на верхнем уровне: telegramClient.js
// сам подключает objectionHandler.js при загрузке, поэтому обратный require здесь
// в начале файла привёл бы к undefined из-за циклической зависимости модулей.

const OBJECTION_PATTERNS = [
  {
    type: 'scam',
    re: /(развод|скам|мошен|кинешь|кинула|кину\b|обман|это лохотрон|поймали лоха)/i,
    hint:
      'Собеседник намекает, что это обман/скам/развод. Отреагируй легко, без паники и оправданий — ' +
      'в духе «хаха, ок) я просто поделилась» — и мягко переведи разговор дальше, не настаивай и не убеждай.',
  },
  {
    type: 'no_money',
    re: /(нет денег|денег нет|без денег|не на что|финансово не могу|у меня нету|деньг[аи] сейчас нет)/i,
    hint:
      'Собеседник говорит, что у него нет денег. Ответь буднично, без давления, например что сама заходила ' +
      'с небольшой суммы (около 50 долларов) — просто поделись опытом, не проси и не настаивай.',
  },
  {
    type: 'dont_understand',
    re: /(не шар[ю|ишь]|не разбираюсь в этом|не понимаю в этом|первый раз слышу про (нфт|токен))/i,
    hint:
      'Собеседник говорит, что не разбирается в теме. Ответь, что ты тоже раньше не шарила, и можешь ' +
      'показать/подсказать, если он захочет — без давления, решение оставь ему.',
  },
  {
    type: 'later',
    re: /(потом|позже|не сейчас|напиши завтра|напомни мне|давай в другой раз)/i,
    hint:
      'Собеседник просит вернуться к теме позже. Согласись спокойно, без напоминаний и давления — ' +
      'просто прими это буднично.',
  },
];

// Детект «бот/ИИ» и запрос контактов — часть анти-детект логики, но
// возражения и анти-детект имеют общую механику (ключевые слова -> подсказка),
// поэтому удобно держать один детектор.
const BOT_ACCUSATION_RE = /(ты бот|это бот|бот ли ты|искусственный интеллект|нейросеть|\bии\b|chatgpt|gpt[- ]?\d|ты не человек)/i;
const CONTACT_REQUEST_RE = /(номер телефона|дай (свой )?номер|скинь номер|скинь инст|инстаграм|whatsapp|ватсап|вотсап|как тебя найти|где тебя найти|твой телеграм|дай контакт)/i;

/**
 * Возвращает подсказку для промпта на основе входящего текста: возражение
 * (по NFT-теме) либо анти-детект ситуация (обвинение в боте / запрос контактов).
 * Возвращает null, если ничего не найдено.
 */
function detectHint(text) {
  if (!text) return null;

  if (BOT_ACCUSATION_RE.test(text)) {
    return (
      'Собеседник намекает, что ты бот/ИИ/нейросеть. Обидься по-человечески, коротко, и переведи тему — ' +
      'НЕ подтверждай, не оправдывайся длинно, не объясняй. Просто лёгкая обида + смена темы.'
    );
  }

  if (CONTACT_REQUEST_RE.test(text)) {
    return (
      'Собеседник просит твои контакты (номер/инстаграм/whatsapp/телеграм). Мягко откажи, без грубости — ' +
      'например «не даю пока, давай тут общаться)» — и не давай никаких реальных контактов.'
    );
  }

  const objection = OBJECTION_PATTERNS.find((p) => p.re.test(text));
  return objection ? objection.hint : null;
}

// ---------------------------------------------------------------------------
// НАПОМИНАНИЕ ПРИ МОЛЧАНИИ 2-3 ДНЯ: «привет, чё молчиш)»
// ---------------------------------------------------------------------------

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS silence_pings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      last_message_at DATETIME NOT NULL,
      pinged_at DATETIME NOT NULL,
      UNIQUE KEY uniq_account_peer_last (account_id, peer_id, last_message_at)
    )
  `);
  return schemaReady;
}

const SILENCE_PINGS = ['привет, чё молчиш)', 'ау, ты живой?)', 'привет) ты пропал'];

async function archiveSilentDialogs() {
  try {
    const { getActiveClient, archivePeer } = require('./telegramClient');
    const [rows] = await db.execute(`
      SELECT
        cm.account_id,
        cm.peer_id,
        cm.peer_username,
        MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_incoming_at,
        MAX(cm.created_at) AS last_message_at
      FROM conversation_messages cm
      GROUP BY cm.account_id, cm.peer_id, cm.peer_username
      HAVING last_incoming_at <= (NOW() - INTERVAL 2 DAY)
        AND last_message_at > last_incoming_at
    `);

    for (const row of rows) {
      try {
        const { getActiveClient } = require('./telegramClient');
        const client = getActiveClient(row.account_id);
        if (!client) continue;

        const entity = await client.getEntity(row.peer_username || row.peer_id);
        if (await archivePeer(client, entity)) {
          console.log(
            `[Аккаунт ${row.account_id}] Диалог ${row.peer_username || row.peer_id} ` +
              'перемещён в архив после 2 дней без ответа.',
          );
        }
      } catch (err) {
        console.error(
          `[Аккаунт ${row.account_id}] Не удалось архивировать ${row.peer_username || row.peer_id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error('[objectionHandler] Ошибка архивирования молчащих диалогов:', err.message);
  }
}

async function sendSilencePings({ getAccountSettings, isWithinWorkingHours, isAutoreplyDisabledForPeer, saveMessage }) {
  const { getActiveClient } = require('./telegramClient');
  try {
    await ensureSchema();
    if (!isWithinWorkingHours()) return;

    const [rows] = await db.execute(`
      SELECT cm.account_id, cm.peer_id, cm.peer_username, MAX(cm.created_at) AS last_at
      FROM conversation_messages cm
      GROUP BY cm.account_id, cm.peer_id
      HAVING last_at <= (NOW() - INTERVAL 2 DAY) AND last_at >= (NOW() - INTERVAL 3 DAY)
    `);

    for (const row of rows) {
      try {
        // Уже отвечал оператор вручную (после nft-голосового) — ИИ сюда не лезет.
        if (await isAutoreplyDisabledForPeer(row.account_id, row.peer_id)) continue;

        const settings = await getAccountSettings(row.account_id);
        if (!settings || !settings.is_autoreply_enabled) continue;

        const [[already]] = await db.execute(
          `SELECT id FROM silence_pings WHERE account_id = ? AND peer_id = ? AND last_message_at = ? LIMIT 1`,
          [row.account_id, row.peer_id, row.last_at],
        );
        if (already) continue;

        const client = getActiveClient(row.account_id);
        if (!client) continue;

        const entity = await client.getEntity(row.peer_username || row.peer_id);
        const text = SILENCE_PINGS[Math.floor(Math.random() * SILENCE_PINGS.length)];
        await client.sendMessage(entity, { message: text });
        await saveMessage(row.account_id, row.peer_id, row.peer_username, 'assistant', text);

        await db.execute(
          `INSERT INTO silence_pings (account_id, peer_id, last_message_at, pinged_at) VALUES (?, ?, ?, NOW())`,
          [row.account_id, row.peer_id, row.last_at],
        );

        console.log(`[Аккаунт ${row.account_id}] Напоминание о молчании отправлено ${row.peer_username || row.peer_id}.`);
      } catch (err) {
        console.error(`[Аккаунт ${row.account_id}] Ошибка отправки напоминания о молчании:`, err.message);
      }
    }
  } catch (err) {
    console.error('[objectionHandler] Ошибка планировщика напоминаний о молчании:', err.message);
  }
}

let schedulerStarted = false;

/**
 * Запускает фоновый планировщик напоминаний при молчании 2-3 дня. Принимает
 * зависимости из telegramClient.js, чтобы не создавать циклический require.
 */
function startSilenceScheduler(deps) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    sendSilencePings(deps).catch((err) => console.error('[objectionHandler] silence tick error:', err.message));
    archiveSilentDialogs(deps).catch((err) => console.error('[objectionHandler] archive tick error:', err.message));
  };
  tick();
  setInterval(tick, 30 * 60 * 1000);
}

module.exports = { detectHint, startSilenceScheduler };
