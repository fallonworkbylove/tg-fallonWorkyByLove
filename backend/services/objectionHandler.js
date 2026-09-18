/**
 * ОБРАБОТКА ВОЗРАЖЕНИЙ + архив молчащих диалогов и короткое голосовое
 * «как проходит день» в первые сутки знакомства.
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
// МОЛЧАНИЕ: архив через 2 дня без ответа собеседника + голосовое в первые сутки
// ---------------------------------------------------------------------------

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS silence_voice_daily (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      sent_date DATE NOT NULL,
      sent TINYINT NOT NULL,
      decided_at DATETIME NOT NULL,
      UNIQUE KEY uniq_account_peer_day (account_id, peer_id, sent_date)
    )
  `);
  return schemaReady;
}

// Готовое голосовое «как проходит день» — если собеседник не отвечает
// 2-4 часа, раз в сутки бросаем монетку (50%) и, если выпало «отправить»,
// шлём голосовое. Только в первые 2 дня знакомства (до старта NFT-кампании
// на 3-й день — см. NFT_VOICE_AFTER_HOURS в telegramClient.js), чтобы не
// конфликтовать с NFT-голосовым.
const SILENCE_VOICE_FILE = 'kak_prohodit_den.ogg';
// Возраст диалога, до которого действует это напоминание (первые 2 дня).
const SILENCE_VOICE_MAX_DIALOG_AGE_HOURS = 48;
// Окно молчания, в которое можно бросить монетку и отправить голосовое.
const SILENCE_VOICE_WINDOW_MIN_HOURS = 2;
const SILENCE_VOICE_WINDOW_MAX_HOURS = 4;
// Шанс отправки при попадании в окно молчания — раз в сутки на диалог.
const SILENCE_VOICE_CHANCE = 0.5;

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
    // Собеседник не писал двое суток — сразу в архив, без текстовых пингов.
    const [rows] = await db.execute(`
      SELECT
        cm.account_id,
        cm.peer_id,
        MAX(cm.peer_username) AS peer_username,
        MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_incoming_at
      FROM conversation_messages cm
      GROUP BY cm.account_id, cm.peer_id
      HAVING last_incoming_at IS NOT NULL
        AND last_incoming_at <= (NOW() - INTERVAL 2 DAY)
    `);

    for (const row of rows) {
      try {
        const client = getActiveClient(row.account_id);
        if (!client) continue;

        const entity = await resolveArchiveEntity(client, row.peer_id, row.peer_username);
        if (await archivePeer(client, entity)) {
          console.log(
            `[Аккаунт ${row.account_id}] Диалог ${row.peer_username || row.peer_id} ` +
              'перемещён в архив после 2 дней без ответа собеседника.',
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

/**
 * Раз в сутки на диалог: если собеседник молчит 2-4 часа, бросаем монетку
 * (50%) и, если выпало «отправить», шлём голосовое «как проходит день».
 * Работает только в первые 2 дня знакомства — с 3-го дня тему ведёт
 * NFT-кампания (getNftCampaignState в telegramClient.js), и голосовые не
 * должны пересекаться.
 */
