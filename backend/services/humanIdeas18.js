/**
 * humanIdeas18 (0jg) — топ-8 идей личности (узко):
 * 1 длина как у него
 * 2 «кстати, ты ж говорил…» только из истории
 * 3 иногда мягко не соглашаться
 * 4 на встречу — «а ты когда?»
 * 5 на фото — деталь, не голое «красиво»
 * 6 второй «ты бот» — ещё короче
 * 7 тир близости (cold/warm/close)
 * 8 мелочь города/погоды без википедии
 */

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function bare(msg) {
  return String(msg || '')
    .replace(/^\[[^\]]*\]:?\s*/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(reply) {
  const tag = (String(reply || '').match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  return { tag, body: String(reply || '').slice(tag.length).trim() };
}

function wordCount(s) {
  return String(s || '')
    .replace(/<<[^>]+>>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function peerTier18(history) {
  const n = (Array.isArray(history) ? history : []).filter((m) => m && m.role === 'user').length;
  if (n < 8) return 'stranger';
  if (n < 20) return 'warm';
  return 'close';
}

/* ——— 1 длина как у него ——— */
function mirrorLength(reply, userMessage) {
  const u = bare(userMessage);
  if (!u || !reply) return reply;
  const uw = wordCount(u);
  if (uw > 8) return reply;
  const { tag, body } = stripTags(reply);
  if (wordCount(body) <= 12) return reply;
  // Режем до первой фразы / 12 слов.
  let first = body.split(/(?<=[)….!?])\s+/)[0] || body;
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length > 12) first = `${words.slice(0, 12).join(' ')})`;
  if (first.length < 6) return reply;
  return tag + first;
}

function lengthMirrorHint(userMessage) {
  const u = bare(userMessage);
  if (!u) return null;
  if (wordCount(u) <= 5) {
    return 'Он написал коротко — ответь тоже коротко (1 фраза, без эссе).';
  }
  return null;
}

/* ——— 2 память: крючок из его прошлых реплик ——— */
const MEMORY_HOOK_RE =
  /(?:работа\w*|смен\w*|зал|тренир|машин\w*|кот|собак|сестр\w*|брат|мама|пап\w*|универ|учёб|игрок|cs|dota|футбол|хоккей|гитар|нарису|рису|програм|код|nft|флип)/i;

function extractMemoryHook(history) {
  const users = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'user')
    .slice(-16)
    .map((m) => bare(m.content));
  for (let i = users.length - 1; i >= 0; i -= 1) {
    const t = users[i];
    if (t.length < 12 || t.length > 120) continue;
    if (!MEMORY_HOOK_RE.test(t)) continue;
    if (/^(?:ок|ага|угу|да|нет|неа|лол|ахах)\b/i.test(t)) continue;
    // Короткий кусок для хинта, не цитата целиком.
    const snippet = t.slice(0, 70).replace(/\s+/g, ' ').trim();
    return snippet;
  }
  return null;
}

function memoryCallbackHint(history, userMessage) {
  const turns = (Array.isArray(history) ? history : []).filter((m) => m && m.role === 'user')
    .length;
  if (turns < 6 || turns % 7 !== 0) return null;
  if (/^\?+$|^ок|^ага|^угу/i.test(bare(userMessage))) return null;
  const hook = extractMemoryHook(history);
  if (!hook) return null;
  return (
    `Если к месту — одной короткой отсылкой к тому, что он уже писал (не допрос): ` +
    `«кстати, ты ж про …» опираясь на смысл: «${hook}». Не выдумывай новых фактов.`
  );
}

/* ——— 3 мягкое несогласие ——— */
const AGREE_SPAM_RE =
  /^(?:ну\s+)?(?:да|ага|угу|согласна|точно|это\s+точно|полностью\s+согласна)(?![а-яё])/i;
const DISAGREE_ALTS = [
  'хм ну хз, мне наоборот)',
  'по-моему не всегда)',
  'если честно, я б по-другому)',
  'ну спорно) мне кажется иначе)',
];

function softDisagree(reply, history, userMessage) {
  const { tag, body } = stripTags(reply);
  if (!AGREE_SPAM_RE.test(body)) return reply;
  // Не спорить на факты/вопросы про неё.
  if (/\?/.test(bare(userMessage))) return reply;
  if (/(?:где|откуда|как\s+зовут|сколько\s+лет|ты\s+дома)/i.test(bare(userMessage))) {
    return reply;
  }
  const recentAgree = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-5)
    .filter((m) => AGREE_SPAM_RE.test(bare(m.content))).length;
  // Уже 2+ согласия подряд в истории + снова согласие → мягко поспорить.
  if (recentAgree < 2) return reply;
  return tag + pick(DISAGREE_ALTS);
}

