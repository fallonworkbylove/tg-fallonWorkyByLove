/**
 * Узкие postfilter-гейты: привет / slash / голое «?» / «ты бот».
 * Оркестратор — softHumanLite.applySoftLite.
 */

const BARE_GREETING_RE =
  /^(?:при+в+е+т+(?:ик)?|прив|хай|хей|здарова|здаров|здравствуй|доброе\s+утро|добрый\s+день|добрый\s+вечер|hi|hello|hey)\s*[).!]{0,3}$/i;
const GREETING_ACK_ALTS = ['хай)', 'привет)', 'хех привет)', 'ну привет)', 'хай, привет)'];

const BARE_ACK_RE =
  /^(?:ага|угу|ок|окей|ладно|ясно|поняла?|ну\s+да|хм\s+ок|круто|здорово|супер|класс|прикольно|интересно|точно|согласна?|аминь|радость|доброе|ок\)\)|ну\s+ок)\s*\){0,2}$/i;

/** «При-вет🖖🏻» / эмодзи / лишние дефисы → нормальный «привет». */
function normalizeBareUserText(userMessage) {
  return String(userMessage || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ')
    .replace(/([а-яёa-z])-([а-яёa-z])/gi, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBareGreeting(userMessage) {
  return BARE_GREETING_RE.test(normalizeBareUserText(userMessage));
}

function pickGreetingAck() {
  return GREETING_ACK_ALTS[Math.floor(Math.random() * GREETING_ACK_ALTS.length)];
}

/** /start /help — не день/сборы из анкеты. */
const SLASH_CMD_RE = /^\/[a-zA-Z_][\w]*(?:@[a-zA-Z0-9_]+)?(?:\s+.*)?$/;
const SLASH_CMD_ALTS = ['хах а это что)', 'не поняла) ты че', 'эм?)', 'ахах /start?))', 'хм?)'];

function fixSlashCommandReply(reply, userMessage) {
  const u = normalizeBareUserText(userMessage);
  if (!SLASH_CMD_RE.test(u)) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  return tag + SLASH_CMD_ALTS[Math.floor(Math.random() * SLASH_CMD_ALTS.length)];
}

/** Голое «?» после кривого хода — не «дома жду посылку». */
const BARE_Q_RE = /^(?:\?+|а\?|ну\?|и\?)\s*$/i;
const BARE_Q_ALTS = ['ой, просто мысли вслух)', 'хах запутала)', 'да так)', 'а ты про что?)'];
const DAY_SUBSTANCE_RE =
  /(?:дома|посылк|собира|жду|сижу|кофе|сериал|риллс|гуляю|работа|переезд|листа|утром)/i;

function lastAssistantText(history) {
  const h = Array.isArray(history) ? history : [];
  for (let i = h.length - 1; i >= 0; i -= 1) {
    if (h[i] && h[i].role === 'assistant') return String(h[i].content || '');
  }
  return '';
}

/** A2: учитываем history[-1] — если прошлый ход уже «день», на «?» не развиваем дальше. */
function fixDayTalkOnBareQuestion(reply, userMessage, history) {
  if (!reply || !BARE_Q_RE.test(normalizeBareUserText(userMessage))) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!body) return reply;
  const prev = lastAssistantText(history);
  const prevMiss = DAY_SUBSTANCE_RE.test(prev) || (prev && prev.length > 42);
  if (DAY_SUBSTANCE_RE.test(body) || body.length > 28 || prevMiss) {
    return tag + BARE_Q_ALTS[Math.floor(Math.random() * BARE_Q_ALTS.length)];
  }
  return reply;
}

/** На голое «привет» нельзя «мм, поняла)» — нечего понимать. */
function fixAckOnBareGreeting(reply, userMessage) {
  if (!reply || !isBareGreeting(userMessage)) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!body) return reply;
  if (/привет|приветик|хай|хей|здаров|добр/i.test(body)) return reply;
  if (
    BARE_ACK_RE.test(body) ||
    /^(?:мм|эм|хм)[,.]?\s*(?:понял[аи]?|ясно|ага|ок)\s*\)?$/i.test(body) ||
    /понял[аи]?\s*\)?$/i.test(body)
  ) {
    return tag + pickGreetingAck();
  }
  return reply;
}

/** Голый ответ «привет)» — без хвоста. */
const BARE_GREETING_REPLY_RE =
  /^(?:(?:ну|хех|хм|ой|о)\s+)?(?:привет(?:ик)?|хай|хей|здаров[а]?|здравствуй(?:те)?)\s*[).!]{0,3}$/i;