async function sendSilenceVoiceReminders({ getAccountSettings, isWithinWorkingHours, isAutoreplyDisabledForPeer, saveMessage }) {
  const {
    getActiveClient,
    shouldSkipProactivePeer,
    isPermanentSendError,
    retireUnreachablePeer,
  } = require('./telegramClient');
  const { Api } = require('telegram');
  try {
    await ensureSchema();

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
    // бы точку отсчёта тишины.
    const [rows] = await db.execute(`
      SELECT
        cm.account_id,
        cm.peer_id,
        MAX(cm.peer_username) AS peer_username,
        MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_incoming_at,
        MAX(cm.created_at) AS last_message_at,
        MIN(cm.created_at) AS started_at
      FROM conversation_messages cm
      GROUP BY cm.account_id, cm.peer_id
      HAVING last_incoming_at IS NOT NULL
        AND last_message_at > last_incoming_at
        AND last_incoming_at <= (NOW() - INTERVAL ${SILENCE_VOICE_WINDOW_MIN_HOURS} HOUR)
        AND last_incoming_at >= (NOW() - INTERVAL ${SILENCE_VOICE_WINDOW_MAX_HOURS} HOUR)
        AND started_at >= (NOW() - INTERVAL ${SILENCE_VOICE_MAX_DIALOG_AGE_HOURS} HOUR)
    `);

    for (const row of rows) {
      let entity = null;
      const client = getActiveClient(row.account_id);
      try {
        if (await isAutoreplyDisabledForPeer(row.account_id, row.peer_id)) continue;

        const settings = await getAccountSettings(row.account_id);
        if (!settings || !settings.is_autoreply_enabled) continue;
        if (!isWithinWorkingHours(row.account_id)) continue;

        // Решение (бросок монетки) принимается максимум один раз в
        // календарные сутки на диалог — вне зависимости от того, сколько
        // раз за день собеседник попадал в окно 2-4ч молчания.
        const [[already]] = await db.execute(
          `SELECT id FROM silence_voice_daily
           WHERE account_id = ? AND peer_id = ? AND sent_date = CURDATE() LIMIT 1`,
          [row.account_id, row.peer_id],
        );
        if (already) continue;

        const shouldSend = Math.random() < SILENCE_VOICE_CHANCE;

        // Решение фиксируем сразу (даже если монетка сказала «не отправлять»),
        // чтобы следующий тик планировщика (каждые 30 минут) не бросал её
        // повторно в течение того же дня.
        await db.execute(
          `INSERT INTO silence_voice_daily (account_id, peer_id, sent_date, sent, decided_at)
           VALUES (?, ?, CURDATE(), ?, NOW())`,
          [row.account_id, row.peer_id, shouldSend ? 1 : 0],
        );

        if (!shouldSend) continue;

        if (!client) continue;

        entity = await client.getEntity(row.peer_username || Number(row.peer_id) || row.peer_id);
        if (await shouldSkipProactivePeer(client, entity)) continue;

        try {
          await client.invoke(
            new Api.messages.SetTyping({ peer: entity, action: new Api.SendMessageRecordAudioAction() }),
          );
        } catch (_) {
          // Индикатор «записывает голосовое» не критичен.
        }

        await sendVoiceReply(client, entity, voicePath);
        await saveMessage(row.account_id, row.peer_id, row.peer_username, 'assistant', `[голосовое: ${SILENCE_VOICE_FILE}]`);

        console.log(
          `[Аккаунт ${row.account_id}] Голосовое «как проходит день» отправлено ${row.peer_username || row.peer_id} ` +
            '(молчание 2-4ч, монетка 50%).',
        );
      } catch (err) {
        console.error(
          `[Аккаунт ${row.account_id}] Ошибка отправки голосового напоминания ${row.peer_username || row.peer_id}:`,
          err.message,
        );
        if (client && isPermanentSendError(err)) {
          await retireUnreachablePeer(
            client,
            row.account_id,
            row.peer_id,
            entity,
            err.errorMessage || err.message || 'unreachable',
          );
        }
      }
    }
  } catch (err) {
    console.error('[objectionHandler] Ошибка планировщика голосовых напоминаний о молчании:', err.message);
  }
}

let schedulerStarted = false;

/**
 * Фоновый цикл: архив после 2 дней без входящих и голосовое в первые сутки.
 * Зависимости из telegramClient.js, чтобы не было циклического require.
 */
function startSilenceScheduler(deps) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    archiveSilentDialogs(deps)
      .catch((err) => console.error('[objectionHandler] archive tick error:', err.message))
      .then(() => sendSilenceVoiceReminders(deps))
      .catch((err) => console.error('[objectionHandler] silence voice tick error:', err.message));
  };
  tick();
  setInterval(tick, 30 * 60 * 1000);
}

module.exports = { detectHint, startSilenceScheduler };