function softDisagreeHint(history) {
  const recentAgree = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-5)
    .filter((m) => AGREE_SPAM_RE.test(bare(m.content))).length;
  if (recentAgree < 2) return null;
  return (
    'Уже пару раз подряд соглашалась. Можно мягко не согласиться: «хм ну хз, мне наоборот)» — без конфликта.'
  );
}

/* ——— 4 встреча: хвост «а ты когда?» ——— */
const MEET_INVITE_RE =
  /(?:давай\s+(?:встрет|погуля|сходим)|встретим(?:ся)?|увидимся|погуляем|в\s+гости|жду\s+тебя)/i;
const SOFT_MEET_BODY_RE =
  /как\s+буду|когда\s+приеду|на\s+месте|после\s+переезда|пересечём/i;
const MEET_COUNTER_ALTS = [
  'а ты сам когда обычно свободен?',
  'а тебе как удобнее по времени?',
  'ты сам часто гуляешь?)',
];

function meetCounterTail(reply, userMessage) {
  if (!MEET_INVITE_RE.test(bare(userMessage))) return reply;
  const { tag, body } = stripTags(reply);
  if (!SOFT_MEET_BODY_RE.test(body) && !/можно|погуля|встрет|приеду/i.test(body)) {
    return reply;
  }
  if (/\?/.test(body)) return reply;
  if (wordCount(body) > 18) return reply;
  return `${tag}${body.replace(/\)?\s*$/, '')}) ${pick(MEET_COUNTER_ALTS)}`;
}

function meetCounterHint(userMessage) {
  if (!MEET_INVITE_RE.test(bare(userMessage))) return null;
  return (
    'На зов встретиться: мягко «как буду на месте» + короткий вопрос ему «а ты когда свободен?» — без адреса и без «завтра в 6».'
  );
}

/* ——— 5 фото: не голое «красиво» ——— */
const GENERIC_PHOTO_RE =
  /^(?:(?:ну\s+)?(?:вау|ого|класс|круто|мило|красиво|огонь|огонь\)|супер|норм|прикольно)|(?:какая\s+)?красота)\s*[)!.]*$/i;
const PHOTO_DETAIL_ALTS = [
  'ого, свет класс)',
  'хах фон прикольный)',
  'мм настроение кадра)',
  'о, деталька зашла)',
];

