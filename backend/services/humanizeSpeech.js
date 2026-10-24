/**
 * HUMANIZE SPEECH — опечатки, реакции, неровная длина, анти-«круто».
 * Профиль детерминирован от accountId (у каждого номера свой).
 * Опечатки понятные; без самоисправлений «ой, правильно».
 */

function hashSeed(accountId) {
  let h = 2166136261;
  const s = `humanize:${accountId}`;
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

const TYPO_STYLES = ['colloquial', 'colloquial', 'skip', 'soft', 'swap'];

/** Разговорные замены — смысл всегда читается. */
const COLLOQUIAL = [
  // «сечас» не вносим сами — модель так пишет как баг; чиним в cleanup.
  [/сейчас/gi, ['щас', 'щас', 'щас']],
  [/вообще/gi, ['ваще', 'вобще']],
  // Без «што/прсто/немнго» — в логах читалось как баг, не как живой чат.
  // Не трогать «что-то / чтобы / что ж».
  [/(^|[^\p{L}])что(?![-\s]*(?:то|бы|ж|ж\s)|[а-яё])/giu, ['$1чо', '$1что']],
  [/только/gi, ['ток', 'только']],
  [/нормально/gi, ['норм', 'нормально']],
  [/спасибо/gi, ['спасиб', 'спс', 'спасибо']],
  [/пожалуйста/gi, ['пожалста', 'пожалуйста']],
  [/очень/gi, ['оч', 'очень']],
  [/просто/gi, ['просто']],
  [/хорошо/gi, ['хорош', 'хорошо']],
  [/немного/gi, ['немножко', 'немного']],
  [/(^|[^\p{L}])привет(?![а-яё])/giu, ['$1прив', '$1привет']],
  [/потому\s+что/gi, ['тк', 'потому что']],
  [/кажется/gi, ['кажется']],
  [/сегодня/gi, ['седня', 'сегодня']],
  [/завтра/gi, ['завтра']],
  [/конечно/gi, ['конешн', 'конечно']],
];

/** Пара (нормальное → с пропуском/опечаткой), всё ещё читается. */
const SKIP_PAIRS = [
  ['вообще', 'вобще'],
  ['спасибо', 'спасиб'],
  ['сейчас', 'щас'],
  ['нравится', 'нравится'],
  ['конечно', 'конешн'],
  ['нормально', 'норм'],
  ['немного', 'немножко'],
  ['короче', 'короч'],
  ['хорошо', 'хорош'],
];

/** Соседние клавиши RU (одна замена в середине слова). */
const RU_ADJ = {
  а: 'п',
  п: 'а',
  о: 'р',
  р: 'о',
  и: 'ш',
  ш: 'и',
  е: 'н',
  н: 'е',
  к: 'у',
  у: 'к',
  в: 'а',
  с: 'м',
  д: 'в',
  л: 'д',
  т: 'е',
};

// Без «интересно» — «мне интересно как дела» не hype.
const HYPE_RE =
  /(^|[^\p{L}])(круто|классно|прикольно|супер|офигенно|огонь|топчик)(?![а-яё])/giu;
const HYPE_ALTS = ['норм', 'ахах', 'ну да', 'ок', 'ладно', 'ну ок'];

const SELF_FIX_RE = [
  /(?:^|\n)\s*ой[,.]?\s*(?:правильно|верно)\s*[«"']?[а-яёa-z-]{2,40}[»"']?\s*\)?\s*(?=\n|$)/gim,
  /ой[,.]?\s*имела\s+в\s+виду[^.!\n]*/gi,
  /\(\s*правильн[а-яё]*\s*[:\-]?\s*[а-яёa-z-]+\s*\)/gi,
  // Telegram-правки: *слово / слово* / *слово*
  /\*[а-яёa-z-]{2,40}\*/gi,
  /(?:^|\n)[ \t]*\*[а-яёa-z-]{2,40}\*?[ \t]*(?=\n|$)/gim,
  /(?:^|\n)[ \t]*[а-яёa-z-]{2,40}\*[ \t]*(?=\n|$)/gim,
  /ой[,.]?\s*[«"'][а-яёa-z-]{2,40}[»"']\s*\)?/gi,
  // Только явные самоправки, не живое «ой, устала»
  /^(?:ой|упс|oops|ugh)\s*[,.]?\s*(?:правильно|верно|имела\s+в\s+виду)\b.*$/gim,
  /^(?:ой|упс|oops|ugh)\s*[,.]?\s*[«"'][а-яёa-z-]{2,40}[»"']\s*\)?\s*$/gim,
];

const cache = new Map();

function getHumanizeProfile(accountId) {
  const key = String(accountId ?? '0');
  if (cache.has(key)) return cache.get(key);
  const rand = mulberry32(hashSeed(key));
  const style = TYPO_STYLES[Math.floor(rand() * TYPO_STYLES.length)];
  const profile = {
    accountId: key,
    typoStyle: style,
    // Редко и мягко: человек всё ещё читает с одного взгляда
    typoRate: 0.07 + rand() * 0.09,
    // Реакция на «ок/ага/спасибо» — реже (раньше 75–93% глушило живой текст).
    restraintChance: 0.4 + rand() * 0.22,
    // Короткие вспышки мягче — иначе режет «неа, спасибо) пока только…».
    shortBurstChance: 0.08 + rand() * 0.14,
    waitBeatChance: 0.04 + rand() * 0.08,
    // Два пузыря чуть чаще — живой чат, не эссе в одном сообщении.
    doubleBubbleChance: 0.18 + rand() * 0.14,
    // Иногда без финальной «)» даже в shortBurst
    bareEndChance: 0.4 + rand() * 0.3,
    // В TG почти не ставят точку в конце — чаще срезаем.
    dropPeriodChance: 0.55 + rand() * 0.25,
    hypeAltIndex: Math.floor(rand() * HYPE_ALTS.length),
  };
  cache.set(key, profile);
  return profile;
}

function stripSelfCorrections(text) {
  if (!text) return text;
  let out = String(text);
  for (const re of SELF_FIX_RE) {
    re.lastIndex = 0;
    out = out.replace(re, ' ');
  }
  // Отдельные пузыри-правки целиком
  out = out
    .split(/\n+/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^[*]?[а-яёa-z-]{2,40}[*]$/i.test(t)) return false;
      if (/^[*][а-яёa-z-]{2,40}[*]?$/i.test(t)) return false;
      return true;
    })
    .join('\n');
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function matchCase(sample, alt) {
  if (/^[А-ЯЁ]/.test(sample) && /^[а-яё]/.test(alt)) {
    return alt.charAt(0).toUpperCase() + alt.slice(1);
  }
  return alt;
}

function applyColloquialTypo(text, rand) {
  const candidates = [];
  for (const [re, alts] of COLLOQUIAL) {
    re.lastIndex = 0;
    if (re.test(String(text))) candidates.push({ re, alts });
    re.lastIndex = 0;
  }
  if (!candidates.length) return text;
  const pick = candidates[Math.floor(rand() * candidates.length)];
  let used = false;
  return String(text).replace(pick.re, (...args) => {
    if (used) return args[0];
    used = true;
    const full = args[0];
    const altRaw = pick.alts[Math.floor(rand() * pick.alts.length)];
    if (altRaw.includes('$1') && args[1] != null) {
      return altRaw.replace('$1', args[1]);
    }
    return matchCase(full, altRaw);
  });
}

function applySkipTypo(text, rand) {
  const lower = String(text).toLowerCase();
  const hits = SKIP_PAIRS.filter(([w]) => lower.includes(w));
  if (!hits.length) return applyColloquialTypo(text, rand);
  const [from, to] = hits[Math.floor(rand() * hits.length)];
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return String(text).replace(re, (match) => matchCase(match, to));
}

function applySwapTypo(text, rand) {
  const words = String(text).split(/(\s+)/);
  const idxList = [];
  for (let i = 0; i < words.length; i += 1) {
    if (/^[а-яё]{5,}$/i.test(words[i])) idxList.push(i);
  }
  if (!idxList.length) return applyColloquialTypo(text, rand);
  const wi = idxList[Math.floor(rand() * idxList.length)];
  const chars = [...words[wi]];
  const positions = [];
  for (let i = 1; i < chars.length - 1; i += 1) {
    if (RU_ADJ[chars[i].toLowerCase()]) positions.push(i);
  }
  if (!positions.length) return applyColloquialTypo(text, rand);
  const p = positions[Math.floor(rand() * positions.length)];
  const ch = chars[p];
  const repl = RU_ADJ[ch.toLowerCase()];
  chars[p] = ch === ch.toUpperCase() ? repl.toUpperCase() : repl;
  words[wi] = chars.join('');
  return words.join('');
}

function applyHumanTypos(text, profile) {
  if (!text || /<<|\[медиа:|\[голосовое:/i.test(text)) return text;
  if (String(text).trim().length < 6) return text;
  const minuteSalt = Math.floor(Date.now() / 60000);
  const rand = mulberry32((hashSeed(profile.accountId) ^ minuteSalt) >>> 0);
  if (rand() > profile.typoRate) return text;

  let out;
  switch (profile.typoStyle) {
    case 'skip':
      out = applySkipTypo(text, rand);
      break;
    case 'swap':
      out = applySwapTypo(text, rand);
      break;
    case 'soft':
    case 'colloquial':
    default:
      out = applyColloquialTypo(text, rand);
  }
  return cleanupHumanArtifacts(out);
}

function softenHype(text, history, profile) {
  if (!text) return text;
  const recent = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-4)
    .map((h) => String(h.content || ''))
    .join('\n');
  HYPE_RE.lastIndex = 0;
  const recentHype = HYPE_RE.test(recent);
  HYPE_RE.lastIndex = 0;
  const currentHype = HYPE_RE.test(text);
  HYPE_RE.lastIndex = 0;
  if (!currentHype) return text;
  if (!recentHype && Math.random() > 0.7) return text;
  const alt = HYPE_ALTS[(profile?.hypeAltIndex || 0) % HYPE_ALTS.length];
  return String(text).replace(HYPE_RE, (_, pre) => `${pre}${alt}`);
}

function maybeWaitBeat(text, profile, history, lang = 'ru') {
  if (!text || !profile) return text;
  if (lang === 'en' || lang === 'de') return text;
  // «ой сек» / «сек,» в начале — всегда срезаем, больше не добавляем.
  let body = String(text).trim();
  body = body.replace(/^(?:ой\s*,?\s*)?сек\s*,?\s+/i, '').trim();
  return body || text;
}

function maybeShortBurst(text, profile, lang = 'ru') {
  if (!text || !profile) return text;
  if (Math.random() > profile.shortBurstChance) return text;
  const lines = String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return text;
  // Многострочный ответ — не выкидываем суть второй строки.
  if (lines.length > 1) return text;
  const line = lines[0];
  // Уже две законченные фразы — не режем.
  if (/(?:[).!?…])\s+\S/.test(line)) return text;
  const words = line.split(/\s+/);
  // Короткие и средние фразы не трогаем (иначе «на отъебись»).
  if (words.length <= 12) return text;
  const cutAt = Math.min(words.length, 8 + Math.floor(Math.random() * 3));
  let short = words.slice(0, cutAt).join(' ').replace(/[,:;]\s*$/, '');
  if (looksIncompleteUtterance(short)) return text;
  if (/\)\s+\S/.test(short) && !/[)….!?]$/.test(short)) return text;
  if (
    lang !== 'en' &&
    lang !== 'de' &&
    !/[)…!?]$/.test(short) &&
    !/«[^»]*$/.test(short) &&
    Math.random() > (profile.bareEndChance ?? 0.4)
  ) {
    short += ')';
  }
  return cleanupHumanArtifacts(short);
}

