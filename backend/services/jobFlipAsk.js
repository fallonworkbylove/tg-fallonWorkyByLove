/**
 * На явный вопрос «кем работаешь / чем занимаешься» —
 * короткий ответ про флип + хвост «слышал о таком?)».
 * Не трогаем day-ask («чем занята / что делаешь») и explain («что такое флип»).
 *
 * День 1 (age < 24ч или короткий диалог): только «онлайн / сама на себя» —
 * без флип/токен/NFT (иначе палево, как у Артура).
 */

const HEARD_RE =
  /слыш(?:ал|ала|али)\s+(?:что[- ]?нибудь\s+)?о\s+таком|в\s+курсе\s+(?:такого|такого\s+вообще)|знакомо\s+такое|ты\s+в\s+теме\s*\?|бывало\s+слышать|не\s+сталкивался|слышал\s+ли\s+(?:ты\s+)?(?:что[- ]?нибудь\s+)?(?:о\s+таком|про\s+так)/i;
const FLIP_MARK_RE = /флип|токен|\bnft\b|нфт|крипт/i;
/** Говорит про свою работу/занятость (не «убегу по работе»). */
const WORK_TALK_RE =
  /флип|токен|\bnft\b|нфт|крипт|подработ|работаю\s+онлайн|удал[её]нн?\w*|сама\s+на\s+себя|занимаюсь\s+(?:флип|онлайн)|в\s+интернете\s+подраб/i;
const WORK_ASIDE_LEAVE_RE =
  /убегу\s+по\s+работ|по\s+работе\s+затык|разрулить|чуть\s+позже\s+(?:напиш|вернусь)|надо\s+решить\s+одно\s+по\s+работ/i;

const FLIP_EXPLAIN_RE =
  /что\s+(?:за|такое)\s+флип|флип[а-яё]*\s+это|что\s+за\s+токен|какие\s+токен|что\s+такое\s+(?:токен|nft|нфт)|how\s+does\s+(?:flip|nft)/i;

const PORTFOLIO_RE =
  /покажи\s+(?:примеры|работы)|примеры\s+(?:своих\s+)?работ|скинь\s+(?:работы|примеры)|портфолио/i;

const EARNINGS_RE =
  /(?:сколько|скок)\s+(?:ты\s+)?(?:уже\s+)?(?:заработ|заработал|заработала)|(?:много|хорошо)\s+(?:ли\s+)?(?:ты\s+)?заработ/i;

/** Явный вопрос про её занятость/работу (не «чем занята сейчас»). Без \b — кириллица. */
const JOB_OCCUPATION_RE =
  /(?:кем|где)\s+(?:ты\s+)?работ|ты\s+(?:не\s+)?работаешь(?![а-яё])|а\s+ты\s+работа|ты\s+где\s+работа|чем\s+(?:ты\s+)?занимаешься(?![а-яё])|чем\s+ты\s+работа|а\s+работа\s*\?|какая\s+(?:у\s+тебя\s+)?работа|а\s+кем\s+ты\s*\?|кем\s+ты\s*\?|ты\s+кем\s*\?|чем\s+(?:ты\s+)?зарабатыва|на\s+что\s+(?:ты\s+)?жив[её]шь|откуда\s+(?:деньги|доход)|what\s+do\s+you\s+do(?:\s+for\s+(?:a\s+)?living|\s+work)?|where\s+do\s+you\s+work|do\s+you\s+work(?![a-z])/i;

const DAY_ONLY_RE =
  /чем\s+занята|что\s+делаешь|чё\s+делаешь|че\s+делаешь|как\s+дела|как\s+день|что\s+нового|чем\s+занят[аы]?\s+сейчас|чем\s+(?:ты\s+)?занимаешься\s+(?:сейчас|щас|прямо)/i;

const FLIP_MIN_AGE_HOURS = 24;
/** Если age неизвестен — не питчим флип, пока диалог коротковат (день 1). */
const FLIP_MIN_HISTORY_WHEN_NO_AGE = 8;

const FLIP_LINES = [
  'флипаю токены онлайн, сама на себя)',
  'онлайн, флипинг токенов)',
  'удалённо токены флипаю)',
];

const SOFT_JOB_LINES = [
  'занимаюсь флипингом цифровых токенов)',
  'да так, подрабатываю в интернете)',
  'работаю онлайн, сама на себя)',
];

/** День 1: можно флип/токен, нельзя NFT/крипта/«слышал». */
const DAY1_HARD_BAN_RE = /\bnft\b|нфт|крипт|бирж|слышал\s+о\s+таком/i;

const HEARD_TAILS = [
  'слышал о таком?)',
  'ты слышал о таком?)',
  'а ты слышал о таком?)',
  'слышал что-нибудь о таком?)',
  'а ты слышал ли про такое?)',
  'ты в курсе такого?)',
];

/** Мягкие хвосты A/B (реже «слышал» в лоб). */
const HEARD_TAILS_SOFT = [
  'знакомо такое?)',
  'ты в теме?)',
  'бывало слышать?)',
  'не сталкивался?)',
];

