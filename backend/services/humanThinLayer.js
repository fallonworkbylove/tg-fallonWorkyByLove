/**
 * Тонкий слой человечности: короткий хинт + мало постфильтров.
 * Хинт — про КАК писать (позитив), не простыня запретов.
 * Safety/sense-фиксы — ниже в applyThinPostfilters.
 */

const softHumanLite = require('./softHumanLite');

function bare(userMessage) {
  return String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .replace(/\n?\[(?:Ответ на сообщение|ответ на)[^\]]*\]/gi, '')
    .replace(/\[Голосовое\]:?\s*/gi, '')
    .trim();
}

function stripTags(reply) {
  const tag = (String(reply).match(/^\s*<<[^>]+>>\s*/) || [''])[0];
  const body = String(reply)
    .slice(tag.length)
    .replace(/<<[^>]+>>/g, '')
    .trim();
  return { tag, body };
}

function isWeak(body) {
  return /^(?:(?:хм|эм)[,\s]+)?(?:ну\s+)?(?:да|ага|угу|поняла|понял|ок|окей|ладно|норм|ого|жесть|блин|хах|ахах)\s*\)*$/i.test(
    String(body || '').trim(),
  );
}

/** Вытащить 1–3 «живых» слова из его фразы для якоря. */
function pickHookWords(msg) {
  const stop = new Set([
    'это', 'вот', 'как', 'что', 'чем', 'где', 'кто', 'про', 'для', 'или', 'если',
    'меня', 'тебя', 'тебе', 'мне', 'мой', 'моя', 'мои', 'твой', 'твоя', 'просто',
    'очень', 'только', 'сейчас', 'щас', 'типа', 'вообще', 'короче', 'ладно',
    'ага', 'угу', 'ну', 'да', 'нет', 'неа', 'ок', 'окей', 'есть', 'было', 'будет',
  ]);
  const words = String(msg || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w));
  const uniq = [];
  for (const w of words) {
    if (!uniq.includes(w)) uniq.push(w);
    if (uniq.length >= 3) break;
  }
  return uniq;
}

/** Один сжатый хинт: ремесло живого чата, без каскада ЗАПРЕЩЕНО. */
function buildThinHumanHint(userMessage, history) {
  const msg = bare(userMessage);
  const hasQ =
    /\?/.test(msg) ||
    /^(?:сколько|скок|где|откуда|когда|почему|зачем|как\s+тебя|ты\s+замуж)/i.test(msg);
  const hooks = pickHookWords(msg);
  const parts = [
    'Пиши как девушка в обычном Telegram: коротко, залюбленно и тепло, будто печатаешь с телефона. ' +
      'Цепляйся к его словам — повтори крошку смысла своими словами, не общий кивок. ' +
      'Ритм живой: иногда одна обрубленная фраза, иногда два коротких куска; можно «ну/хм/типа» в начале, если к месту. ' +
      'Лёгкая нежность в формулировках ок («мне приятно)», «ну ты милый)»). ' +
      'Скобка «)» — улыбка; эмодзи-смайл (☺️😊🥰) — редко, максимум один. Без коуч-тона и без «эссе про жизнь».',
  ];
  if (hooks.length) {
    parts.push(`Якорь из его сообщения: ${hooks.map((w) => `«${w}»`).join(', ')} — обыграй хотя бы одно.`);
  }
  if (hasQ) {
    parts.push('У него вопрос — сначала прямой короткий ответ по сути, потом уже болтовня если хочется.');
  } else if (msg.length >= 35) {
    parts.push(
      'Он поделился — живая реакция с деталью из его слов (что именно зацепило), не голое «ага)» / «поняла)».',
    );
  } else if (msg.length > 0 && msg.length < 12 && !hasQ) {
    parts.push('Короткое «ок/ага» от него — можно так же коротко, без разгона темы.');
  }
  if (Array.isArray(history) && history.length >= 4) {
    parts.push('Держи нить диалога: продолжай последнюю тему, не начинай с чистого листа.');
  }
  if (softHumanLite.needsReciprocalQuestion(history, userMessage)) {
    parts.push(
      'Диалог односторонний — после короткого ответа один живой вопрос про него (день / чем занят / настроение), без зеркала «а ты откуда».',
    );
  } else if (softHumanLite.USER_CLOSING_RE.test(bare)) {
    parts.push(
      'Он прощается / идёт спать — только тёплое спокойной ночи, БЕЗ вопроса «чем занят / как день».',
    );
  }
  return parts.join(' ');
}

// --- Safety -----------------------------------------------------------------