/**
 * На «Что делаешь? Как выходные?» нельзя голое «привет)».
 */
function fixBareGreetingOnSubstance(reply, userMessage) {
  if (!reply) return reply;
  if (isBareGreeting(userMessage)) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!body || !BARE_GREETING_REPLY_RE.test(body)) return reply;

  const msg = String(userMessage || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!msg) return reply;

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (/выходн/i.test(msg)) {
    return tag + pick(['дома сижу)', 'пока дома, а ты?', 'выходной, дома)', 'норм, дома вожусь)']);
  }
  if (/(?:что|чё|че)\s+делаешь|чем\s+(?:ты\s+)?занят|чем\s+ты\b/i.test(msg)) {
    return tag + pick(['дома сижу)', 'ничего особого)', 'просто дома)', 'вожусь по мелочи)']);
  }
  if (/как\s+(?:дела|день|настроен|ты)\b/i.test(msg)) {
    return tag + pick(['норм)', 'нормально)', 'всё ок)', 'ровно пока)']);
  }
  return tag + pick(['хм, а подробнее?)', 'ну рассказывай)', 'о как, и?', 'слушаю)']);
}

/* ——— A1: «ты бот / поплыл» ——— */
const BOT_ACCUSATION_RE =
  /(?:у\s+тебя\s+(?:бот|робот)|бот\s+поплыл|поплыл.{0,20}бот|ты\s+бот|это\s+бот|бот\s+ли\s+ты|какой[- ]?то\s+бот|как\s+бот|как\s+робот|с\s+роботом|обща(?:ешьс|ешс)я\s+как\s+(?:бот|робот)|нейросеть|chatgpt|gpt[- ]?\d|ты\s+не\s+человек|you(?:'re|\s+are)\s+a?\s*bot|are\s+you\s+a?\s*bot)/i;

const BOT_BAD_DEFENSE_RE =
  /не\s+бот|не\s+ии|я\s+не\s+(?:бот|робот|нейро)|просто\s+я\s+не\s+бот|(?:^|[.!)])\s*(?:а\s+)?(?:я\s+)?[А-ЯЁA-Z][а-яёa-z]{1,14}\s*\)?\s*$/i;

const BOT_ACCUSATION_ALTS = [
  'хах ну ты чего)',
  'живая, расслабься)',
  'эм?)',
  'хах ну серьёзно)',
  'да ладно тебе)',
  'странно звучит)',
];

function isBotAccusation(userMessage) {
  return BOT_ACCUSATION_RE.test(normalizeBareUserText(userMessage));
}

function recentBotAccusation(history) {
  const recent = (Array.isArray(history) ? history : []).slice(-6);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const h = recent[i];
    if (!h || h.role !== 'user') continue;
    if (BOT_ACCUSATION_RE.test(normalizeBareUserText(h.content))) return true;
    break;
  }
  return false;
}

/**
 * На обвинение не говорить «я не бот» и не штамповать имя («а Лер)»).
 */
function fixBotAccusationReply(reply, userMessage, history) {
  if (!reply) return reply;
  const accuse = isBotAccusation(userMessage) || recentBotAccusation(history);
  if (!accuse) return reply;

  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!body) return reply;

  const needs =
    BOT_BAD_DEFENSE_RE.test(body) ||
    /не\s+бот|нейросет|chatgpt/i.test(body) ||
    body.length > 36;

  if (!needs) return reply;

  return tag + BOT_ACCUSATION_ALTS[Math.floor(Math.random() * BOT_ACCUSATION_ALTS.length)];
}

/* ——— E1: пустые «» и латинские обрубки в кавычках ——— */
const EMPTY_QUOTE_ALTS = [
  'хах названия вылетели из головы)',
  'эм, сейчас не вспомню как зовутся)',
  'ну разные, без названий)',
  'хм, забыла как пишутся)',
];

