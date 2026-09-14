/**
 * ОБРАБОТКА ВОЗРАЖЕНИЙ + напоминание при молчании 2-3 дня.
 *
 * Детекция возражений — ключевыми словами по входящему тексту (текст уже
 * расшифрован из голосовых на этапе extractIncomingText в telegramClient.js).
 * Даёт модели готовую подсказку, КАК среагировать — сам ответ всё равно
 * генерирует AI, чтобы звучало естественно в контексте конкретного диалога.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
// require отложенный (внутри функции), а не на верхнем уровне: telegramClient.js
// сам подключает objectionHandler.js при загрузке, поэтому обратный require здесь
// в начале файла привёл бы к undefined из-за циклической зависимости модулей.
// voiceReplies.js ни от telegramClient.js, ни от objectionHandler.js не зависит,
// поэтому его можно require-ить сразу.
const { sendVoiceReply, VOICES_DIR } = require('./voiceReplies');

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

// Предложение видео-звонка/созвона по видео — реальный видеоконтакт нужно
// вежливо отклонить под предлогом стеснения, а не соглашаться или игнорировать.
const VIDEO_CALL_REQUEST_RE =
  /(видео\s*созвон|созвон.*видео|видеозвон|видео\s*звон|видеосвяз|по видео созвон|видеочат|видео\s*чат|face\s*?time|facetime)/i;

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

  if (VIDEO_CALL_REQUEST_RE.test(text)) {
    return (
      'Собеседник предлагает созвониться по видео/видеозвонок. Вежливо откажи под предлогом стеснения — ' +
      'например «ой, я стесняюсь на видео, давай лучше тут переписываться)» или «я на видео очень скромная, ' +
      'не люблю созваниваться» — без грубости, без обещаний созвониться позже, и мягко переведи разговор дальше.'
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
  schemaReady = Promise.all([
    db.execute(`
      CREATE TABLE IF NOT EXISTS silence_pings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        last_message_at DATETIME NOT NULL,
        pinged_at DATETIME NOT NULL,
        UNIQUE KEY uniq_account_peer_last (account_id, peer_id, last_message_at)
      )
    `),
    db.execute(`
      CREATE TABLE IF NOT EXISTS silence_voice_reminders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        last_message_at DATETIME NOT NULL,
        stage TINYINT NOT NULL,
        sent_at DATETIME NOT NULL,
        UNIQUE KEY uniq_account_peer_stage_last (account_id, peer_id, stage, last_message_at)
      )
    `),
  ]);
  return schemaReady;
}

const SILENCE_PINGS = ['привет, чё молчиш)', 'ау, ты живой?)', 'привет) ты пропал'];

// Готовое голосовое «как проходит день» — отправляется, если собеседник не
// отвечает на последнее сообщение бота. Только в первые 2 дня знакомства
// (до старта NFT-кампании на 3-й день — см. NFT_VOICE_AFTER_HOURS в
// telegramClient.js), чтобы не конфликтовать с NFT-голосовым и напоминаниями.
const SILENCE_VOICE_FILE = 'kak_prohodit_den.ogg';
// Возраст диалога, до которого действует это напоминание (первые 2 дня).
const SILENCE_VOICE_MAX_DIALOG_AGE_HOURS = 48;
// Стадии по часам молчания: первая через 2 часа, вторая — через 4, если
// собеседник так и не ответил. Больше двух стадий на один период молчания нет.
const SILENCE_VOICE_STAGES = [
  { stage: 1, afterHours: 2 },
  { stage: 2, afterHours: 4 },
];

async function resolveArchiveEntity(client, peerId, peerUsername) {
  const normalizedId = String(peerId || '').trim();
  const normalizedUsername = String(peerUsername || '').trim().replace(/^@/, '');

  // folders.EditPeerFolders — «сырой» MTProto-запрос: ему нужен именно
  // TypeInputPeer (InputPeerUser/Channel/Chat с access_hash), а не обычная
  // сущность User/Channel из getEntity(). client.getInputEntity() возвращает
  // корректный InputPeer и сам обновляет access_hash в кеше сессии.
  if (normalizedUsername) {
    try {
      return await client.getInputEntity(normalizedUsername);
    } catch (usernameError) {
      if (!normalizedId) throw usernameError;
    }
  }

  if (normalizedId && /^-?\d+$/.test(normalizedId)) {
    try {
      return await client.getInputEntity(Number(normalizedId));
    } catch {
      // Игнорируем: ниже попробуем найти сущность среди диалогов.
    }
  }

  // Резервный способ: если ID не резолвится напрямую (устарел/отсутствует
  // в кеше сессии), ищем ту же сущность среди актуальных диалогов — там
  // access_hash точно свежий — и конвертируем её в InputPeer.
  if (normalizedId) {
    const dialogs = await client.getDialogs({ limit: 200 });
    const match = dialogs.find(
      (d) => String(d.id) === normalizedId || String(d.entity?.id) === normalizedId,
    );
    if (match?.entity) return client.getInputEntity(match.entity);
  }

  throw new Error(`Не удалось найти Telegram-сущность по ID ${normalizedId || 'не указан'}`);
}

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
        const client = getActiveClient(row.account_id);
        if (!client) continue;

        const entity = await resolveArchiveEntity(client, row.peer_id, row.peer_username);
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

/**
 * Отправляет заготовленное голосовое «как проходит день», если собеседник не
 * ответил на последнее сообщение бота 2 часа (стадия 1) или 4 часа (стадия 2).
 * Работает только в первые 2 дня знакомства — с 3-го дня тему ведёт
 * NFT-кампания (getNftCampaignState в telegramClient.js), и голосовые не
 * должны пересекаться.
 */