const PEER_ASKED_CONTACT_RE =
  /(инстаграм|instagram|\binsta\b|инста\b|инсту\b|рилс|reels|дай\s+инст|скинь\s+инст|дай\s+ссылк|ссылку|твой\s+ник|какой\s+ник|вконтакте|(?<![а-яёa-z0-9])вк(?![а-яёa-z0-9])|whatsapp|ватсап|номер\s+телефона|дай\s+номер)/i;
const CONTACT_LEAK_RE =
  /(instagram\.com|https?:\/\/|www\.|держи\)?|вот\s+ссылк|такой\s+же,?\s+как\s+здесь|(?:^|[^а-яёa-z])ник(?![а-яёa-z])\s*[:\-–]?\s*[a-z0-9_.]{3,})/i;
const CONTACT_WEAK_AGREE_RE =
  /^(?:(?:ну\s+)?давай|норм|ок|окей|ага|угу|конечно|держи|лови|вот)\s*\)*$/i;
const CONTACT_REFUSALS = [
  'не даю пока, давай тут общаться)',
  'давай лучше тут) не люблю по разным сайтам',
  'инсту не кидаю, давай тут)',
];

function fixContactLeak(reply, userMessage) {
  if (!reply) return reply;
  const msg = String(userMessage || '');
  const { tag, body } = stripTags(reply);
  if (!body) return reply;
  const asked = PEER_ASKED_CONTACT_RE.test(msg);
  if (asked && (CONTACT_LEAK_RE.test(body) || CONTACT_WEAK_AGREE_RE.test(body) || /инст|ник|ссылк/i.test(body))) {
    return tag + CONTACT_REFUSALS[Math.floor(Math.random() * CONTACT_REFUSALS.length)];
  }
  if (CONTACT_LEAK_RE.test(body) && (asked || /инст|ссылк|ник/i.test(body))) {
    return tag + CONTACT_REFUSALS[Math.floor(Math.random() * CONTACT_REFUSALS.length)];
  }
  return reply;
}

const RECRUIT_SOFT_DENY = [
  'не-не, просто делюсь, сам решай)',
  'неа, я просто рассказала)',
  'хах нет, без уговоров)',
];

function fixRecruitHedge(reply, userMessage) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  let isRecruit = /затян|втян\w*\s+меня|попробуй\s+затян/i.test(msg);
  try {
    isRecruit = require('./objectionHandler').isRecruitAccusation(msg) || isRecruit;
  } catch (_) {
    /* optional */
  }
  if (!isRecruit) return reply;
  const { tag, body } = stripTags(reply);
  if (/может\s+быть|попробую|давай\s+попробу|затян/i.test(body)) {
    return tag + RECRUIT_SOFT_DENY[Math.floor(Math.random() * RECRUIT_SOFT_DENY.length)];
  }
  return reply;
}

const MEET_REFUSALS = [
  'давай пока тут, с переездом вообще не до встреч)',
  'ой пока не до встреч, я вся в коробках',
  'не, пока только переписка, переезд этот все силы съел',
];

function fixMeetWeakDodge(reply, userMessage) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  let isMeet = false;
  try {
    isMeet = require('./objectionHandler').isMeetRequest(msg);
  } catch (_) {
    isMeet = /встрет|увидел|погулять|кофе\s+офлайн|приеду\s+к|в\s+гости/i.test(msg);
  }
  if (!isMeet) return reply;
  const { tag, body } = stripTags(reply);
  if (
    isWeak(body) ||
    /сложно\s+так\s+сразу|хз\s+сразу|ну\s+смотря|не\s+знаю\s+сходу|норм\s*\)*$/i.test(body)
  ) {
    return tag + MEET_REFUSALS[Math.floor(Math.random() * MEET_REFUSALS.length)];
  }
  return reply;
}

// --- Sense (без dodge-банков) -----------------------------------------------

const RELATIONSHIP_ASK_RE =
  /(?:ты\s+)?замужем|замуж\b|есть\s+(?:ли\s+)?(?:у\s+тебя\s+)?парень|парень\s+есть|ты\s+свободн|ты\s+одинока/i;
const RELATIONSHIP_ALTS = ['неа)', 'нет)', 'свободна пока)', 'без парня)', 'пока нет)'];

function fixRelationshipAsk(reply, userMessage) {
  if (!reply || !RELATIONSHIP_ASK_RE.test(bare(userMessage))) return reply;
  const { tag, body } = stripTags(reply);
  const clearNo = /(?:^|[\s,])(?:неа|нет)\b|свободн|без\s+парн|не\s+замуж|пока\s+нет/i.test(body);
  if (clearNo) return reply;
  return tag + RELATIONSHIP_ALTS[Math.floor(Math.random() * RELATIONSHIP_ALTS.length)];
}

