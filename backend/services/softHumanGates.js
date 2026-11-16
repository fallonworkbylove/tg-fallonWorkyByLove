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
};
