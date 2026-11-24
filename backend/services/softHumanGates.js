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
  /^(?:хм,?\s*|хах,?\s*|ахах+,?\s*|слушай,?\s*|поняла,?\s*|короче\s+да,?\s*|ну\s+)?(?:может,?\s*и\s*не\s*зря|похоже,?\s*вопрос\s*открыт|ясно,?\s*значит,?\s*вс[её]\s*так|может,?\s*и\s*правда\s*что-то|что-то\s*значит,?\s*вс[её]\s*же|что-то\s+не\s+так|мелочи\s+иногда\s+могут\s+быть|бывает\s+по[- ]?разному|такое)\s*\)?\.?$/i;
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

/* ——— 0mm: на «куришь?» нельзя «иногда могу попробовать» ——— */
const SMOKING_ASK_SOFT_RE =
  /(куриш[ь]?|курил[аи]?|покуриваешь|курить|сигарет|вейп|\bvape\b|травк|косяч|забиваешь|что[- ]?то\s+кури)/i;
const SMOKING_SOFT_YES_RE =
  /(?:иногда\s+)?(?:могу|можно)\s+попробовать|иногда\s+(?:да|пробую)|не\s+против\s+попробовать|бывает\s+пробую|попробую\s+как[- ]?нибудь/i;
const SMOKING_NO_ALTS = [
  'не, вообще нет)',
  'не курю) и не тянет',
  'нет, не моё)',
  'не, ничего такого)',
];

function fixSmokingSoftYes(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (!u || !SMOKING_ASK_SOFT_RE.test(u)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !SMOKING_SOFT_YES_RE.test(body)) return reply;
  return tag + pickAlt(SMOKING_NO_ALTS);
}

/* ——— 0t2: скрины «как бот» — узкие постфильтры ——— */

const DEAD_FILLER_RE =
  /^(?:хм[,.]?\s*|ну[,.]?\s*|ахах+[,.]?\s*|хах[,.]?\s*)?(?:ясно|понятно|ну\s+бывает|бывает|ага|угу|лол|кек|ну\s+ок|ок|ну\s+ладно|ладно|ну\s+давай\s+так|хорошо\s+тогда|ну\s+вот|вот\s+так|мм+|эм+)\s*\){0,2}\.?$/i;
const DEAD_FILLER_ALTS = [
  'а подробнее?)',
  'хм, и что дальше?)',
  'ну расскажи)',
  'о как, и?',
  'ой ну и?)',
  'интересно, и что?)',
];

function fixDeadFillerReply(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (u.length < 2) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !DEAD_FILLER_RE.test(body)) return reply;
  // На совсем короткое «ок» от него пустой ack ок.
  if (u.length <= 6 && /^(?:ок|окей|угу|ага)\s*\)?$/i.test(u)) return reply;
  return tag + pickAlt(DEAD_FILLER_ALTS);
}

const DAVAI_BODY_RE = /^(?:ну\s+)?давай\s*\){0,2}\.?$/i;
const DAVAI_ALTS = ['ну напиши как будет)', 'ок, я на связи)', 'хорошо, пиши)', 'давай, жду)'];

function fixDavaiLoop(reply, history, userMessage) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !DAVAI_BODY_RE.test(body)) return reply;
  const u = normalizeBareUserText(userMessage);
  const recent = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-4)
    .map((h) => String(h.content || '').replace(/^\s*<<[^>\n]+>>\s*/, '').trim());
  const priorDavai = recent.some((t) => DAVAI_BODY_RE.test(t));
  const heDavai = /^(?:ну\s+)?давай\s*\)?\.?$/i.test(u);
  if (priorDavai || heDavai) return tag + pickAlt(DAVAI_ALTS);
  return reply;
}

const RADA_ECHO_RE = /^рада(?:\s+что|\s*,\s*что)(?:\s|$|[),.!])/i;
// 0t23: без «ну ты милый)» — иначе love-stamp петля
const RADA_ALTS = ['мне приятно)', 'тепло от тебя)', 'с тобой хорошо)', 'о как)', 'приятно слышать)', 'радует)'];

