/**
 * HUMAN EXTRA — дополнительная «человечность» поверх thin/life/humanize:
 *  1) досылка «а ещё…» через 20–90с
 *  2) реакция → текст с паузой
 *  3) темп набора / «передумала» по аккаунту
 *  4) утреннее «сорян только увидела» после ночи
 *  5) «отвлеклась» после долгой паузы с её стороны
 *  6) выкинуть пустые сообщения из пачки
 *  7) анти-зеркало «а ты?»
 *  8) эхо длины его реплики
 *  9) сленг-маркеры аккаунта
 * 10) callback к его мелочи (через memory / лёгкий хинт)
 */

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const paceCache = new Map();

/** Скорость набора и шанс «передумала» — стабильно на аккаунт. */
function getAccountPace(accountId) {
  const key = String(accountId ?? '0');
  if (paceCache.has(key)) return paceCache.get(key);
  const rand = mulberry32(hashSeed(`pace:${key}`));
  const profile = {
    // 0.75 = быстрее печатает, 1.35 = думает дольше
    typingMul: 0.75 + rand() * 0.6,
    rethinkChance: 0.18 + rand() * 0.22,
    afterthoughtChance: 0.1 + rand() * 0.12,
    reactThenTextChance: 0.35 + rand() * 0.35,
    slangSet: Math.floor(rand() * SLANG_SETS.length),
  };
  paceCache.set(key, profile);
  return profile;
}

const SLANG_SETS = [
  { id: 'karoch', swaps: [[/\bкороче\b/gi, 'кароч'], [/\bвообще\b/gi, 'вобще']], hint: 'Изредка «кароч/вобще», без перегиба.' },
  { id: 'tipa', swaps: [[/\bпросто\b/gi, 'типа'], [/\bкак бы\b/gi, 'типа']], hint: 'Ближе к «типа», не каждый ответ.' },
  { id: 'dry', swaps: [], hint: 'Почти без «)» в конце — суше обычного.' },
  { id: 'hah', swaps: [[/\bхах\b/gi, 'ахах']], hint: 'Чаще «ахах», чем голый «хах».' },
  { id: 'nu_da', swaps: [[/\bага\b/gi, 'ну да'], [/\bугу\b/gi, 'ну да']], hint: 'Чаще «ну да», чем «ага/угу».' },
];

function slangHintForAccount(accountId) {
  const pace = getAccountPace(accountId);
  const set = SLANG_SETS[pace.slangSet % SLANG_SETS.length];
  return `РЕЧЕВОЙ МАРКЕР этого номера: ${set.hint} Не объясняй это.`;
}

function applyAccountSlang(text, accountId) {
  if (!text || accountId == null) return text;
  const pace = getAccountPace(accountId);
  const set = SLANG_SETS[pace.slangSet % SLANG_SETS.length];
  let out = String(text);
  if (set.id === 'dry' && /\)+\s*$/.test(out) && Math.random() < 0.55) {
    out = out.replace(/\)+\s*$/, '').trim();
  }
  if (!set.swaps.length) return out;
  if (Math.random() > 0.28) return out;
  const [re, to] = set.swaps[Math.floor(Math.random() * set.swaps.length)];
  re.lastIndex = 0;
  if (!re.test(out)) return out;
  re.lastIndex = 0;
  let used = false;
  return out.replace(re, (m) => {
    if (used) return m;
    used = true;
    if (/^[А-ЯЁ]/.test(m) && /^[а-яё]/.test(to)) {
      return to.charAt(0).toUpperCase() + to.slice(1);
    }
    return to;
  });
}

const BORING_LINE_RE =
  /^(?:ок|окей|ага|угу|аа+|уу+|мм+|хм+|ну|да|нет|неа|лол|кек|👍|😂|🔥|❤️|❤|😁|🙂|😊|а+|у+)\s*[).!]*$/i;

/** Выкинуть пустые кивки из пачки, если есть хоть одна «живая» строка. */
function filterBoringBatch(texts) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || '').trim()).filter(Boolean);
  if (list.length <= 1) return list;
  const rich = list.filter((t) => !BORING_LINE_RE.test(t) && t.length >= 6);
  if (rich.length) return rich;
  return list.slice(-1);
}