/**
 * Редко режет ответ на 2 строки → telegramClient шлёт двумя пузырями с паузой.
 * Только если уже есть две законченные короткие фразы.
 */
function maybeDoubleBubble(text, profile, lang = 'ru') {
  if (!text || !profile) return text;
  if (lang === 'en' || lang === 'de') return text;
  if (Math.random() > (profile.doubleBubbleChance ?? 0.08)) return text;
  const t = String(text).trim();
  if (!t || /\n/.test(t)) return text;
  if (/<<|\[медиа|#/.test(t)) return text;
  const parts = t.split(/(?<=[).!…])\s+/).filter(Boolean);
  if (parts.length !== 2) return text;
  const w1 = parts[0].split(/\s+/).filter(Boolean).length;
  const w2 = parts[1].split(/\s+/).filter(Boolean).length;
  if (w1 < 2 || w1 > 10 || w2 < 2 || w2 > 10) return text;
  // Второй пузырь с вопросом — чаще палит допрос; не режем.
  if (/\?/.test(parts[1])) return text;
  if (looksIncompleteUtterance(parts[0]) || looksIncompleteUtterance(parts[1])) return text;
  return cleanupHumanArtifacts(`${parts[0]}\n${parts[1]}`);
}

/** Обрезанная фраза без смысла — не пускать в чат. */
function looksIncompleteUtterance(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  // Незакрытые кавычки / «ёлочки»
  const openGuillemet = (t.match(/«/g) || []).length;
  const closeGuillemet = (t.match(/»/g) || []).length;
  if (openGuillemet > closeGuillemet) return true;
  const dq = (t.match(/"/g) || []).length;
  if (dq % 2 === 1) return true;
  if (/[.!?…)]$/.test(t)) return false;
  // Висячие служебные слова / контракции в конце
  if (
    /\b(but|and|or|if|when|because|so|to|the|a|an|my|your|i'?m|i'?ll|i'?ve|i'?d|we'?re|it'?s|that'?s|there'?s|with|for|of|at|in|on|just|really|very|also|then|than|as|from|into|about)\s*$/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /(^|\s)(но|и|а|что|чтобы|как|когда|потому|просто|ещё|еще|уже|там|тут|это|вот|ну|типа|короче|если|или|либо|то|же|бы|ли|не|ни|с|в|на|по|за|из|у|к|о|об|от|до|для|без|про|при|надеюсь|кажется|наверное|типа|короче|только|пока)\s*$/i.test(
      t,
    )
  ) {
    return true;
  }
  // «неа, спасибо) пока только» — мысль оборвана (shortBurst / max_tokens)
  if (/пока\s+только\s*\)*$/i.test(t) && !/пока\s+только\s+(?:переписк|тут|здесь|онлайн|так)/i.test(t)) {
    return true;
  }
  // «но я» / «а ты» без продолжения
  if (/\b(но|а|и|ну|что)\s+(я|ты|мы|он|она|вы)\s*$/i.test(t)) return true;
  // «I'm» / «I'd» / «we're» без продолжения
  if (/\b(i'?m|i'?ll|i'?ve|i'?d|we'?re|they'?re|he'?s|she'?s)\s*$/i.test(t)) return true;
  // «жесть, капец. надеюсь» / голое «надеюсь» без объекта
  if (/^(?:жесть|капец|блин)[,.]?\s*(?:капец[,.]?\s*)?надеюсь\.?$/i.test(t)) return true;
  if (/^надеюсь[.!)…]*$/i.test(t)) return true;
  // Обрывы из логов: «называется », «and a bit», «иногда нужно», «а потом», «but I'm», «… not»
  if (/называется\s*$/i.test(t)) return true;
  if (/\band a bit\s*$/i.test(t)) return true;
  if (/^(?:ну,?\s*)?иногда\s+нужно\s*$/i.test(t)) return true;
  if (/\bа\s+потом\s*$/i.test(t)) return true;
  // Обрыв «поняла, ты в чем / в плане» — эхо служебных слов
  if (/(?:понял[аи][,\s]+)?ты\s+в\s+(?:ч[её]м|плане|смысле)\s*\)*$/i.test(t)) return true;
  if (/\bв\s+ч[её]м\s*\)*$/i.test(t) && !/проблем|смысл|дело/i.test(t) && t.split(/\s+/).length <= 7) {
    return true;
  }
  if (/\bbut I'?m\s*$/i.test(t)) return true;
  if (/\bgenuine,?\s*not\s*$/i.test(t)) return true;
  if (/\bI appreciate the thought,?\s*but I'?m\s*$/i.test(t)) return true;
  return false;
}

/**
 * Артефакты после опечаток/shortBurst: «щас, )», пустые «, )», висячая запятая.
 */
function cleanupHumanArtifacts(text) {
  if (!text) return text;
  let out = String(text);
  // Мета-цитаты, иногда влипают в ответ
  out = out.replace(/\[(?:ответ на|уточнение к|Ответ на сообщение)[^\]]*\]:?\s*/gi, ' ');
  out = out.replace(/,\s*\)+/g, ')');
  out = out.replace(/\(\s*\)/g, '');
  // Частый кривой автокомплит модели (\b не работает на кириллице)
  out = out.replace(/(^|[^а-яёa-z0-9])сечас(?=[^а-яёa-z0-9]|$)/gi, '$1сейчас');
  out = out.replace(/^[,\s.]+/gm, '');
  out = out.replace(/[ \t]+([).!?…])/g, '$1');
  out = out.replace(/([(\[])\s+/g, '$1');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  // Строка из одной «)» / «,» — выкинуть
  out = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^[),.\s]+$/.test(l))
    .join('\n');
  return out.trim();
}

