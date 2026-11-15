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
  const selfFactQ =
    /(?:из\s+какого|откуда\s+ты|ты\s+откуда|где\s+ты|ты\s+где|где\s+ты\s+жив|а\s+где\s*\??\s*$|жив[её]шь\s*\??\s*$|в\s+каком\s+город|как\s+давно|скол[ьк]ко(?:\s+уже)?\s+в\s+)/i.test(
      msg,
    );
  const hooks = pickHookWords(msg);
  const parts = [
    'Ты — живая девушка в личке Telegram (эталон — тёплый чат знакомства, ещё БЕЗ любой «работы/токенов»). ' +
      'Пиши с телефона: очень коротко (часто одна мысль на ответ), тепло, иногда с ленцой или лёгкой вредностью. ' +
      'Типичный ритм: «привет )» / «норм» / «а ты чем?» / «ахаха» — не абзац и не самопрезентация. ' +
      'Цепляйся к его словам. Можно «о как», «ну молодец», «поняла капец», «прикольно». Не зацикливайся на одном слове вроде «кайф». ' +
      'Если смешно — коротко «ахаха»/«хаха», не объясняй шутку. «)» чаще смайла; эмодзи редко. ' +
      'Мелочь из дня ок (зал, подруги, дома, связь пропала, ложусь) — одной фразой, без рассказа «про себя». ' +
      'На встречу/свидание: мягкий отказ через город или срок, без лекции и без «обязательно увидимся». ' +
      'Не обязана поддакивать. Женский род. Факты о себе — только из промпта и истории. ' +
      'Не уходи в NFT/биржи/токены сама — это не этап знакомства.',
  ];
  if (hooks.length) {
    parts.push(`Якорь из его сообщения: ${hooks.map((w) => `«${w}»`).join(', ')} — обыграй хотя бы одно.`);
  }
  let jobAsk = false;
  let jobFlipOk = false;
  try {
    const jf = require('./jobFlipAsk');
    jobAsk = jf.isJobOccupationAsk(msg);
    jobFlipOk = jobAsk && jf.mayMentionFlipNft({ history });
  } catch (_) {
    jobAsk = false;
  }
  if (jobAsk && jobFlipOk) {
    parts.push(
      'Спросил про твою работу — коротко: флипинг токенов / онлайн, и в конце «слышал о таком?)». Без цифр и без дизайна.',
    );
  } else if (jobAsk) {
    parts.push(
      'Спросил про работу — рано для флипа: только онлайн / сама на себя / гибкий график. Без флип/токен/NFT.',
    );
  } else if (selfFactQ) {
    parts.push(
      'Вопрос про тебя (город / откуда / как давно) — одна короткая правда по промпту, без зеркала «а ты?» и без новых городов.',
    );
  } else if (hasQ) {
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
  } else if (softHumanLite.USER_CLOSING_RE.test(msg)) {
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
  let asked = PEER_ASKED_CONTACT_RE.test(msg);
  try {
    const { SOCIAL_SOURCE_INTRO_RE } = require('./humanIdeas15');
    if (asked && SOCIAL_SOURCE_INTRO_RE && SOCIAL_SOURCE_INTRO_RE.test(msg)) asked = false;
  } catch (_) {
    /* optional */
  }
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

const MEET_SOFT_ALTS = [
  'можно) как буду на месте — напиши, погуляем)',
  'ну давай как приеду, пересечёмся)',
  'ок) когда буду в городе — решим)',
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
  // Жёсткий отказ / слабый кивок → мягкое «как буду».
  if (
    isWeak(body) ||
    /не\s+до\s+встреч|только\s+переписк|вся\s+в\s+коробк/i.test(body) ||
    /сложно\s+так\s+сразу|хз\s+сразу|ну\s+смотря|не\s+знаю\s+сходу|норм\s*\)*$/i.test(body) ||
    /^(?:не+|нет|неа)\s*[).!]*$/i.test(body)
  ) {
    return tag + MEET_SOFT_ALTS[Math.floor(Math.random() * MEET_SOFT_ALTS.length)];
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

const MOM_AGE_ALTS = ['за 50 уже)', 'ну за пятьдесят)', 'хм за пятьдесят)', 'около пятидесяти)'];
const BOUQUET_ALTS = ['сама взяла)', 'с рынка)', 'подруга дала)', 'ну купила по пути)'];
const LIVE_WITH_ALTS = ['ага, с родителями пока)', 'ну да, с мамой)', 'пока с родителями)'];

/** Мелочь дня вместо города — баг «где живёшь? → кофе пью». */
const ACTIVITY_FILLER_RE =
  /кофе\s+пью|сериал\s+фоном|просто\s+отдыхаю|дома\s+сижу|валяюсь|ничего\s+особенного|обычный\s+день|устала\s+немного/i;

function fixDirectFactAsk(reply, userMessage, prompt) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  const { tag, body } = stripTags(reply);
  const geoAsk =
    /(?:где\s+ты|ты\s+где|где\s+(?:ты\s+)?жив|а\s+где\s*\??\s*$|жив[её]шь|откуда\s+ты|ты\s+откуда|из\s+какого|как\s+давно|скол[ьк]ко(?:\s+уже)?\s+в\s+)/i.test(
      msg,
    );
  // На гео — ловим и слабый ответ, и «кофе пью)» (не isWeak, ≥4 слов).
  if (!isWeak(body) && !ACTIVITY_FILLER_RE.test(body) && body.split(/\s+/).length >= 4) {
    return reply;
  }

  if (/(?:сколько|скок).{0,20}лет|лет\s+маме/i.test(msg) && /мам/i.test(msg)) {
    return tag + MOM_AGE_ALTS[Math.floor(Math.random() * MOM_AGE_ALTS.length)];
  }
  if (/откуда|от\s*куда/i.test(msg) && /букет|цвет/i.test(msg)) {
    return tag + BOUQUET_ALTS[Math.floor(Math.random() * BOUQUET_ALTS.length)];
  }
  if (/(?:ты\s+)?одна\s+жив|с\s+кем\s+жив/i.test(msg)) {
    return tag + LIVE_WITH_ALTS[Math.floor(Math.random() * LIVE_WITH_ALTS.length)];
  }
  // Слабый / activity-filler на «где / из какого / как давно» — город из промпта.
  if ((isWeak(body) || ACTIVITY_FILLER_RE.test(body)) && geoAsk) {
    try {
      const pf = require('./personaFacts');
      const card = pf.parsePersonaCard(prompt);
      if (card.fromCity && card.toCity && card.packing) {
        if (/как\s+давно|скол[ьк]ко/.test(msg) && card.howLongHere) {
          return tag + `ну ${card.howLongHere} примерно)`;
        }
        if (/откуда|из\s+какого/i.test(msg)) {
          return tag + `из ${card.fromCity})`;
        }
        const here = pf.inCityPrep(card.fromCity);
        const there = pf.inCityAcc ? pf.inCityAcc(card.toCity) : card.toCity;
        return tag + `пока в ${here}, в ${there} еду)`;
      }
      if (card.fromCity) {
        return tag + `в ${pf.inCityPrep(card.fromCity)})`;
      }
    } catch (_) {
      /* optional */
    }
    return tag + ['пока дома)', 'ну дома пока)', 'ещё тут)'][Math.floor(Math.random() * 3)];
  }
  return reply;
}

