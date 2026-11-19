/**
 * NFT-кампания (3 дня): мягкие напоминания про заработок на NFT, а на 3-й день —
 * голосовое nft.ogg с просьбой помочь с токеном.
 *
 * Почему это в коде, а не только в промпте: промпт статичен и не знает, сколько
 * дней длится знакомство. День считаем от начала ТЕКУЩЕЙ сессии диалога
 * (после паузы ≥72ч старые записи в БД не считаются «3-м днём») и передаём
 * модели готовую подсказку. Без активного диалога (человек давно не писал)
 * NFT-кампанию не ведём.
 *
 * Вещи из telegramClient (tgSendMessage, voice locks, buffers) — через configureNftCampaign.
 */
const fs = require('fs');
const path = require('path');
const { Api } = require('telegram');
const db = require('../db');
const helpRequestNotifier = require('./helpRequestNotifier');
const { sendVoiceReply, VOICES_DIR } = require('./voiceReplies');
// objectionHandler — lazy в sanitize (не тянем 1.7k LOC на каждый tick)
const { accountLabel, accountKey, getActiveClient } = require('./clientPool');
const {
  SESSION_GAP_HOURS,
  ACTIVE_DIALOGUE_IDLE_HOURS,
  saveMessage,
  wasVoiceSent,
  getDialogAgeHours,
  getDialogTail,
  lastIncomingAgeMin,
  conversationIsRussian,
  voiceTag,
} = require('./history');
const { sleep, isWithinNftCampaignHours } = require('./timing');
const {
  loadArchiveFlags,
  isHiddenFromReplies,
  shouldSkipProactivePeer,
  isPermanentSendError,
  retireUnreachablePeer,
  isPeerBlacklisted,
  rearchiveOurOnlyWorkChats,
} = require('./peers');

// Имя файла голосового с просьбой помочь с NFT-токеном (кладётся в voices/).
const NFT_VOICE_FILE = 'nft.ogg';
let nftVoiceMissingLogged = false;

/** Fallback архива: не рвём весь тик при AUTH_KEY / FLOOD. complete=false → неизвестных не прячем. */
async function loadArchiveFlagsSafe(client, accountId) {
  try {
    return await loadArchiveFlags(client);
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] архив TG недоступен (${err.errorMessage || err.message}) — fallback DB`,
    );
    const flags = new Map();
    flags.entities = new Map();
    flags.complete = false;
    try {
      const [rows] = await db.execute(
        `SELECT peer_id FROM archived_peers WHERE account_id = ?`,
        [accountId],
      );
      for (const r of rows || []) flags.set(String(r.peer_id), true);
    } catch (_) {
      /* optional */
    }
    return flags;
  }
}

/** Cold tier блокирует только без явного интереса (≥2 hits). */
async function shouldSkipNftForLeadTier(accountId, peerId) {
  try {
    const hh = require('./humanHardening');
    if (await hh.shouldBlockNftPitchAsync(accountId, peerId, '', [])) return true;
    const snap = await require('./leadScoring').getPeerScoreSnapshot(accountId, peerId);
    if (snap?.tier !== 'cold') return false;
    const hits = await hh.getPeerNftInterestHits(accountId, peerId);
    return hits < 2;
  } catch (_) {
    return true;
  }
}

/**
 * «По работе» ушло, а диалог уже мёртвый / слот просрочен сутками —
 * не крутим stuckWorkNoVoice и не держим nft_pending вечно.
 */
const NFT_STALE_VOICE_HOURS = Math.max(
  24,
  Number(process.env.NFT_STALE_VOICE_HOURS) || 48,
);

async function expireStaleNftAfterWork(accountId) {
  try {
    await ensureNftScheduleTable();
    const idleH = Math.max(24, Number(ACTIVE_DIALOGUE_IDLE_HOURS) || 72);
    const [rows] = await db.execute(
      `SELECT nvs.peer_id
       FROM nft_voice_schedule nvs
       WHERE nvs.account_id = ?
         AND nvs.work_mention_sent = 1
         AND (nvs.voice_skip_reason IS NULL OR nvs.voice_skip_reason = '')
         AND NOT EXISTS (
           SELECT 1 FROM conversation_messages cm
           WHERE cm.account_id = nvs.account_id AND cm.peer_id = nvs.peer_id
             AND cm.role = 'assistant'
             AND (cm.content LIKE '%[голосовое: nft.ogg]%' OR cm.content LIKE '%nft.ogg%')
             AND cm.created_at >= COALESCE(nvs.work_mention_at, nvs.scheduled_at)
         )
         AND (
           nvs.scheduled_at < (NOW() - INTERVAL ${Number(NFT_STALE_VOICE_HOURS)} HOUR)
           OR NOT EXISTS (
             SELECT 1 FROM conversation_messages u
             WHERE u.account_id = nvs.account_id AND u.peer_id = nvs.peer_id
               AND u.role = 'user'
               AND u.created_at >= (NOW() - INTERVAL ${idleH} HOUR)
           )
         )
       ORDER BY nvs.scheduled_at ASC
       LIMIT 40`,
      [accountId],
    );
    let n = 0;
    for (const row of rows || []) {
      const peerId = String(row.peer_id);
      await markNftVoiceSkipped(accountId, peerId, 'stale_dialog');
      try {
        await helpRequestNotifier.enableAutoreplyForPeer(accountId, peerId, {
          force: true,
          onlyReasons: ['nft_pending'],
        });
      } catch (_) {
        /* optional */
      }
      n += 1;
    }
    if (n) {
      console.log(
        `[${accountLabel(accountId)}] NFT expire stale after work: ${n}`,
      );
    }
    return n;
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] NFT expire stale:`,
      err.message,
    );
    return 0;
  }
}