function fixEmptyQuotedTitles(reply) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  let body = String(reply).slice(tag.length);
  const hadEmpty = /«\s*»/.test(body) || /«\s*[A-Za-z][^»]{0,48}»/.test(body);
  if (!hadEmpty) return reply;
  body = body
    .replace(/«\s*»/g, '')
    .replace(/«\s*[A-Za-z][^»]{0,48}»/g, '')
    .replace(/\s+и\s+и\s+/gi, ' и ')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([).!,?])/g, '$1')
    .trim();
  if (
    !body ||
    body.length < 8 ||
    /забыла написать названия|в основном,?\s*$/i.test(body) ||
    /«\s*»/.test(body)
  ) {
    return tag + EMPTY_QUOTE_ALTS[Math.floor(Math.random() * EMPTY_QUOTE_ALTS.length)];
  }
  return tag + body;
}

/* ——— E2: пустой filler без содержания ——— */
const VAGUE_FILLER_RE =
  /^(?:хм,?\s*|хах,?\s*|слушай,?\s*)?(?:может,?\s*и\s*не\s*зря|похоже,?\s*вопрос\s*открыт|ясно,?\s*значит,?\s*вс[её]\s*так|может,?\s*и\s*правда\s*что-то|что-то\s*значит,?\s*вс[её]\s*же)\s*\)?\.?$/i;
const VAGUE_ALTS = ['а подробнее?)', 'хм а ты про что?)', 'ну и?', 'о как)', 'эм?)'];

function fixVagueFillerReply(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (u.length > 90) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!body || !VAGUE_FILLER_RE.test(body)) return reply;
  return tag + VAGUE_ALTS[Math.floor(Math.random() * VAGUE_ALTS.length)];
}

function stripTag(reply) {
  const tag = (String(reply || '').match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  return { tag, body: String(reply || '').slice(tag.length).trim() };
}

function pickAlt(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mskHour() {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === 'hour');
    return Number(h && h.value) || 12;
  } catch (_) {
    return 12;
  }
}

/* ——— 2: анти-эхо 😂 / ахаха ——— */
const LAUGH_ECHO_RE =
  /^(?:(?:а\s*)?ха+|ахах+|хаха+|лол|кек|😂|🤣|😆|😄|\(+\)+)\s*(?:😂|🤣|😆|ахах*|ха+|\)+)*$/iu;
const LAUGH_ALTS = ['хех)', 'ну ты)', 'ахах ладно)', 'эм)', 'ок))'];

function fixEmojiLaughEcho(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !LAUGH_ECHO_RE.test(body.replace(/\s+/g, ''))) return reply;
  const recent = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-4)
    .map((h) => String(h.content || '').replace(/^\s*<<[^>\n]+>>\s*/, '').trim());
  const echoHits = recent.filter((t) => LAUGH_ECHO_RE.test(t.replace(/\s+/g, ''))).length;
  if (echoHits < 1 && body.length <= 8) return reply;
  if (echoHits >= 1 || /😂{2,}|ахах{2,}/i.test(body)) {
    return tag + pickAlt(LAUGH_ALTS);
  }
  return reply;
}

/* ——— 6: стикер → коротко ——— */
const STICKER_USER_RE = /\[стикер(?:-приветствие)?\s*(?:от\s+собеседника)?\]/i;
const STICKER_ALTS = ['хех)', 'ахах)', 'ну ты)', 'мил)', 'лол)'];

function fixStickerShortReply(reply, userMessage) {
  if (!reply || !STICKER_USER_RE.test(String(userMessage || ''))) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (body.length <= 28 && !/[.!?].*[.!?]/s.test(body)) return reply;
  return tag + pickAlt(STICKER_ALTS);
}

/* ——— 7: «что? / повтори» ——— */
const CLARIFY_ASK_RE =
  /^(?:что\??|чё\??|че\??|а\??|не\s+понял[аи]?\??|повтори(?:\s+пожалуйста)?\??|еще\s+раз\??|ещё\s+раз\??|what\??|say\s+again\??|huh\??)\s*$/i;
const CLARIFY_ALTS = [
  'ой, просто мысли вслух)',
  'хах запутала, коротко: …ну да)',
  'да так, без темы)',
  'повторилась немного)',
];