function fixRadaChtoEcho(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !RADA_ECHO_RE.test(body)) return reply;
  const recent = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-6)
    .map((h) => String(h.content || '').replace(/^\s*<<[^>\n]+>>\s*/, '').trim());
  const hits = recent.filter((t) => RADA_ECHO_RE.test(t)).length;
  // 0t23: короткие и средние «рада что…» режем всегда; длинные — со 2-го раза
  if (hits >= 1 || body.length <= 48) return tag + pickAlt(RADA_ALTS);
  return reply;
}

/** 0t23: голое «хех)» / «мм)» подряд — пустой ход. */
const HEX_ALONE_RE = /^(?:хех+|мм+|эм+)\s*\){0,2}\.?$/i;
const HEX_ALONE_ALTS = ['ну ты)', 'о как)', 'ага)', 'серьёзно?)', 'и что дальше?)'];

function fixHexAloneOveruse(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !HEX_ALONE_RE.test(body)) return reply;
  const hits = recentAssistantBodies(history, 6).filter((t) => HEX_ALONE_RE.test(t)).length;
  if (hits < 1) return reply;
  return tag + pickAlt(HEX_ALONE_ALTS);
}

const FRICTION_USER_RE =
  /морози|морозить|динамиш|игнор|не\s+дождал|где\s+(?:фото|фотк|круж|видео)|когда\s+(?:скинешь|фото|круж)|ты\s+бот|как\s+бот|нейросеть|промпт|обещала|вр[её]шь/i;
const DEFLECT_BODY_RE =
  /^(?:уточни|лол|кек|ахах+|хаха+|хм|эм)\s*\){0,2}\.?$/i;
const FRICTION_ALTS = [
  'ой, правда затянула — чуть позже напишу нормально)',
  'поняла, не хочу морозить — скажи что важнее сейчас)',
  'сорри, была занята, давай по делу)',
  'слышу тебя, без шуток — что именно ждёшь?)',
];

function fixDeflectOnFriction(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (!FRICTION_USER_RE.test(u)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (DEFLECT_BODY_RE.test(body) || (body.length <= 18 && /уточни|лол|терпелив/i.test(body))) {
    return tag + pickAlt(FRICTION_ALTS);
  }
  return reply;
}

const PHOTO_WAIT_USER_RE =
  /(?:не\s+дождал|жду\s+(?:фото|фотк|круж)|где\s+(?:фото|фотк|круж|селфи)|когда\s+(?:фото|скинешь|пришл)|обещанн\w*\s+фото)/i;
const PHOTO_STALL_BAD_RE = /терпелив|морозить|уточни|лол|потом\s*\)|позже\s*\)/i;
// Он уже ждёт после её обещания — не уводим в новый бартер «сначала ты».
const PHOTO_STALL_ALTS = [
  'ой да, задержала — чуть позже кину)',
  'правда должна, сейчас неудобно, скоро скину)',
  'не морожу специально, чуть позже пришлю)',
  'ок, помню про фото — скоро)',
];

function fixPhotoStallDeflect(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (!PHOTO_WAIT_USER_RE.test(u)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (PHOTO_STALL_BAD_RE.test(body) || body.length < 24) {
    return tag + pickAlt(PHOTO_STALL_ALTS);
  }
  return reply;
}

const BOT_ADMIT_RE =
  /(?:я\s+создан[аоы]|меня\s+создал|по\s+промпт|я\s+(?:ии|ai)\b|я\s+нейросет|я\s+языков\w*\s+модел|я\s+бот\b|я\s+не\s+человек|я\s+программа|я\s+виртуальн|as an ai|i(?:'m| am) an?(?:\s+\w+){0,2}\s+(?:ai|bot|language model))/i;
const BOT_ADMIT_ALTS = [
  'хах ну ты чего)',
  'живая, расслабься)',
  'эм?)',
  'да ладно тебе)',
  'странно звучит)',
];

function fixBotAdmitLeak(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !BOT_ADMIT_RE.test(body)) return reply;
  return tag + pickAlt(BOT_ADMIT_ALTS);
}

const PEER_MASC_RE = /(?:\bбыл\b|\bустал\b|\bдождался\b|\bработал\b|\bприходил\b|\bушёл\b|\bушел\b)/i;
const PEER_FEM_ADDR_RE = /(?:^|[.!?)\s])устала(?:\s+наверное)?\s*\)?/i;
const PEER_GENDER_ALTS = ['устал наверное)', 'тяжёлый день?)', 'ну отдыхай)', 'ага, отдыхай)'];

