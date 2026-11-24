/**
 * 0t5: взаимный обмен медиа.
 * Попросил фото/кружок → «хорошо скину, но сначала ты».
 * Пока он не скинул — мы не шлём. Давит/агрессит → отказ «не собачка».
 */

const db = require('../db');

const PEER_MEDIA_MARK_RE =
  /\[(?:фото|кружок|видео)\s+от\s+собеседника\]/i;

const ASK_MEDIA_RE =
  /(?:скинь|запиши|пришли|кинь|хочу|можешь|дай|ждёте?|жду).{0,48}(?:круж|видеосообщ|видео|видос|фот|селфи)|(?:кружок|видеосообщение|селфи|фотк\w*|фото).{0,24}(?:скинь|запиши|пришли|кинь|можешь|хочу)/i;

const AGGRESSIVE_RE =
  /(?:^|\s)(?:сука|блять|бля|нахуй|пошёл|пошел|иди\s+нахуй|ебан|тупая|дур[ае]|собак|приказ|быстро\s+(?:скинь|кинь)|(?:скинь|кинь|запиши)\s+уже|щас\s+же|немедленно|давай\s+уже|давай\s+быстрее|ну\s+же\s+(?:скинь|кинь)|хватит\s+(?: circ| circ)|не\s+выёб|не\s+выеб|выёбыв|выебыв|долго\s+(?:ждать|скидыва)|сколько\s+можно)/i;

const YOU_FIRST_ALTS = [
  'хорошо скину, но сначала ты)',
  'ок кину — только ты первый)',
  'давай, но сперва ты скинь)',
  'могу, но сначала ты)',
  'ладно, кину после тебя — сначала ты)',
  // 0t34
  'хех ну сначала ты, потом я)',
  'давай обмен — ты первый)',
];

const REFUSE_ALTS = [
  'ну тогда и я не скину, я же не собачка чтобы приказы выполнять)',
  'ну тогда и я не буду — я не на посылках)',
  'раз так — сама тоже не кину, я не собачка)',
  'окей, тогда и я ничего не кину. я не по команде)',
  'не, так не работает — я не по приказу)',
];

const HOLD_HINT =
  'МЕДИА-ОБМЕН: он просит фото/кружок. Пока он сам не скинул — НЕ шли медиа и НЕ пиши «щас кину» без условия. ' +
  'Скажи коротко в духе «хорошо скину, но сначала ты)». Без лекции.';

const REFUSE_HINT =
  'МЕДИА-ОБМЕН: он давит/агрессит. Откажись: «ну тогда и я не скину, я же не собачка…». Медиа НЕ шли.';

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS peer_media_barter (
        account_id INT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'idle',
        kind VARCHAR(16) NULL,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, peer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isPeerMediaText(text) {
  return PEER_MEDIA_MARK_RE.test(String(text || ''));
}

function isMediaAsk(text) {
  return ASK_MEDIA_RE.test(String(text || '').replace(/\[[^\]]*\]/g, ' '));
}

function isAggressive(text) {
  const t = String(text || '').replace(/\[[^\]]*\]/g, ' ');
  return AGGRESSIVE_RE.test(t);
}

function detectKind(text) {
  const t = String(text || '');
  if (/(?:круж|видеосообщ|video\s*note)/i.test(t)) return 'circle';
  if (/(?:видео|видос)/i.test(t)) return 'video';
  if (/(?:фот|селфи)/i.test(t)) return 'photo';
  return 'any';
}

async function getStatus(accountId, peerId) {
  try {
    await ensureSchema();
    const [[row]] = await db.execute(
      `SELECT status, kind FROM peer_media_barter
       WHERE account_id = ? AND peer_id = ? LIMIT 1`,
      [accountId, String(peerId)],
    );
    return {
      status: row?.status || 'idle',
      kind: row?.kind || null,
    };
  } catch {
    return { status: 'idle', kind: null };
  }
}

async function setStatus(accountId, peerId, status, kind = null) {
  try {
    await ensureSchema();
    await db.execute(
      `INSERT INTO peer_media_barter (account_id, peer_id, status, kind, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE status = VALUES(status),
         kind = COALESCE(VALUES(kind), kind),
         updated_at = CURRENT_TIMESTAMP`,
      [accountId, String(peerId), status, kind],
    );
  } catch (err) {
    console.error('[mediaReciprocity] setStatus:', err.message);
  }
}

/** Он уже кидал медиа в хвосте истории (свежий бартер выполнен). */
function peerMediaInHistory(history, limit = 16) {
  const h = Array.isArray(history) ? history.slice(-limit) : [];
  return h.some((m) => m && m.role === 'user' && isPeerMediaText(m.content));
}

/**
 * Решить: слать ли медиа и что сказать.
 * @returns {Promise<{
 *   blockSend: boolean,
 *   forceReply: string|null,
 *   hint: string|null,
 *   status: string,
 *   reason: string|null
 * }>}
 */