function fixClarifyAskReply(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (!CLARIFY_ASK_RE.test(u)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (body.length > 36 || DAY_SUBSTANCE_RE.test(body) || /собира|посылк|флип|нфт/i.test(body)) {
    return tag + pickAlt(CLARIFY_ALTS);
  }
  return reply;
}

/* ——— 8: NFT scam / пирамида ——— */
const NFT_SCAM_ASK_RE =
  /(?:развод|кидал|кидок|пирамид|скам|scam|обман|лохотрон|разводн|это\s+развод|разводите|фейк\s*(?:схем)?|понц)/i;
const NFT_SCAM_ALTS = [
  'понимаю скепсис, сама сначала так думала)',
  'не схема с вкладами — просто перепродажа токенов)',
  'норм вопрос, я тоже боялась сначала)',
  'не прошу денег, просто рассказываю как у меня)',
];

function fixNftScamObjection(reply, userMessage) {
  if (!reply || !NFT_SCAM_ASK_RE.test(normalizeBareUserText(userMessage))) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  const bad =
    /дай\s+денег|перевед|вложи|гарант|100\s*%|без\s+риск|обязательно\s+зайди/i.test(body) ||
    body.length > 120 ||
    /не\s+развод|это\s+не\s+пирамида/i.test(body);
  if (!bad && body.length <= 90) return reply;
  return tag + pickAlt(NFT_SCAM_ALTS);
}

/* ——— 9: язык последних 3 user msgs ——— */
function detectUserLangBlob(history, userMessage) {
  const users = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'user')
    .slice(-3)
    .map((h) => String(h.content || ''))
    .concat([String(userMessage || '')]);
  const blob = users.join(' ');
  const cyr = (blob.match(/[а-яё]/gi) || []).length;
  const lat = (blob.match(/[a-z]/gi) || []).length;
  if (lat >= 12 && lat > cyr * 1.4) return 'en';
  if (cyr >= 8) return 'ru';
  return 'mix';
}

const EN_STICK_ALTS = ['haha ok)', 'wait what)', 'lol)', 'mm yeah)', 'oh ok)'];

function fixLanguageStick(reply, history, userMessage) {
  if (!reply) return reply;
  if (detectUserLangBlob(history, userMessage) !== 'en') return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  const cyr = (body.match(/[а-яё]/gi) || []).length;
  const lat = (body.match(/[a-z]/gi) || []).length;
  if (cyr < 6 || lat >= cyr) return reply;
  return tag + pickAlt(EN_STICK_ALTS);
}

/* ——— 10: фото без vision — не выдумывать ——— */
const PHOTO_WRAP_RE = /\[(?:фото|photo|медиа|картинк)[^\]]*\]/i;
const PHOTO_BLIND_RE =
  /(?:не\s+удалось|не\s+распозна|без\s+описан|vision\s*fail|не\s+разгля|пустое\s+описан)/i;
const PHOTO_INVENT_RE =
  /(?:на\s+фото\s+(?:ты|он|море|пляж|машин|кот|собак)|вижу\s+(?:что|как)|похоже\s+на\s+[а-яё]{4,}|красив\w*\s+(?:закат|пейзаж|фон))/i;
const PHOTO_BLIND_ALTS = [
  'сейчас не разглядела нормально)',
  'хм, плохо видно, что там?)',
  'не разобрала, скинь ещё раз?)',
  'эм, не рассмотрела)',
];

function fixBlindPhotoReply(reply, userMessage) {
  if (!reply) return reply;
  const u = String(userMessage || '');
  if (!PHOTO_WRAP_RE.test(u)) return reply;
  const blind =
    PHOTO_BLIND_RE.test(u) ||
    /\]:\s*$/m.test(u) ||
    /\[фото[^\]]*\]:\s*(?:—|-|фото)?\s*$/i.test(u.trim());
  if (!blind) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (PHOTO_INVENT_RE.test(body) || body.length > 70) {
    return tag + pickAlt(PHOTO_BLIND_ALTS);
  }
  return reply;
}

/* ——— 11: после кружка не стена ——— */
function recentCircleInHistory(history) {
  const recent = (Array.isArray(history) ? history : []).slice(-8);
  return recent.some((h) => {
    if (!h || h.role !== 'assistant') return false;
    const c = String(h.content || '');
    return /<<CIRCLE>>|\{кружок:|\[медиа:#\d+\].*круж/i.test(c);
  });
}

function fixLongAfterCircle(reply, history) {
  if (!reply || !recentCircleInHistory(history)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || body.length <= 90) return reply;
  const cut = body.split(/(?<=[.!?…)])\s+/)[0] || body;
  const short = cut.length > 90 ? `${cut.slice(0, 87).trim()}…` : cut;
  return tag + short;
}

/* ——— 3: вечером короче (МСК 22–7) ——— */
function shortenEveningReply(reply) {
  if (!reply) return reply;
  const h = mskHour();
  if (h >= 7 && h < 22) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || body.length <= 85) return reply;
  const cut = body.split(/(?<=[.!?…)])\s+/)[0] || body;
  return tag + (cut.length > 100 ? `${cut.slice(0, 97).trim()}…` : cut);
}