function fixPeerGenderMismatch(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (!PEER_MASC_RE.test(u)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (/\bя\s+устала\b/i.test(body)) return reply;
  if (/устала\s+наверное|^\s*устала\s*\)/i.test(body) || PEER_FEM_ADDR_RE.test(` ${body}`)) {
    // «устала» про него, не про себя
    if (!/\bя\b/i.test(body.slice(0, Math.max(0, body.search(/устала/i))))) {
      return tag + pickAlt(PEER_GENDER_ALTS);
    }
  }
  return reply;
}

const CIRCLE_ASK_RE =
  /(?:скинь|запиши|пришли|хочу|можешь).{0,40}(?:круж|видеосообщ|video\s*note)|(?:кружок|видеосообщение).{0,20}(?:скинь|запиши|пришли|можешь)/i;
const CIRCLE_DODGE_RE =
  /(?:не\s+могу\s+сейчас|потом|позже|уточни|лол|неудоб|занята)\s*\)?\.?$/i;
const CIRCLE_ASK_ALTS = [
  'хорошо запишу, но сначала ты)',
  'ок кину кружок — только ты первый)',
  'давай, но сперва ты скинь)',
  'могу, но сначала ты)',
];

function fixCircleAskDodge(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (!CIRCLE_ASK_RE.test(u)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  // Уже бартер «сначала ты» — ок.
  if (/сначала\s+ты|сперва\s+ты|ты\s+перв/i.test(body) && body.length >= 12) return reply;
  if (CIRCLE_DODGE_RE.test(body) || DEFLECT_BODY_RE.test(body) || body.length < 16) {
    return tag + pickAlt(CIRCLE_ASK_ALTS);
  }
  // Обещает кинуть без условия — тоже в бартер.
  if (/(?:скин|кину|запишу|пришлю)/i.test(body) && !/сначала|сперва|после\s+тебя/i.test(body)) {
    return tag + pickAlt(CIRCLE_ASK_ALTS);
  }
  return reply;
}

/** Пачка гейтов волны 0t2 — вкус ответов со скринов. */
function applyWave0t2Gates(reply, history, userMessage) {
  let out = reply;
  out = fixBotAdmitLeak(out);
  out = fixDeflectOnFriction(out, userMessage);
  out = fixPhotoStallDeflect(out, userMessage);
  out = fixCircleAskDodge(out, userMessage);
  out = fixDeadFillerReply(out, userMessage);
  out = fixDavaiLoop(out, history, userMessage);
  out = fixRadaChtoEcho(out, history);
  out = fixPeerGenderMismatch(out, userMessage);
  return out;
}

/* ——— 0t6 marathon: anti-script / терапевт / двойной вопрос ——— */

function recentAssistantBodies(history, n = 8) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-n)
    .map((h) =>
      String(h.content || '')
        .replace(/^\s*<<[^>\n]+>>\s*/, '')
        .trim(),
    );
}

const THERAPIST_RE =
  /^(?:я\s+)?(?:понимаю\s+тебя|поняла\s+тебя|это\s+нормально|важно\s+что\s+ты|ты\s+имеешь\s+право|спасибо\s+что\s+делишься|звучит\s+сложно|давай\s+разберём)/i;
const THERAPIST_ALTS = [
  'ой жесть)',
  'ну да, тяжёлое)',
  'блин, сочувствую)',
  'хм тяжёло звучит)',
  'капец конечно)',
  'ну ты держись)',
];

function fixTherapistTone(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || body.length > 120) return reply;
  if (!THERAPIST_RE.test(body)) return reply;
  return tag + pickAlt(THERAPIST_ALTS);
}

const PONJALA_RE = /^поняла\s*\){0,2}\.?$/i;
// 0t26: без «ясно)» / «хм ок)» — dead filler
const PONJALA_ALTS = ['ага)', 'ну да)', 'о как)', 'хех)', 'ну ты)'];

function fixPonjalaStamp(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !PONJALA_RE.test(body)) return reply;
  const hits = recentAssistantBodies(history, 6).filter((t) => PONJALA_RE.test(t)).length;
  if (hits >= 1 || body.length <= 12) return tag + pickAlt(PONJALA_ALTS);
  return reply;
}