const MOM_AGE_ALTS = ['за 50 уже)', 'около 52)', 'ну за пятьдесят)', 'хм 51 вроде)'];
const BOUQUET_ALTS = ['сама взяла)', 'с рынка)', 'подруга дала)', 'ну купила по пути)'];
const LIVE_WITH_ALTS = ['ага, с родителями пока)', 'ну да, с мамой)', 'пока с родителями)'];

function fixDirectFactAsk(reply, userMessage) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  const { tag, body } = stripTags(reply);
  if (!isWeak(body) && body.split(/\s+/).length >= 4) return reply;

  if (/(?:сколько|скок).{0,20}лет|лет\s+маме/i.test(msg) && /мам/i.test(msg)) {
    return tag + MOM_AGE_ALTS[Math.floor(Math.random() * MOM_AGE_ALTS.length)];
  }
  if (/откуда|от\s*куда/i.test(msg) && /букет|цвет/i.test(msg)) {
    return tag + BOUQUET_ALTS[Math.floor(Math.random() * BOUQUET_ALTS.length)];
  }
  if (/(?:ты\s+)?одна\s+жив|с\s+кем\s+жив/i.test(msg)) {
    return tag + LIVE_WITH_ALTS[Math.floor(Math.random() * LIVE_WITH_ALTS.length)];
  }
  if (/^(?:где\s+ты|а\s+ты\s+где|ты\s+где)\b/i.test(msg.trim()) && isWeak(body)) {
    return tag + ['ещё тут, собираюсь)', 'пока дома)', 'ну дома пока)'][Math.floor(Math.random() * 3)];
  }
  return reply;
}

const COACH_RE =
  /хороший\s+подход|зависит\s+от\s+восприятия|нужно\s+остановиться\s+и\s+подумать|каждому\s+сво[её]|интересный\s+поворот|занятыми\s+становимся|бывает,?\s+что\s+занят|главное,?\s*не\s+торопи|добавить\s+что-то\s+более\s+нежн/i;

function fixCoachSpeak(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!COACH_RE.test(body)) return reply;
  let cleaned = body;
  for (let i = 0; i < 4; i += 1) {
    const m = cleaned.match(COACH_RE);
    if (!m) break;
    cleaned = cleaned.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
  }
  cleaned = cleaned.replace(/^[\s,.;:]+|[\s,.;:]+$/g, '').trim();
  if (cleaned.length >= 8 && !COACH_RE.test(cleaned) && !isWeak(cleaned)) {
    return tag + (/\)\s*$/.test(cleaned) ? cleaned : `${cleaned})`);
  }
  // Не сводим к «ага)» — оставляем исходник, если вычистить нечего осмысленного.
  return reply;
}

const EDITORIAL_RE =
  /понял[аи],?\s*что\s+ты\s+(?:шутник|тип)|(?:ну\s+)?ты\s+шутник|про\s+стиль|прям\s+молодец|память\s+хорош/i;

function fixEditorialTone(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!EDITORIAL_RE.test(body)) return reply;
  return tag + ['хах ну да)', 'ахах)', 'ну бывает)', 'ага)'][Math.floor(Math.random() * 4)];
}

const SERVICE_THANKS_RE =
  /^(?:ок|окей|хорошо|ладно|ага|да)[,\s]*(?:нормально[,.\s]*)?(?:спасибо|спс)\s*\)*$|^(?:спасибо|спс)\s*\)*$/i;

function fixServiceThanks(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!SERVICE_THANKS_RE.test(body)) return reply;
  return tag + ['ага)', 'ну ок)', 'ладно)'][Math.floor(Math.random() * 3)];
}

/**
 * «Спасибо» не за комплимент/подарок (привет / как дела) — срезаем.
 * Пример бага: «да, нормально, спасибо)» на «Приветик, хорошо, ты как?)».
 */
function fixMisplacedThanks(reply, userMessage) {
  if (!reply || !/спасибо|спс/i.test(String(reply))) return reply;
  const msg = bare(userMessage);
  const deserved =
    /спасибо|благодар|мил[аяоы]|красив|умниц|нрав|😍|🥰|😘|❤|подарок|цветы|обнимаю|целую/i.test(
      msg,
    );
  if (deserved) return reply;
  const { tag, body } = stripTags(reply);
  if (!/спасибо|спс/i.test(body)) return reply;
  let cleaned = body
    .replace(/,?\s*(?:большое\s+)?(?:спасибо|спс)(?![а-яёa-z0-9])\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[,.;]+\s*|\s*[,.;]+\s*$/g, '')
    .trim();
  if (cleaned.replace(/[)\s]/g, '').length < 4) {
    if (/привет|хай|здаров|ты\s+как|как\s+дела|как\s+ты/i.test(msg)) {
      return tag + ['хорошо)', 'норм, ты как?)', 'да нормально)'][Math.floor(Math.random() * 3)];
    }
    return tag + ['ага)', 'ну ок)', 'ладно)'][Math.floor(Math.random() * 3)];
  }
  if (!/[)….!?]$/.test(cleaned)) cleaned += ')';
  return tag + cleaned;
}

