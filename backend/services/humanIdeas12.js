/**
 * humanIdeas12 (0gt) — пакет улучшений общения:
 * 1 ротация ответа на «что делаешь»
 * 2 тон (холодный / тёплый)
 * 3 один факт за ход
 * 4 отложенный интерес («потом»)
 * 5 анти-допрос (≤1 вопрос если уже 2 наших ?)
 * 6 анти ложный «не расслышала»
 * 7 бытовое фото без NFT-питча
 * 8 микро-текстура времени суток
 */

// НЕ трогать «где живёшь / в каком городе» — это гео, не статус «чем занята».
const STATUS_ASK_RE =
  /что\s+(?:делаешь|поделываешь|там)|чем\s+(?:занят(?:а)?|занимаешься)|как\s+(?:дела|жизнь|ты)(?=$|[\s?!.])|[чc][её]\s+делаешь|(?:^|[\s?])ты\s+где\s*\??\s*$/i;

const STATUS_POOL = [
  'кофе остыл, сижу с телефоном)',
  'сериалы листаю бездумно)',
  'ногти красила криво, переделываю)',
  'соседи сверлят, схожу с ума)',
  'заказала еду и жду курьера)',
  'в пледе сижу, лень даже встать)',
  'мама звонила, только повесила)',
  'искала зарядку полчаса)',
  'на балконе курю и мёрзну)',
  'рисую фигню в заметках)',
  'душ приняла, волосы сушу)',
  'музыку кручу и туплю в потолок)',
  'убирала стол и залипла в рилсы)',
  'чай заварила, теперь ок)',
  'работала чуть, глаза устали)',
  'просто дома, ничего героического)',
  'с котом деру за плед)',
  'окно открыла, холодно но приятно)',
  'новости листала — лучше бы не)',
  'пишу тебе вот)',
  'собиралась выйти и передумала)',
  'стирку кручу, романтика)',
];

/** accountId:peerId → recent status lines */
const recentStatusByPeer = new Map();

const COLD_TONE_RE =
  /(?:пошел|пошёл|отстань|не пиши|скучн|беси|дур[аы]|туп[ао]|заткни|отвали|какая\s+разница|неинтересно)/i;

const WARM_TONE_RE =
  /(?:милая|красот|нрав|люблю|скучаю|😘|❤|❤️|обнима|целую|хорош\w+\s+ты|ты\s+класс)/i;

const MISHEAR_OUT_RE =
  /(?:чего-чего|не\s+расслышал[ао]?|не\s+поняла(?:\s+совсем)?|ещё\s+раз\??|а\?\s*$)/i;

const PHOTO_TAG_RE = /\[(?:фото|изображен|картинк|скрин)/i;

const NFT_PITCH_RE =
  /(?:флип|nft|токен|цифров\w+\s+актив|скрины?\s+прибыл|профит|заработ)/i;

const DEFER_INTEREST_OUT_RE =
  /(?:потом\s+расскаж|расскажешь\s+потом|потом\s+спрошу|позже\s+спрошу|интересн\w*,?\s+потом)/i;

const FACT_MARKERS = [
  /я\s+из\s+\S+/i,
  /живу\s+в\s+\S+/i,
  /мне\s+\d{2}\b/i,
  /работаю\s+(?:в|на)\s+\S+/i,
  /у\s+меня\s+(?:есть\s+)?(?:кот|собак|п[её]с)/i,
  /настроен\w*\s+(?:норм|плох|хорош)/i,
];

function peerKey(accountId, peerId) {
  return `${accountId}:${peerId}`;
}

function bareUser(msg) {
  return String(msg || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
}

function isStatusAsk(userMessage) {
  return STATUS_ASK_RE.test(bareUser(userMessage));
}

function pickStatusAskLine(accountId, peerId) {
  const key = peerKey(accountId || 0, peerId || '');
  const used = recentStatusByPeer.get(key) || [];
  const pool = STATUS_POOL.filter((l) => !used.includes(l));
  const pickFrom = pool.length ? pool : STATUS_POOL;
  const line = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  const next = [...used, line].slice(-8);
  recentStatusByPeer.set(key, next);
  return line;
}

/** Подмена шаблонных «дома сижу)» на ротацию с деталью. */
function rotateStatusAskReply(reply, userMessage, accountId, peerId) {
  if (!isStatusAsk(userMessage)) return reply;
  const out = String(reply || '').trim();
  const bland =
    /^(?:дома\s+сижу|да\s+так|ничего\s+особенного|пока\s+свободн|с\s+телефоном\s+вою|просто\s+дома)/i.test(
      out,
    ) || out.length < 12;
  if (!bland && !/дома\s+сижу\)?$/i.test(out)) return reply;
  return pickStatusAskLine(accountId, peerId);
}

function toneHint(userMessage) {
  const t = bareUser(userMessage);
  if (!t) return null;
  if (COLD_TONE_RE.test(t)) {
    return 'Он холодный/резкий — ответь короче и суше (1 короткая фраза), без милоты и без питча.';
  }
  if (WARM_TONE_RE.test(t)) {
    return 'Он тёплый — можно чуть мягче, но без липкости и без трёх фактов сразу.';
  }
  return null;
}

/** Не больше одного «факта о себе» за ход. */
function stripMultiSelfFacts(reply) {
  let out = String(reply || '');
  const hits = FACT_MARKERS.map((re) => ({ re, m: out.match(re) })).filter((x) => x.m);
  if (hits.length <= 1) return out;
  // оставляем первый факт, остальные вырезаем грубо по предложениям
  const sentences = out.split(/(?<=[.!)])\s+/);
  let keptFact = false;
  const kept = [];
  for (const s of sentences) {
    const isFact = FACT_MARKERS.some((re) => re.test(s));
    if (isFact) {
      if (keptFact) continue;
      keptFact = true;
    }
    kept.push(s);
  }
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim() || out;
}