/** Просроченный scheduled_at без живого диалога — сдвигаем на +45–90м (не копим вечную очередь). */
async function rescheduleStaleNftSlots(accountId) {
  try {
    await ensureNftScheduleTable();
    const [rows] = await db.execute(
      `SELECT peer_id FROM nft_voice_schedule
       WHERE account_id = ?
         AND scheduled_at < (NOW() - INTERVAL 3 HOUR)
         AND work_mention_sent = 0
       LIMIT 40`,
      [accountId],
    );
    for (const row of rows || []) {
      const delay = 45 * 60 * 1000 + Math.floor(Math.random() * 45 * 60 * 1000);
      await postponeNftVoice(accountId, String(row.peer_id), delay);
    }
    if (rows?.length) {
      console.log(
        `[${accountLabel(accountId)}] NFT reschedule stale slots: ${rows.length}`,
      );
      try {
        require('./opsLiveMetrics').bump('nftReschedule', rows.length);
      } catch (_) {
        /* optional */
      }
    }
  } catch (e) {
    console.error(`[${accountLabel(accountId)}] NFT reschedule:`, e.message);
  }
}
// Голосовое уходит, когда диалогу столько часов (3-й день знакомства).
// После отправки бот полностью замолкает на этом собеседнике.
// NFT-голосовое разрешено только с третьего дня общения.
// Первые 48 часов после старта ТЕКУЩЕЙ сессии диалога всегда исключены.
const NFT_VOICE_AFTER_HOURS = 48;
const NFT_VOICE_LEAD_MIN_MS = 60 * 60 * 1000;
const NFT_VOICE_LEAD_MAX_MS = 2 * 60 * 60 * 1000;
// Одно сообщение «проблему с работой решаю» примерно за 30 минут до голосового.
const NFT_WORK_MENTION_MIN_MS = 10 * 60 * 1000;
const NFT_WORK_MENTION_MAX_MS = 50 * 60 * 1000;
// Пауза без сообщений — старый диалог в БД считаем законченным, возраст с нуля.
const NFT_DIALOG_SESSION_GAP_HOURS = SESSION_GAP_HOURS;
// Нет входящих от человека столько часов — активного диалога нет, NFT не ведём.
const NFT_ACTIVE_DIALOGUE_IDLE_HOURS = ACTIVE_DIALOGUE_IDLE_HOURS;
const WORK_PROBLEM_PHRASES_RU = [
  'я пошла решать проблему с работой, позже напишу)',
  'ой, там по работе затык — пойду разберусь, чуть позже напишу)',
  'мне надо решить одно по работе, чуть позже вернусь)',
  'сейчас убегу по работе разрулить, потом напишу)',
];
const WORK_PROBLEM_PHRASES_EN = [
  'gotta go fix a work thing, text you later)',
  'work issue came up — going to sort it, back later)',
  'need to handle something at work, write you after)',
  'running off to deal with work, talk later)',
];

let nftScheduleReady = false;
const nftWorkMentionInFlight = new Set();
const nftVoiceTickInFlight = new Set();

let hooks = {
  tgSendMessage: null,
  getAccountSettings: null,
  voiceSendInFlight: null,
  voiceSendKey: null,
  isVoiceForbiddenError: null,
  voiceForbiddenPeers: null,
  isAnswerToHowLong: null,
  bufferKey: null,
  getProcessingInFlight: () => new Set(),
  getMessageBuffers: () => new Map(),
};

function configureNftCampaign(next) {
  hooks = { ...hooks, ...next };
}

function noteNftVoiceMissing() {
  if (!nftVoiceMissingLogged) {
    nftVoiceMissingLogged = true;
    console.error(
      `[telegramClient] Файл ${NFT_VOICE_FILE} не найден в voices/ — NFT-голосовое отключено.`,
    );
  }
}

function pickWorkProblemPhrase(isRussian = true) {
  const bank = isRussian ? WORK_PROBLEM_PHRASES_RU : WORK_PROBLEM_PHRASES_EN;
  return bank[Math.floor(Math.random() * bank.length)];
}

function withWorkProblemLine(text) {
  // Больше НЕ подмешиваем «по работе» в тот же ответ — это выглядело как
  // единственная «инициатива» NFT-кампании вместо живого ответа.
  return String(text || '').trim();
}

/** После нормального ответа — отдельным сообщением «секунду, рабочее)» если пора. */
async function maybeSendWorkAside(client, sender, accountId, peerId, senderName, enabled) {
  if (!enabled) return false;
  if (!(await claimWorkMention(accountId, peerId))) return false;
  const isRussian = await conversationIsRussian(accountId, peerId);
  const line = pickWorkProblemPhrase(isRussian);
  try {
    await sleep(2500 + Math.random() * 3500);
    await hooks.tgSendMessage(client, sender, { message: line });
    await saveMessage(accountId, peerId, senderName, 'assistant', line);
    // После «убегу по работе» ИИ молчит до nft.ogg — иначе болтает поверх предложки.
    await helpRequestNotifier.disableAutoreplyForPeer(accountId, peerId, 'nft_pending');
    console.log(
      `[${accountLabel(accountId)}] Отдельным сообщением «по работе» для ${senderName}: "${line}"`,
    );
    return true;
  } catch (err) {
    await releaseWorkMention(accountId, peerId).catch(() => {});
    console.error(
      `[${accountLabel(accountId)}] Не удалось отправить «по работе» ${senderName}:`,
      err.message,
    );
    return false;
  }
}