/* ——— 4: не спрашивать про его работу повторно ——— */
const WORK_ASK_RE =
  /(?:как\s+(?:там\s+)?(?:на\s+)?работ|чем\s+(?:ты\s+)?(?:занима|работа)|кем\s+работа|на\s+работе\s+как|работа\s+как)/i;

function alreadyAskedHisWork(history) {
  const asst = (Array.isArray(history) ? history : []).filter((h) => h && h.role === 'assistant');
  let hits = 0;
  for (const h of asst.slice(-12)) {
    if (WORK_ASK_RE.test(String(h.content || ''))) hits += 1;
  }
  return hits >= 1;
}

const WORK_ASK_ALTS = ['ну ты как вообще?)', 'че делаешь?)', 'как настрой?)', 'о как)'];

function fixRepeatWorkAsk(reply, history) {
  if (!reply || !alreadyAskedHisWork(history)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !WORK_ASK_RE.test(body)) return reply;
  return tag + pickAlt(WORK_ASK_ALTS);
}

/* ——— 1: topic drift — не тащить спорт/шоу/авто ——— */
const TOPIC_BAGS = {
  sport: /(?:спорт|футбол|хоккей|тренир|зал|матч|команд)/i,
  show: /(?:сериал|фильм|шоу|риллс|ютуб|тикток|кино)/i,
  car: /(?:машин|авто|двигател|гараж|водитель)/i,
};

function fixTopicDriftReply(reply, history, userMessage) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  const u = String(userMessage || '');
  // Только текущее входящее: если ответ тащит sport/show/car, а юзер про другое — срезать.
  for (const re of Object.values(TOPIC_BAGS)) {
    if (!re.test(body)) continue;
    if (re.test(u)) continue;
    if (u.trim().length < 3) continue;
    return tag + pickAlt(['о как)', 'ну ясно)', 'хм)', 'ахах ладно)']);
  }
  return reply;
}

/* ——— 12: «слышал о таком» переизбыток ——— */
const HEARD_TAIL_RE = /слышал[а]?\s+о\s+так(?:ом|ом\??)/i;
const HEARD_ALTS = ['интересно тебе такое?)', 'ну как тебе идея?)', 'а ты бы попробовал?)'];

function fixHeardTailOveruse(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !HEARD_TAIL_RE.test(body)) return reply;
  const recent = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-8)
    .filter((h) => HEARD_TAIL_RE.test(String(h.content || ''))).length;
  if (recent < 1) return reply;
  return tag + pickAlt(HEARD_ALTS);
}

/** Пачка гейтов волны 0lo — вызывать из applySoftLite. */
function applyWave0loGates(reply, history, userMessage) {
  let out = reply;
  out = fixTopicDriftReply(out, history, userMessage);
  out = fixEmojiLaughEcho(out, history);
  out = fixStickerShortReply(out, userMessage);
  out = fixClarifyAskReply(out, userMessage);
  out = fixNftScamObjection(out, userMessage);
  out = fixLanguageStick(out, history, userMessage);
  out = fixBlindPhotoReply(out, userMessage);
  out = fixLongAfterCircle(out, history);
  out = shortenEveningReply(out);
  out = fixRepeatWorkAsk(out, history);
  out = fixHeardTailOveruse(out, history);
  return out;
}

module.exports = {
  normalizeBareUserText,
  isBareGreeting,
  pickGreetingAck,
  GREETING_ACK_ALTS,
  fixSlashCommandReply,
  fixDayTalkOnBareQuestion,
  fixAckOnBareGreeting,
  fixBareGreetingOnSubstance,
  isBotAccusation,
  fixBotAccusationReply,
  fixEmptyQuotedTitles,
  fixVagueFillerReply,
  BOT_ACCUSATION_ALTS,
  fixTopicDriftReply,
  fixEmojiLaughEcho,
  fixStickerShortReply,
  fixClarifyAskReply,
  fixNftScamObjection,
  fixLanguageStick,
  fixBlindPhotoReply,
  fixLongAfterCircle,
  shortenEveningReply,
  fixRepeatWorkAsk,
  fixHeardTailOveruse,
  applyWave0loGates,
  detectUserLangBlob,
  mskHour,
};