function countAssistantQuestions(history, n = 4) {
  const hist = Array.isArray(history) ? history : [];
  let q = 0;
  let seen = 0;
  for (let i = hist.length - 1; i >= 0 && seen < n; i--) {
    if (!hist[i] || hist[i].role !== 'assistant') continue;
    seen += 1;
    const c = String(hist[i].content || '');
    if (/[?]/.test(c) && !/^\[реакция/i.test(c)) q += 1;
  }
  return q;
}

function antiInterrogationHint(history) {
  if (countAssistantQuestions(history, 4) < 2) return null;
  return (
    'Ты уже задала 2+ вопроса подряд — этот ход БЕЗ вопроса: только утверждение / кивок / деталь про себя. Без «?».'
  );
}

function stripQuestionsIfInterrogating(reply, history) {
  if (countAssistantQuestions(history, 4) < 2) return reply;
  let out = String(reply || '');
  if (!/[?]/.test(out)) return out;
  out = out
    .replace(/\?/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.!)])/g, '$1')
    .trim();
  return out || 'поняла тебя)';
}

/**
 * «не расслышала» только если входящее реально кривое:
 * голосовое / мусор / очень короткое без смысла.
 */
function stripFalseMishear(reply, userMessage) {
  const out = String(reply || '').trim();
  if (!MISHEAR_OUT_RE.test(out)) return reply;
  const u = bareUser(userMessage);
  const isVoice = /\[Голосовое\]/i.test(String(userMessage || ''));
  const garbage =
    !u ||
    u.length < 2 ||
    /^[.?!,…\s]+$/.test(u) ||
    /(?:хр+|ыы+|ааа+|эээ+|ммм+)\s*$/i.test(u) ||
    (u.length <= 4 && !/[а-яa-z]/i.test(u));
  if (isVoice || garbage) return reply;
  // нормальный текст — не прикидываться глухой
  const alts = ['поняла тебя)', 'ага, ясно)', 'ну ладно)', 'мм, поняла)'];
  return alts[Math.floor(Math.random() * alts.length)];
}

function casualPhotoHint(userMessage) {
  const raw = String(userMessage || '');
  if (!PHOTO_TAG_RE.test(raw) && !/отправил[аа]?\s+фото|скинул\s+фото/i.test(raw)) {
    return null;
  }
  return (
    'Он прислал бытовое фото/скрин — одна деталь из кадра (что видно), без NFT/флип/токенов и без «скинь ещё».'
  );
}

function stripNftPitchOnCasualPhoto(reply, userMessage) {
  const raw = String(userMessage || '');
  const isPhoto =
    PHOTO_TAG_RE.test(raw) || /отправил[аа]?\s+фото|скинул\s+фото/i.test(raw);
  if (!isPhoto) return reply;
  let out = String(reply || '');
  if (!NFT_PITCH_RE.test(out)) return out;
  out = out
    .replace(/[^.!?\n)]*(?:флип\w*|nft|токен\w*|профит\w*|цифров\w+\s+актив)[^.!?\n)]*[.!?\n)]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim();
  return out || 'о прикольно)';
}

function timeOfDayHint(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 3600 * 1000);
  const h = msk.getUTCHours();
  if (h >= 6 && h < 11) {
    return 'Сейчас утро МСК — лёгкий тон, без «доброй ночи», можно про кофе/сон.';
  }
  if (h >= 11 && h < 17) {
    return 'Сейчас день МСК — обычный быт, без ночного вайба.';
  }
  if (h >= 17 && h < 23) {
    return 'Сейчас вечер МСК — можно чуть мягче/домашнее, без утренних приветов.';
  }
  return 'Сейчас ночь МСК — короче, тише; не бодрись как днём.';
}

function detectDeferredInterest(reply) {
  return DEFER_INTEREST_OUT_RE.test(String(reply || ''));
}

function applyIdeas12Postfilters(reply, history, userMessage, accountId = null, peerId = null) {
  let out = String(reply || '');
  out = rotateStatusAskReply(out, userMessage, accountId, peerId);
  out = stripMultiSelfFacts(out);
  out = stripQuestionsIfInterrogating(out, history);
  out = stripFalseMishear(out, userMessage);
  out = stripNftPitchOnCasualPhoto(out, userMessage);
  return out;
}

function buildIdeas12Hints(history, userMessage) {
  const parts = [];
  const tone = toneHint(userMessage);
  if (tone) parts.push(tone);
  const anti = antiInterrogationHint(history);
  if (anti) parts.push(anti);
  const photo = casualPhotoHint(userMessage);
  if (photo) parts.push(photo);
  const tod = timeOfDayHint();
  if (tod) parts.push(tod);
  if (isStatusAsk(userMessage)) {
    parts.push(
      'Он спросил чем занята — ответь одной бытовой деталью дня текстом, НЕ эмодзи-реакцией и не голым «дома сижу)».',
    );
  }
  return parts.length ? parts.join('\n') : null;
}

module.exports = {
  STATUS_POOL,
  isStatusAsk,
  pickStatusAskLine,
  rotateStatusAskReply,
  toneHint,
  stripMultiSelfFacts,
  antiInterrogationHint,
  stripQuestionsIfInterrogating,
  stripFalseMishear,
  casualPhotoHint,
  stripNftPitchOnCasualPhoto,
  timeOfDayHint,
  detectDeferredInterest,
  applyIdeas12Postfilters,
  buildIdeas12Hints,
  COLD_TONE_RE,
  WARM_TONE_RE,
  MISHEAR_OUT_RE,
};