async function shouldSuppressNftForTurn(
  text,
  {
    flipPhotoQuestion = false,
    explicitMediaRequest = false,
    history = null,
    accountId = null,
    peerId = null,
  } = {},
) {
  if (flipPhotoQuestion || explicitMediaRequest) return true;
  const objectionHandler = require('./objectionHandler');
  if (objectionHandler.isAskingHerName(text)) return true;
  if (objectionHandler.isDirectQuestion(text)) return true;
  if (objectionHandler.isAboutHerJobQuestion(text)) return true;
  if (objectionHandler.isContactOrMeetRelated(text)) return true;
  // Ответ на «сколько на дв» / «какой?» после ДВ — NFT питч запрещён.
  if (history && hooks.isAnswerToHowLong && hooks.isAnswerToHowLong(history)) return true;
  if (history && typeof objectionHandler.getDvClarifyHint === 'function') {
    if (objectionHandler.getDvClarifyHint(text, history)) return true;
  }
  if (history && typeof objectionHandler.getDvRareCorrectionHint === 'function') {
    if (objectionHandler.getDvRareCorrectionHint(text, history)) return true;
  }
  // Must #41/#65/#66/#67: clone-скепсис / нет явного интереса / кулдаун после скрина.
  try {
    const hh = require('./humanHardening');
    if (hh.isCloneSkeptic(text)) return true;
    if (accountId != null && peerId != null) {
      await hh.hydratePeerGates(accountId, peerId);
      hh.noteExplicitInterest(accountId, peerId, text);
      if (hh.shouldBlockNftPitch(accountId, peerId, text, history)) return true;
    }
  } catch (_) {
    /* optional */
  }
  return false;
}

/** Если модель всё же ушла в NFT / «уже бывал» при ДВ-контексте — жёсткий безопасный ответ. */
/** Прямое «могу показать / без давления» — слишком в лоб на этапе знакомства. */
const SOFT_PITCH_OFFER_RE =
  /могу\s*,?\s*показат\w*[^.!?\n]{0,60}(?:интересн|без\s+давлен)|показат\w*\s*,?\s*если\s+интересн|если\s+интересн\w*[^.!?\n]{0,40}без\s+давлен|без\s+давлен\w*[^.!?\n]{0,40}(?:показат|могу|скин)|покаж\w*\s+если\s+интересн|(?:хочешь|могу)\s+(?:скину|покаж)\w*\s+(?:скрины?|профит|как\s+это)/i;