function fixDoubleQuestion(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || body.length > 140) return reply;
  const marks = (body.match(/\?/g) || []).length;
  if (marks < 2) return reply;
  // Оставляем первый вопрос, хвост без второго «?».
  const first = body.indexOf('?');
  let kept = body.slice(0, first + 1).trim();
  const rest = body.slice(first + 1).replace(/\?/g, '.').trim();
  if (rest && rest.length > 8 && kept.length < 40) {
    // слишком обрезали — просто убрать лишние ?
    const cleaned = body.replace(/\?/g, (m, i) => (i === first ? '?' : ''));
    return tag + cleaned.replace(/\s+/g, ' ').trim();
  }
  return tag + (kept || pickAlt(['а ты как?)', 'ну и как?)', 'что скажешь?)']));
}

const OPENER_RE = /^(?:ну|хм|слушай|короче|типа)\b/i;
const OPENER_ALTS = ['о как)', 'ага)', 'хех)', 'мм)', 'ну ты)'];

function fixOpenerLoop(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !OPENER_RE.test(body) || body.length > 70) return reply;
  const hits = recentAssistantBodies(history, 5).filter((t) => OPENER_RE.test(t)).length;
  // 0t22: «слушай» — уже со второго раза; остальное с третьего.
  const isSlushay = /^слушай\b/i.test(body);
  if (hits < (isSlushay ? 1 : 2)) return reply;
  // Срезаем opener, оставляем суть.
  const stripped = body.replace(/^(?:ну|хм|слушай|короче|типа)[,.]?\s+/i, '').trim();
  if (stripped.length >= 6) return tag + stripped;
  return tag + pickAlt(OPENER_ALTS);
}

const AGREE_STACK_RE =
  /^(?:да\s+да|конечно\s+конечно|полностью\s+согласна|абсолютно|ты\s+прав)\b/i;
const AGREE_ALTS = ['хм ну почти)', 'мне скорее вот так)', 'не знаю, спорно)', 'ну не всегда)', 'ага, но…'];

function fixAgreeableStack(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  // Только если он высказал мнение, а не спросил.
  if (!u || /\?/.test(u) || u.length < 12) return reply;
  if (!/(?:мне\s+кажется|я\s+думаю|имхо|по-моему|надо|должен)/i.test(u)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !AGREE_STACK_RE.test(body)) return reply;
  return tag + pickAlt(AGREE_ALTS);
}

const WHY_HERE_SCRIPT_RE =
  /^(?:ну\s+)?(?:просто\s+)?(?:общаюсь|ищу\s+общен|тут\s+из\s+интерес)/i;
const WHY_HERE_ALTS = [
  'да просто так зашла)',
  'ну вот скучно было)',
  'сама не знаю до конца)',
  'просто поболтать)',
];

function fixWhyHereScript(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (!/(?:зачем\s+ты\s+здесь|что\s+ты\s+тут\s+делаешь|почему\s+в\s+тг|зачем\s+в\s+телег)/i.test(u)) {
    return reply;
  }
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (WHY_HERE_SCRIPT_RE.test(body) || /просто общаюсь/i.test(body)) {
    return tag + pickAlt(WHY_HERE_ALTS);
  }
  return reply;
}

const PARROT_ALTS = ['хм ну да)', 'о как)', 'ага)', 'ну ты)', 'серьёзно?)', 'хах)'];

/** Не зеркалить его фразу дословно / почти дословно. */
function fixParrotEcho(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage)
    .toLowerCase()
    .replace(/[^\p{L}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const { tag, body } = stripTag(reply);
  const b = String(body || '')
    .toLowerCase()
    .replace(/[^\p{L}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!b || u.length < 12 || b.length < 6) return reply;
  if (b.includes(u) || (u.length >= 16 && u.includes(b) && b.length >= u.length * 0.65)) {
    return tag + pickAlt(PARROT_ALTS);
  }
  const uw = [...new Set(u.split(/\s+/).filter((w) => w.length > 3))];
  const bw = b.split(/\s+/).filter((w) => w.length > 3);
  if (uw.length >= 3 && bw.length >= 3) {
    const set = new Set(uw);
    const hits = bw.filter((w) => set.has(w)).length;
    if (hits / bw.length >= 0.72) return tag + pickAlt(PARROT_ALTS);
  }
  return reply;
}

const HOW_ASK_RE = /(?:как\s+(?:дела|день|ты|настроение)|чем\s+занят|что\s+делаешь)\s*\??\s*\)?$/i;
const HOW_ASK_STRIP_RE =
  /\s*[,.]?\s*(?:а\s+)?(?:как\s+(?:дела|день|ты|настроение)|чем\s+(?:сейчас\s+)?занят|что\s+делаешь)\s*\??\s*\)?\s*$/i;