/** В EN убираем скобки-улыбки «)» / «))» (не настоящие скобки вроде (kinda)). */
function stripEnParenSmiles(text) {
  if (!text) return text;
  return String(text)
    // «thanks) you» → «thanks, you»
    .replace(/(?<!\([^)\n]{0,40})\)+(?=\s*[A-Za-z])/g, ',')
    .replace(/(?<!\([^)\n]{0,40})\)+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/^[,.\s]+/, '')
    .trim();
}

/** Вырезает случайные русские вставки из EN-ответа. */
function isMostlyCyrillic(text) {
  const clean = String(text || '').replace(/<<[^>]+>>/g, '');
  let cyr = 0;
  let lat = 0;
  for (const ch of clean) {
    if (/[а-яёА-ЯЁ]/.test(ch)) cyr += 1;
    else if (/[a-zA-Z]/.test(ch)) lat += 1;
  }
  // Короткие русские ответы («ага», «поняла)», «угу») раньше не ловились
  // порогом cyr>=8 — и улетали в EN-чат как есть.
  if (cyr >= 2 && lat === 0) return true;
  if (cyr >= 3 && cyr >= lat) return true;
  return cyr >= 8 && cyr > lat * 1.2;
}

function stripRuLeakFromEn(text) {
  if (!text) return text;
  let out = String(text);
  if (isMostlyCyrillic(out)) {
    // Целиком русский ответ в EN-чате — лучше пусто (сработает retry), чем «перевод».
    return '';
  }
  out = out.replace(/ой\s*сек[,.]?\s*/gi, '');
  out = out.replace(/(?:^|[\s,])ой[,.]?\s+/gi, (m) => (m.startsWith(' ') || m.startsWith(',') ? ' ' : ''));
  out = out.replace(/^ой[,.]?\s*/gi, '');
  out = out.replace(/сек,\s*/gi, '');
  out = out.replace(/(?:^|[\s])сек(?=[\s,]|$)/gi, '$1');
  out = out.replace(/щас/gi, 'now');
  out = out.replace(/ахах+/gi, 'haha');
  out = out.replace(/хах+/gi, 'haha');
  out = out.replace(/хех/gi, 'heh');
  // Частые русские однословные вставки в EN-чате
  out = out.replace(/(?:^|[\s,])(?:ага|угу|угу+|поняла|понял|ладно|норм|окей)(?=[\s,).!?]|$)/gi, ' ');
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/^[,.\s]+/, '').trim();
  // Если после чистки кириллица ещё осталась — пусто → retry на английском.
  if (/[а-яё]/i.test(out.replace(/<<[^>]+>>/g, ''))) return '';
  return out;
}