function stripSoftPitchOffer(reply) {
  const raw = String(reply || '');
  if (!raw || !SOFT_PITCH_OFFER_RE.test(raw)) return reply;
  const tag = (raw.match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  // Питч почти всегда вся фраза/хвост — безопаснее заменить целиком, чем резать куски.
  const body = ['ну да онлайн работаю)', 'работаю удалённо просто)', 'ну с ноута обычно)'][
    Math.floor(Math.random() * 3)
  ];
  return tag + body;
}

function sanitizeReplyAgainstNftLeak(reply, objectionHint) {
  let out = stripSoftPitchOffer(reply);
  const hint = String(objectionHint || '');
  if (!hint) return out;
  const dvGuard =
    /только про дв|про ДВ|НА дв|ЗАПРЕЩЕНО: NFT|ЗАПРЕЩЕНО: «ты уже в теме|КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: NFT|КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: «уже бывал/i.test(
      hint,
    );
  if (!dvGuard) return out;
  const text = String(out || '');
  const nftLeak = /нфт|\bnft\b|токен|флип|коллекц|платформ|крипт|whitelist|вайтлист/i.test(text);
  const veteranPush =
    /новичок|редко сидит|мало дней|редко на дв|не бывалый|КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: «уже бывал/i.test(
      hint,
    ) && /уже\s+бывал|уже\s+шаришь|ну\s+ты\s+на\s+дв\s+уже|опытный\s+на\s+дв/i.test(text);
  if (!nftLeak && !veteranPush) return out;
  if (/уточняет|какой\s*\//i.test(hint)) return 'ну про дв)';
  if (/редко на дв|не бывалый|поправляет/i.test(hint)) return 'ага поняла)';
  return 'поняла)';
}

function pickWorkMentionAt(scheduledAt) {
  const span = NFT_WORK_MENTION_MAX_MS - NFT_WORK_MENTION_MIN_MS;
  const before = NFT_WORK_MENTION_MIN_MS + Math.floor(Math.random() * (span + 1));
  return new Date(scheduledAt.getTime() - before);
}

function isWorkMentionWindow(scheduledAt, now = Date.now()) {
  const until = scheduledAt.getTime() - now;
  return until >= NFT_WORK_MENTION_MIN_MS && until <= NFT_WORK_MENTION_MAX_MS;
}

async function addNftScheduleColumn(name, definition) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''))) {
    throw new Error(`unsafe SQL column: ${name}`);
  }
  if (!/^[A-Za-z0-9_()\s,.']+$/.test(String(definition || ''))) {
    throw new Error(`unsafe SQL definition for ${name}`);
  }
  try {
    await db.execute(`ALTER TABLE nft_voice_schedule ADD COLUMN ${name} ${definition}`);
  } catch (err) {
    if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

async function ensureNftScheduleTable() {
  if (nftScheduleReady) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nft_voice_schedule (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      scheduled_at DATETIME NOT NULL,
      work_mention_at DATETIME NULL,
      work_mention_sent TINYINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, peer_id)
    )
  `);
  await addNftScheduleColumn('work_mention_at', 'DATETIME NULL');
  await addNftScheduleColumn('work_mention_sent', 'TINYINT NOT NULL DEFAULT 0');
  await addNftScheduleColumn('voice_skip_reason', 'VARCHAR(64) NULL');
  nftScheduleReady = true;
}

/** VOICE_MESSAGES_FORBIDDEN / unreachable — не крутить stuckWorkNoVoice вечно. */
async function markNftVoiceSkipped(accountId, peerId, reason = 'voice_forbidden') {
  await ensureNftScheduleTable();
  await db.execute(
    `UPDATE nft_voice_schedule
     SET voice_skip_reason = ?
     WHERE account_id = ? AND peer_id = ?`,
    [String(reason || 'voice_forbidden').slice(0, 64), accountId, String(peerId)],
  );
}

async function claimWorkMention(accountId, peerId) {
  const [res] = await db.execute(
    `UPDATE nft_voice_schedule
     SET work_mention_sent = 1
     WHERE account_id = ? AND peer_id = ? AND work_mention_sent = 0`,
    [accountId, String(peerId)],
  );
  return res.affectedRows > 0;
}

async function postponeNftVoice(accountId, peerId, delayMs) {
  await db.execute(
    `UPDATE nft_voice_schedule SET scheduled_at = ?
     WHERE account_id = ? AND peer_id = ?`,
    [new Date(Date.now() + delayMs), accountId, String(peerId)],
  );
}

async function releaseWorkMention(accountId, peerId) {
  await db.execute(
    `UPDATE nft_voice_schedule SET work_mention_sent = 0
     WHERE account_id = ? AND peer_id = ?`,
    [accountId, String(peerId)],
  );
}

async function getOrCreateNftVoiceAt(accountId, peerId) {
  await ensureNftScheduleTable();
  const [[existing]] = await db.execute(
    `SELECT scheduled_at, work_mention_at, work_mention_sent
     FROM nft_voice_schedule
     WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, peerId],
  );
  if (existing?.scheduled_at) {
    const scheduledAt = new Date(existing.scheduled_at);
    let workMentionAt = existing.work_mention_at ? new Date(existing.work_mention_at) : null;
    if (!workMentionAt) {
      workMentionAt = pickWorkMentionAt(scheduledAt);
      await db.execute(
        `UPDATE nft_voice_schedule SET work_mention_at = ?
         WHERE account_id = ? AND peer_id = ? AND work_mention_at IS NULL`,
        [workMentionAt, accountId, String(peerId)],
      );
    }
    return {
      scheduledAt,
      workMentionAt,
      workMentionSent: Number(existing.work_mention_sent) === 1,
    };
  }

  const delay = NFT_VOICE_LEAD_MIN_MS
    + Math.floor(Math.random() * (NFT_VOICE_LEAD_MAX_MS - NFT_VOICE_LEAD_MIN_MS + 1));
  const scheduledAt = new Date(Date.now() + delay);
  const workMentionAt = pickWorkMentionAt(scheduledAt);
  await db.execute(
    `INSERT INTO nft_voice_schedule
       (account_id, peer_id, scheduled_at, work_mention_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE scheduled_at = scheduled_at`,
    [accountId, String(peerId), scheduledAt, workMentionAt],
  );
  const [[row]] = await db.execute(
    `SELECT scheduled_at, work_mention_at, work_mention_sent
     FROM nft_voice_schedule
     WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, peerId],
  );
  return {
    scheduledAt: new Date(row.scheduled_at),
    workMentionAt: row.work_mention_at ? new Date(row.work_mention_at) : workMentionAt,
    workMentionSent: Number(row?.work_mention_sent) === 1,
  };
}

// NFT-шаги сами по себе шлём только в живой диалог: он писал совсем недавно.
/** Окно «живой диалог» для фразы «по работе» — писал за последние N мин. */
const NFT_LIVE_DIALOG_MIN = Math.max(
  30,
  Number(process.env.NFT_LIVE_DIALOG_MIN) || 90,
);
/** Приоритет очереди ГС: свежие входящие выше; после «по работе» ГС уходит и без нового сообщения. */
const NFT_VOICE_LIVE_DIALOG_MIN = 120;
/** Не чаще раза в N мс на аккаунт (boundary 60с, тик тяжёлый). */
const NFT_TICK_MIN_MS = Math.max(
  60_000,
  Number(process.env.NFT_TICK_MIN_MS) || 3 * 60_000,
);
const lastNftTickAt = new Map();

/**
 * Упоминала ли бот NFT/флиппинг этому собеседнику за последние сутки.
 * Нужно, чтобы напоминание было раз в день, а не в каждом сообщении.
 */
async function nftMentionedRecently(accountId, peerId) {
  try {
    const [rows] = await db.execute(
      `SELECT id FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
         AND created_at > (NOW() - INTERVAL 36 HOUR)
         AND (content LIKE '%нфт%' OR content LIKE '%nft%'
              OR content LIKE '%флип%' OR content LIKE '%токен%')
       LIMIT 1`,
      [accountId, peerId],
    );
    return rows.length > 0;
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Не смог проверить упоминания NFT:`,
      err.message,
    );
    // Ошибку трактуем как «уже упоминала» — лучше промолчать, чем спамить.
    return true;
  }
}