const COACH_RE =
  /хороший\s+подход|зависит\s+от\s+восприятия|вс[её]\s+зависит\s+от\s+(?:восприятия|ситуации|тебя)|нужно\s+остановиться\s+и\s+подумать|каждому\s+сво[её]|интересный\s+поворот|занятыми\s+становимся|бывает,?\s+что\s+занят|главное,?\s*не\s+торопи|добавить\s+что-то\s+более\s+нежн|такое\s+может\s+сильно\s+расстроить|оценить\s+ситуацию\s+на\s+месте|оста[её]тся\s+только\s+ждать\s+и\s+надеяться|можно\s+попробовать\s+подумать\s+о\s+поездке|восприятия\s+ситуации/i;

const COACH_FALLBACKS = [
  'жесть) а ты как вообще?',
  'блин ну да) и что дальше?',
  'ох) тяжело наверное',
  'ну и дела) ты как держишься?',
];

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
  cleaned = cleaned
    .replace(/(?:^|[^а-яёa-z0-9])но\s+вс[её](?![а-яёa-z0-9])/gi, ' ')
    .replace(/(?:^|[^а-яёa-z0-9])(?:ситуации|ситуацию|восприятия)(?![а-яёa-z0-9])/gi, ' ')
    .replace(/^\s*жесть\s*\)?\s*/i, '')
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const bareClean = cleaned.replace(/[)\s,.!?«»"']/g, '');
  // После вырезания коуча часто остаётся мусор («, но ситуации») — порог жёстче.
  if (
    bareClean.length >= 14 &&
    !COACH_RE.test(cleaned) &&
    !isWeak(cleaned) &&
    !/^(?:но|и|а|да)\s/i.test(cleaned)
  ) {
    return tag + (/\)\s*$/.test(cleaned) ? cleaned : `${cleaned})`);
  }
  return tag + COACH_FALLBACKS[Math.floor(Math.random() * COACH_FALLBACKS.length)];
}

/**
 * На реальный вопрос («?» / сколько / где) не оставляем голое «да/ок/норм».
 */