function shouldRestraintReact(profile) {
  return Math.random() < (profile?.restraintChance ?? 0.65);
}

/**
 * Точка/восклицание в конце в TG палят «эссе». Живые чаще без точки.
 * Не трогаем «...» / «!» внутри, только хвост.
 */
function varyTerminalPunctuation(text, profile, lang = 'ru') {
  if (!text) return text;
  if (lang === 'en' || lang === 'de') {
    // EN: реже трогаем, но «Great!» → «Great» иногда
    let en = String(text).trim();
    if (/!$/.test(en) && Math.random() < 0.45) en = en.replace(/!+$/, '').trim();
    return en || text;
  }
  const lines = String(text).split('\n');
  const chance = profile?.dropPeriodChance ?? 0.65;
  const out = lines.map((line) => {
    let t = line.trimEnd();
    if (!t || /<<|https?:/i.test(t)) return line;
    // «нормально.» → «нормально» / иногда «нормально)»
    if (/\.$/.test(t) && !/\.\.\.$/.test(t) && Math.random() < chance) {
      t = t.replace(/\.+$/, '');
      if (Math.random() < 0.18 && !/[)….!?]$/.test(t)) t += ')';
    }
    // «вайб!» → «вайб» / «вайб)»
    if (/!$/.test(t) && Math.random() < 0.5) {
      t = t.replace(/!+$/, '');
      if (Math.random() < 0.25 && !/[)….!?]$/.test(t)) t += ')';
    }
    return t;
  });
  return cleanupHumanArtifacts(out.join('\n')) || text;
}

module.exports = {
  getHumanizeProfile,
  stripSelfCorrections,
  applyHumanTypos,
  softenHype,
  maybeWaitBeat,
  maybeShortBurst,
  maybeDoubleBubble,
  looksIncompleteUtterance,
  cleanupHumanArtifacts,
  stripEnParenSmiles,
  stripRuLeakFromEn,
  isMostlyCyrillic,
  shouldRestraintReact,
  varyTerminalPunctuation,
};