/** План прогрева 1–2–3 дня — в коде, не в промпте анкеты. */
function warmupDay1Hint() {
  return (
    'ПЛАН ДНЯ 1 (не говори про «день/план»). Знакомство: лёгкий флирт, общие темы, понравиться — не продавать. ' +
    'Если уместно — коротко про переезд к маме из легенды промпта (доверие). ' +
    'На вопрос про работу: «занимаюсь флипингом цифровых токенов» ИЛИ «подрабатываю в интернете» — коротко. ' +
    'Без «слышал о таком», NFT/заработка/платформы/ссылок/скринов без повода. Сначала ответь на его слова.'
  );
}

function warmupDay2Hint({ softOnly = false } = {}) {
  if (softOnly) {
    return (
      'ПЛАН ДНЯ 2 (не говори про дни). Общайся теплее, можно шутить/дразнить. ' +
      'Про работу — только если он спросил. Не лезь с заработком сама. Скрины шлёт система — не обещай.'
    );
  }
  return (
    'ПЛАН ДНЯ 2 (не говори про дни). Теплее, можно шутить. ' +
    'Если он САМ спросил про работу — можно: «флипинг цифровых токенов, покупаю дешевле и перепродаю дороже, норм подработка» ' +
    'и в конце часто «слышал о таком?)» / «слышал что-нибудь о таком?)». ' +
    'Если сама коротко про работу/флип — тоже часто спроси, слышал ли. ' +
    'Если не спросил — не лезь с питчем. Заинтересовался — коротко без напора. ' +
    'ЗАПРЕЩЕНО: ссылки, «могу показать», уговоры, скрины от себя (их шлёт система вечером).'
  );
}

function warmupDay3Hint({ awaitingVoice = false } = {}) {
  if (awaitingVoice) {
    return (
      'ПЛАН ДНЯ 3 (не говори про дни). Голосовое с просьбой ещё НЕ анонсируй и не пиши про токен/помощь. ' +
      'Обычный живой ответ на его сообщение. Можно мягко про платформу/коллекцию без обещания ссылки, если уместно. Не дави.'
    );
  }
  return (
    'ПЛАН ДНЯ 3 (не говори про дни). Чуть теплее. ' +
    'Можно ОДИН раз мягко: «кстати, сегодня залетела на платформу, там новая коллекция выходит, я уже присматриваю)» — без названий в кавычках и без обещания ссылки, если ссылки нет. ' +
    'Заинтересовался — коротко что делать; нет — «ну лан, если что подскажу». Не дави. Скрины/голосовое — система.'
  );
}

/**
 * Считает состояние прогрева / NFT-кампании для собеседника.
 * Дни 1–2–3 — здесь; в промпте анкеты этого блока быть не должно.
 *
 * @returns {Promise<{hint: string|null, sendVoice: boolean, warmupDay?: number}>}
 */
async function getNftCampaignState(accountId, peerId, historyLength, opts = {}) {
  const leadTier = String(opts.leadTier || '').toLowerCase();
  const minHist =
    leadTier === 'hot' ? 10 : leadTier === 'cold' ? 22 : 14;
  const day2Chance =
    leadTier === 'hot' ? 0.22 : leadTier === 'cold' ? 0.04 : 0.12;
  const voiceAfterHours =
    leadTier === 'hot'
      ? Math.max(36, NFT_VOICE_AFTER_HOURS - 12)
      : leadTier === 'cold'
        ? NFT_VOICE_AFTER_HOURS + 24
        : NFT_VOICE_AFTER_HOURS;

  const ageHours = await getDialogAgeHours(accountId, peerId);
  if (ageHours == null) return { hint: null, sendVoice: false };

  const warmupDay = ageHours < 24 ? 1 : ageHours < voiceAfterHours ? 2 : 3;
  const inNftHours = isWithinNftCampaignHours();

  // --- День 3: голосовое (только в окне NFT 16–21 МСК) ---
  if (warmupDay === 3 && inNftHours) {
    const voiceAlreadySent = await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE);
    if (voiceAlreadySent) {
      return { hint: null, sendVoice: false, warmupDay: 3 };
    }
    if (historyLength < minHist) {
      return { hint: warmupDay3Hint(), sendVoice: false, warmupDay: 3 };
    }
    const plan = await getOrCreateNftVoiceAt(accountId, peerId);
    const now = Date.now();
    if (now < plan.scheduledAt.getTime()) {
      const sayWorkProblem = !plan.workMentionSent && isWorkMentionWindow(plan.scheduledAt, now);
      return {
        hint: warmupDay3Hint({ awaitingVoice: true }),
        sendVoice: false,
        sayWorkProblem,
        warmupDay: 3,
      };
    }
    if (!plan.workMentionSent) {
      await postponeNftVoice(accountId, peerId, NFT_WORK_MENTION_MIN_MS + Math.random() * 15 * 60 * 1000);
      return {
        hint: warmupDay3Hint({ awaitingVoice: true }),
        sendVoice: false,
        sayWorkProblem: true,
        warmupDay: 3,
      };
    }
    return {
      hint:
        'Сейчас уйдёт голосовое. Не пиши, что возишься с токеном. ' +
        'Одна короткая живая фраза без денег и ссылок, детали будут в голосовом. Можно почти без текста.',
      sendVoice: true,
      warmupDay: 3,
    };
  }

  // --- День 1: знакомство (хинт и вне окна NFT) ---
  if (warmupDay === 1) {
    if (historyLength < 2) return { hint: null, sendVoice: false, warmupDay: 1 };
    return { hint: warmupDay1Hint(), sendVoice: false, warmupDay: 1 };
  }

  // --- День 2 ---
  if (warmupDay === 2) {
    if (historyLength < Math.min(8, minHist)) {
      return { hint: warmupDay2Hint({ softOnly: true }), sendVoice: false, warmupDay: 2 };
    }
    if (!inNftHours || (await nftMentionedRecently(accountId, peerId)) || Math.random() > day2Chance) {
      return { hint: warmupDay2Hint({ softOnly: true }), sendVoice: false, warmupDay: 2 };
    }
    return { hint: warmupDay2Hint(), sendVoice: false, warmupDay: 2 };
  }

  // День 3 вне окна NFT — мягкий план без голосового
  return { hint: warmupDay3Hint(), sendVoice: false, warmupDay: 3 };
}