/**
 * A/B: ~60% жёсткий «слышал…», ~40% мягче.
 * accountId стабильно бакетит peer (если передан).
 */
function pickHeardTail(opts = {}) {
  const roll = typeof opts.random === 'function' ? opts.random() : Math.random();
  const softShare = opts.softShare != null ? Number(opts.softShare) : 0.4;
  const useSoft = roll < softShare;
  const pool = useSoft ? HEARD_TAILS_SOFT : HEARD_TAILS;
  return { text: pick(pool), variant: useSoft ? 'soft' : 'hard' };
}

/** Уже спрашивала «слышал о таком» в хвосте диалога. */
function heardAskedRecently(history, within = 14) {
  const list = Array.isArray(history) ? history : [];
  return list.slice(-Math.max(4, within)).some(
    (m) => m && m.role === 'assistant' && HEARD_RE.test(String(m.content || '')),
  );
}

function bare(text) {
  return String(text || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .replace(/<<[^>\n]+>>/g, '')
    .trim();
}

function isJobOccupationAsk(userMessage) {
  const msg = bare(userMessage);
  if (!msg) return false;
  if (FLIP_EXPLAIN_RE.test(msg) || PORTFOLIO_RE.test(msg) || EARNINGS_RE.test(msg)) return false;
  // «чем занята» / «что делаешь» без occupation — day
  if (/чем\s+занята|что\s+делаешь|чё\s+делаешь|че\s+делаешь/i.test(msg) && !JOB_OCCUPATION_RE.test(msg)) {
    return false;
  }
  if (DAY_ONLY_RE.test(msg) && !JOB_OCCUPATION_RE.test(msg)) return false;
  if (JOB_OCCUPATION_RE.test(msg)) return true;
  // AboutHerJob (дизайн/портфолио уже отсечены): «ты работаешь?» и т.п.
  try {
    const oh = require('./objectionHandler');
    if (typeof oh.isAboutHerJobQuestion === 'function' && oh.isAboutHerJobQuestion(msg)) {
      if (/дизайн|figma|photoshop|портфолио|примеры\s+работ/i.test(msg)) return false;
      return true;
    }
  } catch (_) {
    /* optional */
  }
  return false;
}

function flipAlreadyTold(history) {
  return (Array.isArray(history) ? history : []).some(
    (m) => m && m.role === 'assistant' && FLIP_MARK_RE.test(String(m.content || '')),
  );
}

/**
 * Можно ли говорить флип/NFT/токены.
 * false на 1-й день сессии (<24ч) или коротком диалоге без age.
 */
function mayMentionFlipNft({ ageHours = null, history = null } = {}) {
  if (ageHours != null && Number.isFinite(Number(ageHours)) && Number(ageHours) < FLIP_MIN_AGE_HOURS) {
    return false;
  }
  if (ageHours == null) {
    const n = Array.isArray(history) ? history.length : 0;
    if (n < FLIP_MIN_HISTORY_WHEN_NO_AGE) return false;
  }
  return true;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function softJobHint() {
  return (
    'Собеседник спросил ПРО ТВОЮ РАБОТУ / чем занимаешься (день 1). ' +
    'Коротко одно из: «занимаюсь флипингом цифровых токенов)» ИЛИ «да так, подрабатываю в интернете)». ' +
    'Можно «онлайн / сама на себя». ' +
    'ЗАПРЕЩЕНО: NFT, нфт, крипта, биржа, цифры дохода, «слышал о таком», платформа, ссылки. 1–2 короткие фразы.'
  );
}

function jobFlipHint(userMessage, opts = {}) {
  if (!isJobOccupationAsk(userMessage)) return null;
  if (!mayMentionFlipNft(opts)) return softJobHint();
  // Уже говорила про флип — не пихай снова «слышал о таком» как первый питч
  if (flipAlreadyTold(opts.history)) {
    return (
      'Собеседник спросил про работу, но флип ты УЖЕ упоминала в этом диалоге. ' +
      'Коротко: «ну да онлайн)», «сама на себя, гибкий график)» — БЕЗ повторного разжёвывания флипа и БЕЗ «слышал о таком?)». ' +
      '1 короткая фраза.'
    );
  }
  return (
    'Собеседник спросил ПРО ТВОЮ РАБОТУ / чем занимаешься. ' +
    'ОБЯЗАТЕЛЬНО в первом предложении: флипинг токенов / онлайн / сама на себя (как в легенде). ' +
    'В конце ОДИН вопрос: «слышал о таком?)» / «ты слышал о таком?)». ' +
    'Без цифр дохода, без дизайна/figma, без «давай тут общаться». 1–2 короткие фразы.'
  );
}

function stripFlipMarks(body) {
  let out = String(body || '');
  out = out
    .replace(/[^.!?\n]*(?:флип|токен|\bnft\b|нфт|крипт)[^.!?\n]*/gi, ' ')
    .replace(/\s*(?:слышал|ты слышал|а ты слышал)\s+о\s+таком\s*[?)]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([).,!])/g, '$1')
    .trim();
  return out;
}