const MIRROR_TAIL_RE =
  /\s*[.,!]?\s*(?:а\s+)?ты\s+(?:откуда|где|чем\s+занима|кем\s+работа|как\s+там|что\s+делаешь|из\s+какого)[^?\n]*\?\s*$/i;
const SOFT_MIRROR_RE =
  /\s*[.,!]?\s*(?:а\s+ты\??|а\s+у\s+тебя\??|and\s+you\??|what\s+about\s+you\??)\s*$/i;
const USER_MIRRORED_RE =
  /(?:^|\n)\s*(?:а\s+)?(?:ты|у\s+тебя)\s*(?:\?|$)|а\s+ты\s+как|а\s+у\s+тебя\s+как/i;

/** Если он только что зеркалил «а ты?» — не зеркалим обратно. */
function stripAntiMirror(reply, userMessage) {
  if (!reply) return reply;
  const original = String(reply).trim();
  let text = original;
  const userMirrored = USER_MIRRORED_RE.test(String(userMessage || ''));
  if (MIRROR_TAIL_RE.test(text) || SOFT_MIRROR_RE.test(text) || (userMirrored && /\?\s*$/.test(text))) {
    text = text.replace(MIRROR_TAIL_RE, '').replace(SOFT_MIRROR_RE, '').trim();
    if (userMirrored && /\?\s*$/.test(text) && text.split(/\s+/).length <= 12) {
      text = text.replace(/\s*\?[)\s]*$/, '').trim();
    }
    // Оставляем то, что осталось после среза зеркала (даже короткое «норм)»).
    // Пустой хвост → исходник целиком, без подмены на «ага)».
    if (text.length >= 2) return text;
    return original;
  }
  return reply;
}

function plainLen(text) {
  return String(text || '')
    .replace(/<<[^>]+>>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

const USER_SHORT_ACK_ONLY_RE =
  /^(?:ну\s+|да\s+|а\s+)?(?:ага|угу|ок|окей|ладно|понял[а]?|ясно|норм|хорошо|спс|спасибо|лол|кек|хм+|мм+|аа+)\s*[).!]?\s*$/i;

/**
 * Эхо длины только на голые «ок/ага» — не режем ответ на нормальные реплики
 * и вопросы («почему?», «в смысле?»), иначе получается «на отъебись».
 */
function echoLengthClip(userMessage, reply) {
  if (!reply) return reply;
  const bare = String(userMessage || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!bare || !USER_SHORT_ACK_ONLY_RE.test(bare)) return reply;
  const text = String(reply).trim();
  if (plainLen(text) <= 40) return reply;
  const first = text.split(/\n/)[0].trim();
  let cut = first.split(/(?<=[).!?…])\s+/).filter(Boolean)[0] || first;
  const words = cut.split(/\s+/).filter(Boolean);
  if (words.length > 10) {
    cut = words.slice(0, 7 + Math.floor(Math.random() * 3)).join(' ');
    if (!/[)….!?]$/.test(cut) && Math.random() < 0.55) cut += ')';
  }
  if (cut.length >= 8 && cut.length < text.length) return cut;
  return reply;
}

const AFTERTHOUGHTS = [
  'а ещё)',
  'кстати да)',
  'ой и ещё)',
  'забыла сказать)',
  'ну и всё)',
];