async function tickNftWorkMentions(accountId, archiveFlagsShared = null) {
  const key = accountKey(accountId);
  if (nftWorkMentionInFlight.has(key)) return;
  nftWorkMentionInFlight.add(key);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;
    const settings = await hooks.getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;
    await ensureNftScheduleTable();
    // Окно «по работе»: scheduled через 10–50 мин — в SQL + LIMIT, не весь schedule.
    const workMin = Math.max(1, Math.floor(NFT_WORK_MENTION_MIN_MS / 60_000));
    const workMax = Math.max(workMin + 1, Math.floor(NFT_WORK_MENTION_MAX_MS / 60_000));
    const [dueRows] = await db.execute(
      `SELECT peer_id, scheduled_at, work_mention_at FROM nft_voice_schedule
       WHERE account_id = ?
         AND work_mention_sent = 0
         AND scheduled_at > (NOW() + INTERVAL ${workMin} MINUTE)
         AND scheduled_at <= (NOW() + INTERVAL ${workMax} MINUTE)
       ORDER BY scheduled_at ASC
       LIMIT 24`,
      [accountId],
    );
    const now = Date.now();
    const rows = (dueRows || []).filter((row) =>
      isWorkMentionWindow(new Date(row.scheduled_at), now),
    );
    if (!rows.length) return;
    const archiveFlags =
      archiveFlagsShared || (await loadArchiveFlagsSafe(client, accountId));
    const processingInFlight = hooks.getProcessingInFlight();
    for (const row of rows) {
      const peerId = String(row.peer_id);
      const ageHours = await getDialogAgeHours(accountId, peerId);
      if (ageHours == null || ageHours < NFT_VOICE_AFTER_HOURS) continue;
      if (isHiddenFromReplies(archiveFlags, peerId)) continue;
      if (processingInFlight.has(hooks.bufferKey(accountId, peerId))) continue;
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) continue;
      if (await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE)) {
        await claimWorkMention(accountId, peerId);
        continue;
      }
      const tail = await getDialogTail(accountId, peerId);
      if (!tail.hasIncoming) continue;
      if (tail.lastRole !== 'assistant' && tail.lastRole !== 'user') continue;
      // Человек написал и ждёт ответа — не лезем с «по работе», ответим обычным ходом.
      if (tail.lastRole === 'user') continue;
      // Молчит — не пишем первой «по работе» в пустоту: скажет в ответ, когда напишет.
      const idleMin = await lastIncomingAgeMin(accountId, peerId);
      if (idleMin == null || idleMin > NFT_LIVE_DIALOG_MIN) continue;
      let entity;
      try {
        entity = await client.getEntity(Number(peerId));
      } catch (_) {
        continue;
      }
      if (!entity || entity.bot || entity.self) continue;
      if (await shouldSkipProactivePeer(client, entity)) continue;
      if (await shouldSkipNftForLeadTier(accountId, peerId)) continue;
      if (!(await claimWorkMention(accountId, peerId))) continue;
      const senderName = entity.username || entity.firstName || peerId;
      try {
        const isRussian = await conversationIsRussian(accountId, peerId);
        await sleep(1500 + Math.random() * 2500);
        const phrase = pickWorkProblemPhrase(isRussian);
        await hooks.tgSendMessage(client, entity, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        // Пауза ИИ сразу после «по работе», до фактического nft.ogg.
        await helpRequestNotifier.disableAutoreplyForPeer(accountId, peerId, 'nft_pending');
        console.log(
          `[${accountLabel(accountId)}] Перед NFT: «по работе» в живом диалоге для ${senderName}: "${phrase}"`,
        );
        try {
          require('./opsLiveMetrics').bump('nftWorkMention');
        } catch (_) {
          /* optional */
        }
      } catch (err) {
        await releaseWorkMention(accountId, peerId);
        console.error(
          `[${accountLabel(accountId)}] Не удалось написать про работу ${senderName}:`,
          err.errorMessage || err.message,
        );
        if (isPermanentSendError(err)) {
          await retireUnreachablePeer(
            client,
            accountId,
            peerId,
            entity,
            err.errorMessage || err.message || 'unreachable',
          );
        }
      }
    }
  } finally {
    nftWorkMentionInFlight.delete(key);
  }
}