function recentHadMedia(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-4)
    .some(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        /\[медиа:|фото|кружок|видео|\.jpg|\[photo/i.test(String(m.content || '')),
    );
}

function userSentMedia(userMessage) {
  return /\[медиа:|\[photo|прис[ла]л\s+(?:фото|круж|видео)|\[видео|\[круж/i.test(
    String(userMessage || ''),
  );
}

function fixGenericPhotoPraise(reply, history, userMessage) {
  if (!userSentMedia(userMessage) && !recentHadMedia(history)) return reply;
  const { tag, body } = stripTags(reply);
  if (!GENERIC_PHOTO_RE.test(body) && !/^(?:красиво|мило|класс)\s*\)?$/i.test(body)) {
    return reply;
  }
  return tag + pick(PHOTO_DETAIL_ALTS);
}

function photoDetailHint(userMessage, history) {
  if (!userSentMedia(userMessage) && !recentHadMedia(history)) return null;
  return (
    'Он прислал медиа — реакция на ДЕТАЛЬ (свет, фон, настроение кадра), не голое «красиво/мило)».'
  );
}

/* ——— 6 второй «ты бот» — ещё короче ——— */
const BOT_ACCUSE_RE =
  /(?:ты\s+(?:робот|бот)|это\s+(?:робот|бот)|точно\s+бот|нейросет|chatgpt|скрипт|как\s+бот|(?:^|[^а-яё])бот\s*\?)/i;
const BOT_SHORT_ALTS = ['хах)', 'ну ты чего)', 'смешно)', 'ага живая)'];

function countBotAccuses(history, userMessage) {
  let n = BOT_ACCUSE_RE.test(bare(userMessage)) ? 1 : 0;
  for (const m of Array.isArray(history) ? history : []) {
    if (m && m.role === 'user' && BOT_ACCUSE_RE.test(bare(m.content))) n += 1;
  }
  return n;
}

function shortenRepeatBotDefense(reply, history, userMessage) {
  if (!BOT_ACCUSE_RE.test(bare(userMessage))) return reply;
  if (countBotAccuses(history, userMessage) < 2) return reply;
  const { tag, body } = stripTags(reply);
  if (wordCount(body) <= 4) return reply;
  return tag + pick(BOT_SHORT_ALTS);
}

function repeatBotHint(history, userMessage) {
  if (!BOT_ACCUSE_RE.test(bare(userMessage))) return null;
  if (countBotAccuses(history, userMessage) < 2) return null;
  return 'Он СНОВА намекает на бота — совсем коротко («хах)» / «ну ты чего)»), без защиты-эссе.';
}

/* ——— 7 тир близости ——— */
function tierHint(history) {
  const tier = peerTier18(history);
  if (tier === 'stranger') {
    return 'Тир: ещё мало знакомы — 1 короткая фраза, без секретов и без «только тебе».';
  }
  if (tier === 'warm') {
    return 'Тир: уже тепло — можно своё мнение («по-моему»), без анкеты и без питча.';
  }
  return (
    'Тир: близко — можно чуть личнее (мелочь «только тебе» редко) или мягкий спор, без липкости.'
  );
}

/* ——— 8 мелочь города / погоды ——— */
function cityCrumbHint(systemPrompt, history, userMessage) {
  const turns = (Array.isArray(history) ? history : []).filter((m) => m && m.role === 'user')
    .length;
  if (turns < 4 || turns % 6 !== 0) return null;
  if (/встрет|погуля|инст|номер|бот|робот/i.test(bare(userMessage))) return null;
  let city = null;
  try {
    const card = require('./personaFacts').parsePersonaCard(systemPrompt || '');
    city = card?.fromCity || card?.toCity || null;
  } catch (_) {
    /* optional */
  }
  if (!city) return null;
  return (
    `Раз в несколько реплик можно одной мелочью про жизнь в ${city} ` +
    `(погода/настроение/дома), без википедии и без переезда-эссе.`
  );
}

/* ——— API ——— */
function buildIdeas18Hints(history, text, opts = {}) {
  const parts = [];
  const len = lengthMirrorHint(text);
  if (len) parts.push(len);
  const mem = memoryCallbackHint(history, text);
  if (mem) parts.push(mem);
  const dis = softDisagreeHint(history);
  if (dis) parts.push(dis);
  const meet = meetCounterHint(text);
  if (meet) parts.push(meet);
  const photo = photoDetailHint(text, history);
  if (photo) parts.push(photo);
  const bot = repeatBotHint(history, text);
  if (bot) parts.push(bot);
  const tier = tierHint(history);
  if (tier) parts.push(tier);
  const crumb = cityCrumbHint(opts.systemPrompt, history, text);
  if (crumb) parts.push(crumb);
  return parts.length ? parts.join('\n') : null;
}

function applyIdeas18Postfilters(reply, history, userMessage) {
  if (!reply) return reply;
  let out = reply;
  out = fixGenericPhotoPraise(out, history, userMessage);
  out = shortenRepeatBotDefense(out, history, userMessage);
  out = softDisagree(out, history, userMessage);
  out = meetCounterTail(out, userMessage);
  out = mirrorLength(out, userMessage);
  return out;
}

module.exports = {
  buildIdeas18Hints,
  applyIdeas18Postfilters,
  mirrorLength,
  softDisagree,
  meetCounterTail,
  fixGenericPhotoPraise,
  shortenRepeatBotDefense,
  peerTier18,
  extractMemoryHook,
};