/** Не спрашивать «как дела» снова, если он только что ответил про день/дела. */
function fixRepeatHowAsk(reply, history, userMessage) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !HOW_ASK_RE.test(body)) return reply;
  const u = normalizeBareUserText(userMessage);
  const heAnsweredHow =
    /(?:норм|нормально|уста|работ|дома|сплю|спал|занят|день\s+|сегодня|сейчас\s+)/i.test(u) &&
    u.length >= 6;
  const recentHow = recentAssistantBodies(history, 5).filter((t) => HOW_ASK_RE.test(t)).length;
  if (!heAnsweredHow && recentHow < 1) return reply;
  const stripped = body.replace(HOW_ASK_STRIP_RE, '').trim();
  if (stripped.length >= 6) return tag + (/\)\s*$/.test(stripped) ? stripped : `${stripped})`);
  return tag + pickAlt(['о как)', 'ага)', 'ну ты)', 'хех)', 'ясно)']);
}

const LOVE_STAMP_RE =
  /^(?:ну\s+ты\s+милый|мне\s+(?:тоже\s+)?приятно|с\s+тобой\s+хорошо|приятно\s+слышать|(?:ой[,.]?\s*|очень\s+|так\s+)?мило)\s*\){0,2}\.?$/i;
const LOVE_STAMP_ALTS = [
  'хех ну ты)',
  'тепло от тебя)',
  'ну вот так и нравится)',
  'радует)',
  'кайф с тобой, коротко)',
  'мне тоже)',
];

/** Не штамповать одну и ту же ласку подряд. */
function fixLoveStampOveruse(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !LOVE_STAMP_RE.test(body)) return reply;
  const hits = recentAssistantBodies(history, 8).filter((t) => LOVE_STAMP_RE.test(t)).length;
  if (hits < 1) return reply;
  return tag + pickAlt(LOVE_STAMP_ALTS);
}

/** 0t21: голое «мило)» на содержательное сообщение — слишком пусто. */
const MILO_ALONE_RE = /^(?:ой[,.]?\s*|очень\s+|так\s+)?мило\s*\){0,2}\.?$/i;
const MILO_ALONE_ALTS = ['хех ну ты)', 'тепло)', 'мне приятно слышать)', 'ну ты)', 'радует)'];

function fixMiloAlone(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (u.length < 10) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !MILO_ALONE_RE.test(body)) return reply;
  return tag + pickAlt(MILO_ALONE_ALTS);
}

const INTERESTING_ALONE_RE = /^(?:хм[,.]?\s*)?интересно\s*\){0,2}\.?$/i;
const INTERESTING_ALTS = ['о как, расскажи)', 'ну и?)', 'а дальше?)', 'хм, подробнее)'];

function fixInterestingAlone(reply, userMessage) {
  if (!reply) return reply;
  const u = normalizeBareUserText(userMessage);
  if (u.length < 8) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !INTERESTING_ALONE_RE.test(body)) return reply;
  return tag + pickAlt(INTERESTING_ALTS);
}

const O_KAK_RE = /^о\s+как\s*\){0,2}\.?$/i;
const O_KAK_ALTS = ['серьёзно?)', 'ну ты)', 'хах)', 'ого)', 'и что дальше?)'];

function fixOKakStamp(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !O_KAK_RE.test(body)) return reply;
  const hits = recentAssistantBodies(history, 6).filter((t) => O_KAK_RE.test(t) || /^о\s+как\b/i.test(t)).length;
  if (hits < 1) return reply;
  return tag + pickAlt(O_KAK_ALTS);
}