async function tickNftDueVoices(accountId, archiveFlagsShared = null) {
  const inNftHours = isWithinNftCampaignHours();
  // Вне 16–21: только догон застрявших (scheduled уже просрочен ≥60м), не новые слоты.
  const key = accountKey(accountId);
  if (nftVoiceTickInFlight.has(key)) return;
  nftVoiceTickInFlight.add(key);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;
    const settings = await hooks.getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;
    const baseNftPath = path.join(VOICES_DIR, NFT_VOICE_FILE);
    if (!fs.existsSync(baseNftPath)) {
      // A/B: достаточно любого варианта nft*.ogg
      let anyVariant = false;
      try {
        anyVariant = require('./scaleIdeasPack').listAvailableVoiceVariants(VOICES_DIR).length > 0;
      } catch (_) {
        anyVariant = false;
      }
      if (!anyVariant) {
        noteNftVoiceMissing();
        return;
      }
    }

    // После «по работе» ГС должен уйти по scheduled_at даже если он молчит
    // (ИИ на паузе nft_pending — нового входящего часто нет → раньше зависали).
    // Свежие диалоги в приоритете; без гейта «писал за N минут».
    const dueGate = inNftHours
      ? 'nvs.scheduled_at <= NOW()'
      : 'nvs.scheduled_at < (NOW() - INTERVAL 60 MINUTE)';
    const [dueSlots] = await db.execute(
      `SELECT nvs.peer_id,
              (SELECT MAX(cm.peer_username) FROM conversation_messages cm
               WHERE cm.account_id = nvs.account_id AND cm.peer_id = nvs.peer_id) AS peer_username,
              EXISTS (
                SELECT 1 FROM conversation_messages u
                WHERE u.account_id = nvs.account_id AND u.peer_id = nvs.peer_id
                  AND u.role = 'user'
                  AND u.created_at >= (NOW() - INTERVAL ${Number(NFT_VOICE_LIVE_DIALOG_MIN)} MINUTE)
              ) AS live_user
       FROM nft_voice_schedule nvs
       WHERE nvs.account_id = ?
         AND nvs.work_mention_sent = 1
         AND (nvs.voice_skip_reason IS NULL OR nvs.voice_skip_reason = '')
         AND ${dueGate}
         AND (
           SELECT c.id FROM conversation_messages c
           WHERE c.account_id = nvs.account_id AND c.peer_id = nvs.peer_id
           ORDER BY c.id ASC
           LIMIT 1 OFFSET 5
         ) IS NOT NULL
       ORDER BY live_user DESC, nvs.scheduled_at ASC
       LIMIT 32`,
      [accountId],
    );
    const rows = dueSlots || [];
    if (!rows.length) return;
    const archiveFlags =
      archiveFlagsShared || (await loadArchiveFlagsSafe(client, accountId));

    const processingInFlight = hooks.getProcessingInFlight();
    const messageBuffers = hooks.getMessageBuffers();
    const voiceSendInFlight = hooks.voiceSendInFlight;
    const voiceForbiddenPeers = hooks.voiceForbiddenPeers;
    const voiceSendKey = hooks.voiceSendKey;
    const isVoiceForbiddenError = hooks.isVoiceForbiddenError;

    let sent = 0;
    for (const row of rows) {
      // Чуть выше лимит — чтобы разгребать застрявшие «по работе» без ГС.
      if (sent >= 8) break;
      const peerId = String(row.peer_id);
      const dialogKey = hooks.bufferKey(accountId, peerId);
      if (processingInFlight.has(dialogKey) || messageBuffers.has(dialogKey)) continue;
      if (voiceForbiddenPeers.has(dialogKey)) continue;
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      // nft_pending = уже «по работе», ждём голос — не скипаем. Прочие паузы — скипаем.
      {
        const pauseReason = await helpRequestNotifier.getAutoreplyDisableReason(accountId, peerId);
        if (pauseReason && pauseReason !== 'nft_pending') continue;
      }
      // Уже уходило любое nft*.ogg (A/B).
      if (
        (await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE)) ||
        (await wasVoiceSent(accountId, peerId, 'nft_b.ogg')) ||
        (await wasVoiceSent(accountId, peerId, 'nft_c.ogg'))
      ) {
        continue;
      }
      if (isHiddenFromReplies(archiveFlags, peerId)) continue;
      if (!(await conversationIsRussian(accountId, peerId))) {
        continue;
      }

      // Возраст сессии. После «по работе» не рвём из‑за null (idle>72ч) —
      // такие слоты закрывает expireStaleNftAfterWork; здесь шлём, пока диалог жив.
      const ageHours = await getDialogAgeHours(accountId, peerId);
      if (ageHours == null) continue;
      if (ageHours < NFT_VOICE_AFTER_HOURS) continue;

      const plan = await getOrCreateNftVoiceAt(accountId, peerId);
      if (Date.now() < plan.scheduledAt.getTime()) continue;
      // Без «по работе» перед ним голосовое с просьбой звучит из ниоткуда.
      if (!plan.workMentionSent) continue;

      let voiceFile = NFT_VOICE_FILE;
      try {
        voiceFile = await require('./scaleIdeasPack').assignVoiceVariant(
          accountId,
          peerId,
          VOICES_DIR,
        );
      } catch (_) {
        voiceFile = NFT_VOICE_FILE;
      }
      const nftPath = path.join(VOICES_DIR, voiceFile);
      if (!fs.existsSync(nftPath)) {
        // fallback на базовый nft.ogg
        if (!fs.existsSync(path.join(VOICES_DIR, NFT_VOICE_FILE))) continue;
        voiceFile = NFT_VOICE_FILE;
      }
      const sendPath = path.join(VOICES_DIR, voiceFile);

      const sendKey = voiceSendKey(accountId, peerId, voiceFile);
      if (voiceSendInFlight.has(sendKey)) continue;

      let entity;
      try {
        entity = await client.getEntity(Number(peerId));
      } catch (_) {
        continue;
      }
      if (!entity || entity.bot || entity.self) continue;
      if (await shouldSkipProactivePeer(client, entity)) continue;
      // «По работе» уже ушло — cold/interest больше не режем ГС.
      // (shouldSkipNftForLeadTier только до claim work)

      voiceSendInFlight.add(sendKey);
      const senderName = entity.username || entity.firstName || row.peer_username || peerId;
      try {
        try {
          await client.invoke(
            new Api.messages.SetTyping({
              peer: entity,
              action: new Api.SendMessageRecordAudioAction(),
            }),
          );
        } catch (_) {}
        await sleep(2500 + Math.random() * 2500);
        await sendVoiceReply(client, entity, sendPath);
        await saveMessage(accountId, peerId, senderName, 'assistant', voiceTag(voiceFile));
        const me = await client.getMe();
        const accountName = [me.firstName, me.lastName].filter(Boolean).join(' ')
          || (me.username ? `@${me.username}` : '');
        await helpRequestNotifier.recordVoiceSent(
          accountId,
          peerId,
          senderName,
          voiceFile,
          settings.phone,
          accountName,
        );
        await helpRequestNotifier.disableAutoreplyForPeer(accountId, peerId, 'nft_voice_sent');
        try {
          const leadScoring = require('./leadScoring');
          await leadScoring.onLeadBecameReady(accountId, peerId, 'nft_voice_sent');
        } catch (e) {
          console.error(`[${accountLabel(accountId)}] leadReady:`, e.message);
        }
        sent += 1;
        console.log(
          `[${accountLabel(accountId)}] Отправлено голосовое про NFT (3-й день) для ${senderName}.`,
        );
        try {
          require('./opsLiveMetrics').bump('nftVoiceSent');
        } catch (_) {
          /* optional */
        }
      } catch (err) {
        if (isVoiceForbiddenError(err)) {
          voiceForbiddenPeers.add(dialogKey);
          try {
            await markNftVoiceSkipped(accountId, peerId, 'voice_forbidden');
          } catch (_) {}
        }
        console.error(
          `[${accountLabel(accountId)}] Не удалось отправить NFT-голосовое ${senderName}:`,
          err.errorMessage || err.message,
        );
        if (isPermanentSendError(err)) {
          await retireUnreachablePeer(
            client,
            accountId,
            peerId,
            entity,
            err.errorMessage || err.message || 'unreachable',
          );
        }
      } finally {
        voiceSendInFlight.delete(sendKey);
      }
    }
  } finally {
    nftVoiceTickInFlight.delete(key);
  }
}