function fixWeakQuestionReply(reply, userMessage) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  const asked =
    /\?/.test(msg) ||
    /^(?:\?+|сколько|скок|где|откуда|когда|почему|зачем|как\s+(?:тебя|дела|ты|настроен)|ты\s+(?:как|где|откуда)|а\s+чем\s+ты|чем\s+ты\b|что\s+делаешь)/i.test(
      msg,
    );
  if (!asked) return reply;
  const { tag, body } = stripTags(reply);
  if (!isWeak(body)) return reply;
  // Одно «?» без контекста — уточнить, а не «норм».
  if (/^\?+$/.test(msg.replace(/\s/g, ''))) {
    return (
      tag +
      ['в смысле?)', 'а?)', 'что именно?)', 'хм?)'][Math.floor(Math.random() * 4)]
    );
  }
  // Ясный вопрос — ответ по теме, не «раскрой)» (баг Саймон: «как настроение?»).
  if (/как\s+настроен/i.test(msg)) {
    return (
      tag +
      ['норм)', 'ровное пока)', 'нормально)', 'всё ок)'][Math.floor(Math.random() * 4)]
    );
  }
  if (/(?:как\s+(?:дела|день|ты)|ты\s+как)\b/i.test(msg)) {
    return (
      tag +
      ['норм)', 'нормально)', 'ничего, ок)', 'всё ок)'][Math.floor(Math.random() * 4)]
    );
  }
  if (/(?:а\s+)?чем\s+ты\b|что\s+делаешь|чем\s+занят/i.test(msg)) {
    return (
      tag +
      ['дома сижу)', 'ничего особого)', 'просто дома)', 'отдыхаю пока)'][
        Math.floor(Math.random() * 4)
      ]
    );
  }
  if (/(?:где\s+(?:ты\s+)?жив|ты\s+где|откуда|из\s+какого|жив[её]шь)/i.test(msg)) {
    // Город чинит fixDirectFactAsk; тут не «раскрой».
    return tag + ['пока дома)', 'ну дома)', 'ещё тут)'][Math.floor(Math.random() * 3)];
  }
  return (
    tag +
    [
      'хм а подробнее?)',
      'ну смотря что имеешь в виду)',
      'ахах уточни)',
      'не совсем поняла, раскрой)',
    ][Math.floor(Math.random() * 4)]
  );
}

const EDITORIAL_RE =
  /понял[аи],?\s*что\s+ты\s+(?:шутник|тип)|(?:ну\s+)?ты\s+шутник|про\s+стиль|прям\s+молодец|память\s+хорош/i;

function fixEditorialTone(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!EDITORIAL_RE.test(body)) return reply;
  return tag + ['хах ну да)', 'ахах)', 'ну бывает)', 'ага, ясно)'][Math.floor(Math.random() * 4)];
}

const SERVICE_THANKS_RE =
  /^(?:ок|окей|хорошо|ладно|ага|да)[,\s]*(?:нормально[,.\s]*)?(?:спасибо|спс)\s*\)*$|^(?:спасибо|спс)\s*\)*$/i;

function fixServiceThanks(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!SERVICE_THANKS_RE.test(body)) return reply;
  return tag + ['поняла тебя)', 'ну ок)', 'ну ладно)'][Math.floor(Math.random() * 3)];
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
    return tag + ['поняла тебя)', 'ну ок)', 'ну ладно)'][Math.floor(Math.random() * 3)];
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
  if (!reply) return reply;
  let out = reply;
  out = fixContactLeak(out, userMessage);
  out = fixRecruitHedge(out, userMessage);
  out = fixMeetWeakDodge(out, userMessage);
  out = fixRelationshipAsk(out, userMessage);
  out = fixDirectFactAsk(out, userMessage, systemPrompt);
  out = fixAiAssistantMode(out, userMessage);
  out = fixCoachSpeak(out);
  out = fixWeakQuestionReply(out, userMessage);
  out = fixEditorialTone(out);
  out = fixServiceThanks(out);
  out = fixMisplacedThanks(out, userMessage);
  out = fixFormalPlease(out);
  out = fixBrokenHedgeTail(out);
  out = fixDismissiveFriendly(out, userMessage);
  // Мягкий слой: коуч-фразы, обрубки, взаимный вопрос — без банков уклонов.
  out = softHumanLite.applySoftLite(out, history, userMessage);
  // softLite мог снова свести к «ага)» — второй проход на вопросе.
  out = fixWeakQuestionReply(out, userMessage);
  return out;
}

module.exports = {
  buildThinHumanHint,
  applyThinPostfilters,
  // for smoke
  fixContactLeak,
  fixRelationshipAsk,
  fixCoachSpeak,
  fixWeakQuestionReply,
  fixDirectFactAsk,
  fixServiceThanks,
  fixMisplacedThanks,
  fixMeetWeakDodge,
  fixAiAssistantMode,
};