function fixFormalPlease(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!/уточни,?\s*пожалуйста|не\s+совсем\s+понял[аи],?\s*что\s+имеешь\s+в\s+виду/i.test(body)) {
    return reply;
  }
  return tag + ['ахах в смысле?)', 'что именно?)', 'хм а подробнее?)'][Math.floor(Math.random() * 3)];
}

function fixBrokenHedgeTail(reply) {
  if (!reply || !/довольно\s+ну\s+ок/i.test(String(reply))) return reply;
  const { tag, body } = stripTags(reply);
  let cleaned = body.replace(/\)?\s*довольно\s+ну\s+ок\)*/gi, ')').replace(/\s{2,}/g, ' ').trim();
  // Раньше сюда подмешивали NFT даже без крипто-контекста — убрали.
  if (cleaned.length >= 6) return tag + (/\)\s*$/.test(cleaned) ? cleaned : `${cleaned})`);
  return reply;
}

function fixDismissiveFriendly(reply, userMessage) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!/^(?:фигня\s+какая|ну\s+и\s+фигня)\s*\)*$/i.test(body)) return reply;
  const msg = bare(userMessage);
  if (/расскаж|о\s+себе|послуша|голосовое|друг/i.test(msg) || msg.length >= 12) {
    return tag + ['давай)', 'слушаю)', 'ок, слушаю)'][Math.floor(Math.random() * 3)];
  }
  return reply;
}

const AI_ASSIST_ASK_RE =
  /сгенерир\w*|напиши\s+(?:мне\s+)?(?:текст|поздравлени|открытк|стих|эссе|сочинени)|сделай\s+(?:мне\s+)?открытк|текст\s+поздравлени/i;
const AI_ASSIST_REPLY_RE =
  /можно\s+так\s*:|можно\s+сделать\s+что-то\s+вроде\s*:|дорогой\s*\[|поздравля(?:ю|ем)\s+(?:тебя\s+)?со\s+свадьб|пусть\s+ваша\s+любовь|гармонии\s+в\s+вашем|«[^»]{40,}»|"[^"]{40,}"/i;
const AI_ASSIST_REFUSALS = [
  'хах я не нейросеть, сама пиши)',
  'ну ты серьёзно) я ж не chatgpt',
  'не, не в этом формате)',
  'ахах нет, давай без генераций)',
];

/** Режим ChatGPT на «сгенерируй текст/открытку» — срезаем шаблон. */
function fixAiAssistantMode(reply, userMessage) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  if (!AI_ASSIST_ASK_RE.test(msg)) return reply;
  const { tag, body } = stripTags(reply);
  if (!AI_ASSIST_REPLY_RE.test(body) && body.length < 80) return reply;
  if (!AI_ASSIST_REPLY_RE.test(body) && !/[«"]/.test(body)) return reply;
  return tag + AI_ASSIST_REFUSALS[Math.floor(Math.random() * AI_ASSIST_REFUSALS.length)];
}

/**
 * Единая точка: safety → sense → style. Без ASK_DODGE / pickAskFallback.
 */
function applyThinPostfilters(reply, userMessage, history = null, systemPrompt = null) {
  void systemPrompt;
  if (!reply) return reply;
  let out = reply;
  out = fixContactLeak(out, userMessage);
  out = fixRecruitHedge(out, userMessage);
  out = fixMeetWeakDodge(out, userMessage);
  out = fixRelationshipAsk(out, userMessage);
  out = fixDirectFactAsk(out, userMessage);
  out = fixAiAssistantMode(out, userMessage);
  out = fixCoachSpeak(out);
  out = fixEditorialTone(out);
  out = fixServiceThanks(out);
  out = fixMisplacedThanks(out, userMessage);
  out = fixFormalPlease(out);
  out = fixBrokenHedgeTail(out);
  out = fixDismissiveFriendly(out, userMessage);
  // Мягкий слой: коуч-фразы, обрубки, взаимный вопрос — без банков уклонов.
  out = softHumanLite.applySoftLite(out, history, userMessage);
  return out;
}

module.exports = {
  buildThinHumanHint,
  applyThinPostfilters,
  // for smoke
  fixContactLeak,
  fixRelationshipAsk,
  fixCoachSpeak,
  fixDirectFactAsk,
  fixServiceThanks,
  fixMisplacedThanks,
  fixMeetWeakDodge,
  fixAiAssistantMode,
};