/** Пачка 0t6 — anti-script для марафона. */
function applyWave0t6Gates(reply, history, userMessage) {
  let out = reply;
  out = fixTherapistTone(out);
  out = fixPonjalaStamp(out, history);
  out = fixDoubleQuestion(out);
  out = fixOpenerLoop(out, history);
  out = fixAgreeableStack(out, userMessage);
  out = fixWhyHereScript(out, userMessage);
  out = fixParrotEcho(out, userMessage);
  out = fixRepeatHowAsk(out, history, userMessage);
  out = fixLoveStampOveruse(out, history);
  out = fixMiloAlone(out, userMessage);
  out = fixInterestingAlone(out, userMessage);
  out = fixOKakStamp(out, history);
  out = fixLaughOnlyOveruse(out, history);
  out = fixNuTakStamp(out, history);
  out = fixSpasiboStamp(out, history);
  out = fixHexAloneOveruse(out, history);
  return out;
}

const NU_TAK_RE = /^(?:ну\s+так|так\s+себе|ну\s+типа)\s*\){0,2}\.?$/i;
const NU_TAK_ALTS = ['хм ну да)', 'о как)', 'ага)', 'ну ты)', 'и что дальше?)'];

function fixNuTakStamp(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !NU_TAK_RE.test(body)) return reply;
  const hits = recentAssistantBodies(history, 6).filter((t) => NU_TAK_RE.test(t)).length;
  if (hits < 1 && body.length > 10) return reply;
  return tag + pickAlt(NU_TAK_ALTS);
}

const SPASIBO_STAMP_RE =
  /^(?:спасибо|благодар(?:ю|на))\s+что\s+написа[а-яё]*\s*\){0,2}\.?$/i;
const SPASIBO_ALTS = ['мне тоже приятно)', 'ну ты)', 'рада)', 'хех спасиб)', 'тепло)'];

function fixSpasiboStamp(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !SPASIBO_STAMP_RE.test(body)) return reply;
  const hits = recentAssistantBodies(history, 8).filter((t) => SPASIBO_STAMP_RE.test(t)).length;
  if (hits < 1) return reply;
  return tag + pickAlt(SPASIBO_ALTS);
}

const LAUGH_ONLY_RE = /^(?:ахах+|хаха+|ахах\s*\)|хах\s*\))$/i;
const LAUGH_ONLY_ALTS = ['ну ты)', 'ой жесть)', 'серьёзно?)', 'хах ну да)', 'ого)'];

function fixLaughOnlyOveruse(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body || !LAUGH_ONLY_RE.test(body.replace(/\s+/g, ''))) return reply;
  const hits = recentAssistantBodies(history, 5).filter((t) =>
    LAUGH_ONLY_RE.test(String(t).replace(/\s+/g, '')),
  ).length;
  if (hits < 1) return reply;
  return tag + pickAlt(LAUGH_ONLY_ALTS);
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
  out = fixSmokingSoftYes(out, userMessage);
  return out;
}

/** 0m1 wave — делегируем в scaleIdeasPack (smoke/registry ожидают export здесь). */
function applyWave0m1Gates(reply, history, userMessage) {
  return require('./scaleIdeasPack').applyWave0m1Gates(reply, history, userMessage);
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
  fixSmokingSoftYes,
  fixDeadFillerReply,
  fixDavaiLoop,
  fixRadaChtoEcho,
  fixDeflectOnFriction,
  fixPhotoStallDeflect,
  fixBotAdmitLeak,
  fixPeerGenderMismatch,
  fixCircleAskDodge,
  fixTherapistTone,
  fixPonjalaStamp,
  fixDoubleQuestion,
  fixOpenerLoop,
  fixAgreeableStack,
  fixWhyHereScript,
  fixParrotEcho,
  fixRepeatHowAsk,
  fixLoveStampOveruse,
  fixMiloAlone,
  fixInterestingAlone,
  fixOKakStamp,
  fixLaughOnlyOveruse,
  fixNuTakStamp,
  fixSpasiboStamp,
  fixHexAloneOveruse,
  applyWave0t2Gates,
  applyWave0t6Gates,
  applyWave0loGates,
  applyWave0m1Gates,
  detectUserLangBlob,
  mskHour,
};