/**
 * Постфильтр: на occupation-ask — флип+слышал (со 2 дня) или мягкий онлайн (день 1).
 */
function ensureJobFlipHeardAsk(reply, userMessage, opts = {}) {
  if (!reply || !isJobOccupationAsk(userMessage)) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]*>>\s*/) || [''])[0];
  let body = String(reply).slice(tag.length).trim();
  if (!body || /^<<(?:REACT|PHOTO|VIDEO|CIRCLE)/i.test(body)) return reply;

  const allowFlip = mayMentionFlipNft(opts);
  const already = flipAlreadyTold(opts.history);

  if (!allowFlip) {
    // День 1: флип/токен ок; NFT/крипта/«слышал» — вычистить
    if (DAY1_HARD_BAN_RE.test(body) || HEARD_RE.test(body)) {
      body = body
        .replace(/[^.!?\n]*(?:\bnft\b|нфт|крипт|бирж)[^.!?\n]*/gi, ' ')
        .replace(/\s*(?:слышал|ты слышал|а ты слышал)\s+о\s+таком\s*[?)]*/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    if (
      !body ||
      body.length < 6 ||
      !/онлайн|удал[её]н|сама\s+на\s+себя|гибк|флип|токен|интернет|подработ/i.test(body)
    ) {
      body = pick(SOFT_JOB_LINES);
    }
    return tag + body;
  }

  // Уже питчили — не форсим второй раз эталон с «слышал»
  if (already) {
    if (FLIP_MARK_RE.test(body) && HEARD_RE.test(body)) {
      body = body.replace(/\s*(?:слышал|ты слышал|а ты слышал)\s+о\s+таком\s*[?)]*/gi, '').trim();
      if (!body) body = pick(SOFT_JOB_LINES);
    }
    return tag + body;
  }

  const hasFlip = FLIP_MARK_RE.test(body);
  const hasHeard = HEARD_RE.test(body);

  if (hasFlip && hasHeard) {
    return tag + body;
  }

  if (hasFlip && !hasHeard) {
    const cleaned = body.replace(/\s*[?)]+\s*$/, '').trim();
    body = `${cleaned} ${pickHeardTail(opts).text}`.replace(/\s{2,}/g, ' ').trim();
    return tag + body;
  }

  body = `${pick(FLIP_LINES)} ${pickHeardTail(opts).text}`.replace(/\s{2,}/g, ' ').trim();
  return tag + body;
}

/**
 * Если ИИ сама заговорила про работу/флип — с высоким шансом хвост
 * «слышал о таком?)» / «слышал что-нибудь о таком?)».
 * Не дублирует ensureJobFlipHeardAsk (тот — на явный вопрос про работу).
 */
function maybeAppendHeardAskOnWorkTalk(reply, userMessage, opts = {}) {
  if (!reply) return reply;
  if (!mayMentionFlipNft(opts)) return reply;
  if (isJobOccupationAsk(userMessage)) return reply;
  if (heardAskedRecently(opts.history)) return reply;

  const tag = (String(reply).match(/^\s*<<[^>\n]*>>\s*/) || [''])[0];
  let body = String(reply).slice(tag.length).trim();
  if (!body || /^<<(?:REACT|PHOTO|VIDEO|CIRCLE)/i.test(body)) return reply;
  if (HEARD_RE.test(body)) return reply;
  if (WORK_ASIDE_LEAVE_RE.test(body)) return reply;
  if (!WORK_TALK_RE.test(body)) return reply;

  // A/B: мягкий вариант реже цепляет «слышал» на work-talk (0.7 vs 0.85).
  const baseChance = opts.chance != null ? Number(opts.chance) : 0.85;
  const softShare = opts.softShare != null ? Number(opts.softShare) : 0.4;
  const rnd = typeof opts.random === 'function' ? opts.random : Math.random;
  const useSoft = rnd() < softShare;
  const chance = useSoft ? Math.min(baseChance, 0.7) : baseChance;
  if (!(rnd() < chance)) return reply;

  const cleaned = body.replace(/\s*[?)]+\s*$/, '').trim();
  const tail = useSoft ? pick(HEARD_TAILS_SOFT) : pick(HEARD_TAILS);
  body = `${cleaned} ${tail}`.replace(/\s{2,}/g, ' ').trim();
  return tag + body;
}

module.exports = {
  isJobOccupationAsk,
  jobFlipHint,
  ensureJobFlipHeardAsk,
  maybeAppendHeardAskOnWorkTalk,
  mayMentionFlipNft,
  flipAlreadyTold,
  heardAskedRecently,
  softJobHint,
  pickHeardTail,
  JOB_OCCUPATION_RE,
  HEARD_RE,
  FLIP_MARK_RE,
  WORK_TALK_RE,
  HEARD_TAILS,
  HEARD_TAILS_SOFT,
  FLIP_MIN_AGE_HOURS,
};
