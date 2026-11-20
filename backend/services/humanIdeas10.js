/**
 * 10 идей человечности (0gh):
 * 1 карта «уже сказала»  2 life-lag 1–3м  3 зеркало его темы
 * 4 кривая память раз/день  5 настроение→длина  6 сорри спала
 * 7 анти кофе+сериал+гулять  8 чаще реакция  9 мягкий спор  10 вечерний крючок
 */
const db = require('../db');

const forgetUsedToday = new Map(); // accountId:peerId:day -> true

function mskDayKey(d = new Date()) {
  const msk = new Date(d.getTime() + 3 * 3600 * 1000);
  return msk.toISOString().slice(0, 10);
}

function peerDayKey(accountId, peerId) {
  return `${accountId}:${peerId}:${mskDayKey()}`;
}

/** #1 усиление: уже сказала — жёсткий бан повтора */
function strengthenSelfToldBan(memoryHint) {
  const h = String(memoryHint || '');
  if (!/Ты УЖЕ рассказывала/i.test(h)) return memoryHint;
  if (/НЕ повторяй как новость|ЗАПРЕЩЕНО снова подавать как новость/i.test(h)) return memoryHint;
  return (
    h +
    '\nНЕ повторяй как новость то, что в списке «УЖЕ рассказывала» ' +
    '(город / работа / хобби / переезд). Если спросит — коротко кивни «ну да)» без пересказа.'
  );
}

/**
 * #2 life-lag: иногда 25–55с короткая пауза перед ответом.
 * Не на вопросы/? / медиа-просьбы / императивы — иначе 90с+restart = тишина навсегда
 * (read уже проставлен, catch-up непрочитанных не подхватит).
 */
function maybeLifeLagMs(userMessage, { leadTier = 'cold' } = {}) {
  const t = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/g, '')
    .trim();
  if (!t || t.length < 8) return 0;
  if (/[?]/.test(t)) return 0;
  if (/^(?:ок|ага|угу|ладно|норм|кайф)\s*[)!.]*$/i.test(t)) return 0;
  // медиа / «можешь записать» / лайф — без лага (\b ломается на кириллице)
  const cy = '(?![а-яёa-z])';
  if (
    new RegExp(
      `(?:скинь|скинешь|кинь|пришли|отправь|покажи|запиши|запишешь|сфоткай|можешь|можно|давай)${cy}`,
      'i',
    ).test(t) &&
    new RegExp(
      `(?:фото|фотк|селфи|видео|видос|кружок|кружоч|лайф|live|себя)${cy}`,
      'i',
    ).test(t)
  ) {
    return 0;
  }
  if (
    new RegExp(
      `(?:можешь|скинь|запиши|пришли)${cy}.{0,40}(?:видео|круж|фот|лайф)`,
      'i',
    ).test(t)
  ) {
    return 0;
  }
  // вопросительные без «?» («чего в липецке жила», «как и вчера» — не лаг)
  if (
    new RegExp(
      `^(?:ну\\s+|а\\s+|и\\s+)?(?:что|чё|че|чего|как|чем|где|куда|когда|почему|зачем|кто|сколько)${cy}`,
      'i',
    ).test(t)
  ) {
    return 0;
  }
  const p = leadTier === 'hot' ? 0.04 : leadTier === 'warm' ? 0.06 : 0.08;
  if (Math.random() > p) return 0;
  return 25_000 + Math.floor(Math.random() * 30_000);
}

function lifeLagPrefixChance() {
  return Math.random() < 0.55;
}

// Без «отвлеклась» — иначе эхо в логах (0mb/0me).
const LIFE_LAG_PREFIXES = [
  'ой тут)',
  'а, только увидела)',
  'сек)',
  'сорри, была занята)',
  'ой сорри)',
];

function pickLifeLagPrefix() {
  return LIFE_LAG_PREFIXES[Math.floor(Math.random() * LIFE_LAG_PREFIXES.length)];
}

/** #3 зеркало его темы ~70% если есть якорь */
function buildMirrorHisTopicHint(history, userMessage) {
  const hist = Array.isArray(history) ? history : [];
  const lastUser = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
  if (!lastUser || lastUser.length < 10) return null;
  if (/[?]/.test(lastUser) && lastUser.length < 40) return null; // короткий вопрос — сначала ответ
  const m = lastUser.match(
    /(?:машин|смен|работ|зал|качалк|температур|болез|собак|кот|кошк|сериал|книг|переезд|мама|пап|мото|авто)\w*/i,
  );
  if (!m) return null;
  if (Math.random() > 0.7) return null;
  return (
    `Сейчас держись ЕГО темы «${m[0]}»: реакция/вопрос про него. Своё (работа/хобби) — максимум полфразы, не питч. ` +
    '≈70% внимания на него.'
  );
}

/** #4 кривая память — раз в день на пира */
function maybeForgetHintOnce(accountId, peerId, baseForgetHint) {
  if (!baseForgetHint || accountId == null || peerId == null) return null;
  const k = peerDayKey(accountId, peerId);
  if (forgetUsedToday.has(k)) return null;
  forgetUsedToday.set(k, true);
  return baseForgetHint;
}