async function evaluate(accountId, peerId, { history, userText }) {
  const text = String(userText || '');
  const ask = isMediaAsk(text);
  const aggressive = isAggressive(text);
  const heSentNow = isPeerMediaText(text);
  const heSentRecent = heSentNow || peerMediaInHistory(history, 16);
  const cur = await getStatus(accountId, peerId);
  let status = cur.status;

  // Он скинул медиа → снимаем ожидание, можно отдавать долг.
  if (heSentNow || (heSentRecent && (status === 'waiting_him' || status === 'refused'))) {
    const kind = cur.kind || 'photo';
    await setStatus(accountId, peerId, 'owed_to_him', kind);
    const shouldFulfillNow =
      heSentNow && (status === 'waiting_him' || status === 'refused' || status === 'owed_to_him');
    return {
      blockSend: false,
      forceReply: null,
      hint: shouldFulfillNow
        ? 'МЕДИА-ОБМЕН: он скинул своё — можно коротко «лол ок» / «держи)» и отдать токен медиа (<<PHOTO>>/<<CIRCLE>>).'
        : null,
      status: 'owed_to_him',
      reason: 'peer_sent_media',
      fulfillNow: shouldFulfillNow,
      fulfillKind: shouldFulfillNow ? kind : null,
    };
  }

  // Агрессия пока ждём / при просьбе медиа → отказ.
  if (aggressive && (ask || status === 'waiting_him' || status === 'refused')) {
    await setStatus(accountId, peerId, 'refused', cur.kind || (ask ? detectKind(text) : null));
    return {
      blockSend: true,
      forceReply: pick(REFUSE_ALTS),
      hint: REFUSE_HINT,
      status: 'refused',
      reason: 'aggressive',
      fulfillNow: false,
      fulfillKind: null,
    };
  }

  // Уже отказали — пока сам не скинет, медиа нет.
  if (status === 'refused') {
    if (ask) {
      return {
        blockSend: true,
        forceReply: pick(REFUSE_ALTS),
        hint: REFUSE_HINT,
        status: 'refused',
        reason: 'still_refused',
        fulfillNow: false,
        fulfillKind: null,
      };
    }
    return {
      blockSend: true,
      forceReply: null,
      hint: null,
      status: 'refused',
      reason: 'refused_quiet',
      fulfillNow: false,
      fulfillKind: null,
    };
  }

  // Просит медиа, а своего ещё не было → «сначала ты».
  if (ask && !heSentRecent) {
    await setStatus(accountId, peerId, 'waiting_him', detectKind(text));
    return {
      blockSend: true,
      forceReply: pick(YOU_FIRST_ALTS),
      hint: HOLD_HINT,
      status: 'waiting_him',
      reason: 'you_first',
      fulfillNow: false,
      fulfillKind: null,
    };
  }

  // Ждём его медиа (повтор без новой просьбы).
  if (status === 'waiting_him' && !heSentRecent) {
    return {
      blockSend: true,
      forceReply: ask ? pick(YOU_FIRST_ALTS) : null,
      hint: HOLD_HINT,
      status: 'waiting_him',
      reason: 'still_waiting',
      fulfillNow: false,
      fulfillKind: null,
    };
  }

  // Долг ему — можно слать.
  if (status === 'owed_to_him') {
    return {
      blockSend: false,
      forceReply: null,
      hint: null,
      status: 'owed_to_him',
      reason: 'owed',
      fulfillNow: ask,
      fulfillKind: ask ? detectKind(text) || cur.kind || 'photo' : null,
    };
  }

  return {
    blockSend: false,
    forceReply: null,
    hint: null,
    status: status || 'idle',
    reason: null,
    fulfillNow: false,
    fulfillKind: null,
  };
}

/** После успешной отправки нашего медиа — сброс в idle. */
async function markFulfilled(accountId, peerId) {
  await setStatus(accountId, peerId, 'idle', null);
}

/**
 * Если модель всё же пообещала «щас кину» без условия — заменить на бартер-фразу.
 */
function enforceReply(reply, decision) {
  if (!decision) return reply;
  if (decision.forceReply) return decision.forceReply;
  if (!decision.blockSend) return reply;
  const body = String(reply || '')
    .replace(/^\s*<<[^>\n]+>>\s*/g, '')
    .replace(/<<(?:PHOTO|VIDEO|CIRCLE|VOICE)[^>]*>>/gi, '')
    .trim();
  if (!body) return pick(YOU_FIRST_ALTS);
  // Уже есть «сначала ты» — ок.
  if (/сначала\s+ты|сперва\s+ты|ты\s+перв/i.test(body)) return body;
  // Обещает кинуть без условия — переписать.
  if (/(?:скин|кину|пришлю|запишу|щас|сейчас)\w*/i.test(body) && !/сначала|сперва|после\s+тебя/i.test(body)) {
    return pick(YOU_FIRST_ALTS);
  }
  return body;
}

module.exports = {
  ensureSchema,
  evaluate,
  markFulfilled,
  enforceReply,
  isPeerMediaText,
  isMediaAsk,
  isAggressive,
  peerMediaInHistory,
  YOU_FIRST_ALTS,
  REFUSE_ALTS,
  ASK_MEDIA_RE,
  AGGRESSIVE_RE,
  PEER_MEDIA_MARK_RE,
};