function pruneNftTickMap(now = Date.now()) {
  const ttl = NFT_TICK_MIN_MS * 8;
  for (const [id, ts] of lastNftTickAt) {
    if (now - ts > ttl) lastNftTickAt.delete(id);
  }
}

async function tickNftCampaign(accountId) {
  const now = Date.now();
  if (lastNftTickAt.size > 64) pruneNftTickMap(now);
  const prev = lastNftTickAt.get(accountId) || 0;
  if (now - prev < NFT_TICK_MIN_MS) return;
  lastNftTickAt.set(accountId, now);

  await rearchiveOurOnlyWorkChats(accountId);
  await rescheduleStaleNftSlots(accountId);
  await expireStaleNftAfterWork(accountId);
  const client = getActiveClient(accountId);
  const archiveFlags = client
    ? await loadArchiveFlagsSafe(client, accountId)
    : null;
  await tickNftWorkMentions(accountId, archiveFlags);
  await tickNftDueVoices(accountId, archiveFlags);
}

module.exports = {
  configureNftCampaign,
  VOICES_DIR,
  NFT_VOICE_FILE,
  NFT_VOICE_AFTER_HOURS,
  NFT_VOICE_LEAD_MIN_MS,
  NFT_VOICE_LEAD_MAX_MS,
  NFT_WORK_MENTION_MIN_MS,
  NFT_WORK_MENTION_MAX_MS,
  NFT_DIALOG_SESSION_GAP_HOURS,
  NFT_ACTIVE_DIALOGUE_IDLE_HOURS,
  NFT_LIVE_DIALOG_MIN,
  NFT_VOICE_LIVE_DIALOG_MIN,
  NFT_STALE_VOICE_HOURS,
  expireStaleNftAfterWork,
  noteNftVoiceMissing,
  pickWorkProblemPhrase,
  withWorkProblemLine,
  maybeSendWorkAside,
  shouldSuppressNftForTurn,
  sanitizeReplyAgainstNftLeak,
  stripSoftPitchOffer,
  pickWorkMentionAt,
  isWorkMentionWindow,
  addNftScheduleColumn,
  ensureNftScheduleTable,
  claimWorkMention,
  postponeNftVoice,
  releaseWorkMention,
  markNftVoiceSkipped,
  getOrCreateNftVoiceAt,
  nftMentionedRecently,
  getNftCampaignState,
  tickNftWorkMentions,
  tickNftDueVoices,
  tickNftCampaign,
  loadArchiveFlagsSafe,
  shouldSkipNftForLeadTier,
  rescheduleStaleNftSlots,
  NFT_TICK_MIN_MS,
};