function pickAfterthought(prevOutText) {
  const prev = String(prevOutText || '');
  if (!prev || prev.length < 8) return null;
  if (/\?/.test(prev)) return null;
  if (/<<|\[медиа|\[голосовое/i.test(prev)) return null;
  if (prev.length > 120) return null;
  return AFTERTHOUGHTS[Math.floor(Math.random() * AFTERTHOUGHTS.length)];
}

function afterthoughtDelayMs(accountId) {
  const pace = getAccountPace(accountId);
  if (Math.random() > pace.afterthoughtChance) return null;
  return 20000 + Math.floor(Math.random() * 70000);
}

/** Реакция уже есть + текст: иногда сначала реакция, текст через паузу. */
function reactThenTextDelayMs(accountId, reaction, outText) {
  if (!reaction || !outText) return 0;
  const pace = getAccountPace(accountId);
  if (Math.random() > pace.reactThenTextChance) return 0;
  return 8000 + Math.floor(Math.random() * 28000);
}

const MORNING_APOLOGY =
  'Он писал, пока ты спала / не была на связи. Начни с короткого «сорян только увидела)» / «ой только сейчас)» — ' +
  'потом сразу по сути его сообщения. Без длинных оправданий.';

/**
 * Утро после ночи: сообщение старше N часов или час МСК 8–12 и возраст > 4ч.
 */
function needsMorningApology(messageDate, now = new Date()) {
  if (!messageDate) return false;
  const msg = messageDate instanceof Date ? messageDate : new Date(messageDate);
  if (Number.isNaN(msg.getTime())) return false;
  const ageH = (now.getTime() - msg.getTime()) / 3600000;
  if (ageH < 3.5) return false;
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .find((p) => p.type === 'hour')?.value || 12,
  ) % 24;
  // Ночное письмо (он писал 23–7) + сейчас утро/день
  const msgHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(msg)
      .find((p) => p.type === 'hour')?.value || 12,
  ) % 24;
  const wroteAtNight = msgHour >= 23 || msgHour < 7;
  if (wroteAtNight && hour >= 7 && hour < 14 && ageH >= 3.5) return true;
  if (ageH >= 8 && hour >= 8 && hour < 13) return true;
  return false;
}

function morningApologyHint() {
  return MORNING_APOLOGY;
}

/** Она молчала >40 мин после своего сообщения — «отвлеклась». */
function awayReturnHint(lastAssistantAgeMin) {
  if (lastAssistantAgeMin == null || lastAssistantAgeMin < 40) return null;
  if (lastAssistantAgeMin > 20 * 60) return null;
  return (
    'Ты давно не отвечала в этом чате (отвлеклась). Можно коротко «сорри отвлеклась)» / «ой только увидела)» ' +
    'перед ответом по сути — не обязательно, и без эссе.'
  );
}

async function lastAssistantAgeMinutes(db, accountId, peerId) {
  try {
    const [[row]] = await db.execute(
      `SELECT TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS age_min
       FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       ORDER BY id DESC LIMIT 1`,
      [accountId, String(peerId)],
    );
    return row?.age_min == null ? null : Number(row.age_min);
  } catch (_) {
    return null;
  }
}

/**
 * Хинт «вернись к его мелочи» если в недавних user есть конкретное существительное
 * и мы ещё не спрашивали про него (лёгкий, без БД — дополняет memoryTriggers).
 */
function buildHisDetailCallbackHint(history, userMessage) {
  const hist = Array.isArray(history) ? history : [];
  if (hist.length < 6) return null;
  const users = hist
    .filter((h) => h && h.role === 'user')
    .slice(-8)
    .map((h) => String(h.content || ''));
  const blob = `${users.join('\n')}\n${userMessage || ''}`;
  const m = blob.match(
    /(?:машин|смен|работ|собак|кот|кошк|тренир|матч|сериал|экзамен|переезд|мама|пап)\w*/i,
  );
  if (!m) return null;
  const key = m[0].toLowerCase().slice(0, 12);
  const recentBot = hist
    .filter((h) => h && h.role === 'assistant')
    .slice(-6)
    .map((h) => String(h.content || '').toLowerCase())
    .join('\n');
  if (recentBot.includes(key)) return null;
  if (Math.random() > 0.12) return null;
  return (
    `Можно вскользь вернуться к его теме «${m[0]}» одной короткой фразой или вопросом — ` +
    'только если сейчас не другой острый вопрос. Не каждый ответ.'
  );
}

module.exports = {
  getAccountPace,
  slangHintForAccount,
  applyAccountSlang,
  filterBoringBatch,
  stripAntiMirror,
  echoLengthClip,
  pickAfterthought,
  afterthoughtDelayMs,
  reactThenTextDelayMs,
  needsMorningApology,
  morningApologyHint,
  awayReturnHint,
  lastAssistantAgeMinutes,
  buildHisDetailCallbackHint,
  SLANG_SETS,
};