/** #5 настроение → жёстче длина */
function applyMoodLengthBias(reply, mood) {
  const m = String(mood || 'neutral');
  const text = String(reply || '');
  if (!text) return reply;
  if (m === 'tired' || m === 'sad' || m === 'apathetic') {
    if (text.length <= 70) return reply;
    const first = text.split(/\n/)[0].trim();
    let cut = first.split(/(?<=[).!?…])\s+/).filter(Boolean)[0] || first;
    const words = cut.split(/\s+/).filter(Boolean);
    if (words.length > 8) cut = words.slice(0, 6 + Math.floor(Math.random() * 2)).join(' ');
    if (cut.length >= 6 && cut.length < text.length) {
      if (!/[)….!?]$/.test(cut) && Math.random() < 0.5) cut += ')';
      return cut;
    }
  }
  return reply;
}

/** #6 утренний досыл после тишины */
function morningApologySleptHint() {
  return (
    'Он писал, пока ты спала / была оффлайн. Начни с «сорри спала)» / «сорян только увидела)» / «ой проспала)» — ' +
    'потом сразу по сути. Без эссе и без пачки идеальных ответов.'
  );
}

/** #7 анти-шаблон кофе+сериалы+гулять (+ «путешествия и кофе» / «увлечения…»). */
const COFFEE_SERIES_WALK_RE =
  /кофе.{0,40}сериал.{0,40}(?:гул|прогул)|сериал.{0,40}кофе.{0,40}(?:гул|прогул)|кофе.{0,40}(?:гул|прогул).{0,40}сериал|(?:люблю|кайфую).{0,20}кофе.{0,30}сериал.{0,30}(?:гул|прогул)|увлечен\w*.{0,40}(?:путешеств|кофе)|(?:путешеств\w*.{0,30}кофе|кофе.{0,30}путешеств)|люблю\s+путешеств\w*.{0,20}кофе|рассказать\s+о\s+своих\s+увлечен/i;

const ALT_HOBBY_POOL = [
  'иногда в зал хожу, когда не лень)',
  'люблю ночью музыку фоном)',
  'готовлю что-то простое, без шедевра)',
  'фоткаю ерунду на телефон)',
  'пересматриваю старые фильмы)',
  'иногда рисую в блокноте)',
  'просто туплю в рилсах, грешна)',
];

function stripCoffeeSeriesWalkCombo(reply, history) {
  const out = String(reply || '');
  if (!COFFEE_SERIES_WALK_RE.test(out)) return out;
  const already = (Array.isArray(history) ? history : []).some(
    (m) => m && m.role === 'assistant' && COFFEE_SERIES_WALK_RE.test(String(m.content || '')),
  );
  // Даже первый раз — слишком шаблонно; режем всегда.
  void already;
  return ALT_HOBBY_POOL[Math.floor(Math.random() * ALT_HOBBY_POOL.length)];
}

function altHobbyHint(accountId) {
  if (Math.random() > 0.25) return null;
  const i = Math.abs(Number(accountId) || 0) % ALT_HOBBY_POOL.length;
  return (
    `Если спросит хобби — НЕ шаблон «кофе + сериалы + гулять». Вариант в твоём стиле: «${ALT_HOBBY_POOL[i]}» ` +
    '(своими словами, одно).'
  );
}

/** #9 мягкий спор чаще */
function mildDisagreeHint() {
  if (Math.random() > 0.22) return null;
  return (
    'Можно мягко не согласиться с мелочью («хм спорно)», «не, мне книги скучно)», «ну хз, я бы так не») — ' +
    'без конфликта и без лекции. Не каждый ответ.'
  );
}

/**
 * #10 вечерний крючок: факт о нём с сегодняшнего утра.
 */
async function buildEveningRecallHint(accountId, peerId) {
  try {
    const { mediaTimeSlot } = require('./opsQuality');
    if (mediaTimeSlot() !== 'evening') return null;
    if (Math.random() > 0.35) return null;
    const [rows] = await db.execute(
      `SELECT fact_type, fact_text FROM peer_memory_facts
       WHERE account_id = ? AND peer_id = ?
         AND created_at >= (NOW() - INTERVAL 14 HOUR)
         AND fact_type IN ('hobby','pet','work','plans','health','pref')
       ORDER BY id DESC LIMIT 3`,
      [accountId, String(peerId)],
    );
    if (!rows || !rows.length) return null;
    const f = rows[0];
    return (
      `Вечер: можно одной фразой вернуться к тому, что он говорил сегодня утром/днём ` +
      `(«${String(f.fact_text).slice(0, 50)}») — без допроса и без продажи. Не обязательно.`
    );
  } catch (_) {
    return null;
  }
}

module.exports = {
  strengthenSelfToldBan,
  maybeLifeLagMs,
  lifeLagPrefixChance,
  pickLifeLagPrefix,
  LIFE_LAG_PREFIXES,
  buildMirrorHisTopicHint,
  maybeForgetHintOnce,
  applyMoodLengthBias,
  morningApologySleptHint,
  stripCoffeeSeriesWalkCombo,
  altHobbyHint,
  mildDisagreeHint,
  buildEveningRecallHint,
  COFFEE_SERIES_WALK_RE,
  ALT_HOBBY_POOL,
};