async function sendSilenceVoiceReminders({ getAccountSettings, isWithinWorkingHours, isAutoreplyDisabledForPeer, saveMessage }) {
  const { getActiveClient } = require('./telegramClient');
  const { Api } = require('telegram');
  try {
    await ensureSchema();
    if (!isWithinWorkingHours()) return;

    const voicePath = path.join(VOICES_DIR, SILENCE_VOICE_FILE);
    if (!fs.existsSync(voicePath)) {
      console.error(
        `[objectionHandler] Файл ${SILENCE_VOICE_FILE} не найден в voices/ — голосовое напоминание о молчании не отправлено.`,
      );
      return;
    }

    // ВАЖНО: молчание считаем строго от last_incoming_at — последнего
    // сообщения САМОГО СОБЕСЕДНИКА. last_message_at (последнее сообщение в
    // диалоге вообще) сюда брать нельзя: он включает и собственные голосовые
    // напоминания бота, из-за чего каждое отправленное напоминание сдвигало
    // точку отсчёта тишины и вызывало бесконечный повтор каждые ~2 часа
    // вместо ровно двух напоминаний (2ч и 4ч).
    const [rows] = await db.execute(`
      SELECT
        cm.account_id,
        cm.peer_id,
        cm.peer_username,
        MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_incoming_at,
        MAX(cm.created_at) AS last_message_at,
        MIN(cm.created_at) AS started_at
      FROM conversation_messages cm
      GROUP BY cm.account_id, cm.peer_id, cm.peer_username
      HAVING last_incoming_at IS NOT NULL
        AND last_message_at > last_incoming_at
        AND last_incoming_at <= (NOW() - INTERVAL 2 HOUR)
        AND started_at >= (NOW() - INTERVAL ${SILENCE_VOICE_MAX_DIALOG_AGE_HOURS} HOUR)
    `);

    for (const row of rows) {
      try {
        if (await isAutoreplyDisabledForPeer(row.account_id, row.peer_id)) continue;

        const settings = await getAccountSettings(row.account_id);
        if (!settings || !settings.is_autoreply_enabled) continue;

        const silenceHours = (Date.now() - new Date(row.last_incoming_at).getTime()) / (60 * 60 * 1000);

        // Ищем от старшей стадии к младшей: если бот не работал долго и
        // молчание уже перевалило за 4 часа, шлём сразу вторую стадию, а не
        // догоняем пропущенную первую.
        const due = [...SILENCE_VOICE_STAGES].reverse().find((s) => silenceHours >= s.afterHours);
        if (!due) continue;

        // Дедуп-ключ — last_incoming_at (не меняется, пока собеседник
        // молчит), поэтому каждая стадия отправится максимум один раз за
        // весь период тишины, а не при каждом тике планировщика.
        const [[already]] = await db.execute(
          `SELECT id FROM silence_voice_reminders
           WHERE account_id = ? AND peer_id = ? AND stage = ? AND last_message_at = ? LIMIT 1`,
          [row.account_id, row.peer_id, due.stage, row.last_incoming_at],
        );
        if (already) continue;

        const client = getActiveClient(row.account_id);
        if (!client) continue;

        const entity = await client.getEntity(row.peer_username || row.peer_id);

        try {
          await client.invoke(
            new Api.messages.SetTyping({ peer: entity, action: new Api.SendMessageRecordAudioAction() }),
          );
        } catch (_) {
          // Индикатор «записывает голосовое» не критичен.
        }

        await sendVoiceReply(client, entity, voicePath);
        await saveMessage(row.account_id, row.peer_id, row.peer_username, 'assistant', `[голосовое: ${SILENCE_VOICE_FILE}]`);

        // В колонку last_message_at пишем именно last_incoming_at — это и
        // есть дедуп-ключ, использованный в SELECT-проверке выше.
        await db.execute(
          `INSERT INTO silence_voice_reminders (account_id, peer_id, last_message_at, stage, sent_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [row.account_id, row.peer_id, row.last_incoming_at, due.stage],
        );

        console.log(
          `[Аккаунт ${row.account_id}] Голосовое «как проходит день» (${due.afterHours}ч молчания) ` +
            `отправлено ${row.peer_username || row.peer_id}.`,
        );
      } catch (err) {
        console.error(
          `[Аккаунт ${row.account_id}] Ошибка отправки голосового напоминания ${row.peer_username || row.peer_id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error('[objectionHandler] Ошибка планировщика голосовых напоминаний о молчании:', err.message);
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
    sendSilenceVoiceReminders(deps).catch((err) => console.error('[objectionHandler] silence voice tick error:', err.message));
    archiveSilentDialogs(deps).catch((err) => console.error('[objectionHandler] archive tick error:', err.message));
  };
  tick();
  setInterval(tick, 30 * 60 * 1000);
}

module.exports = { detectHint, startSilenceScheduler };
