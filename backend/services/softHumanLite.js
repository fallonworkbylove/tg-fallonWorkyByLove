/**
 * Минимальный слой поверх Oct1: без банков уклонов и без каскада запретов.
 * 1) короткий общий хинт модели (+ взаимный вопрос, если давно не спрашивала)
 * 2) вырезание коуч-клауз (старое)
 * 3) дожим обрубков
 * 4) если нужна взаимность и модель молчит — один мягкий вопрос в хвост
 */

function recentDialogBlob(history, userMessage) {
  const hist = Array.isArray(history) ? history : [];
  const parts = hist
    .slice(-10)
    .map((h) => String(h && h.content ? h.content : ''))
    .concat([String(userMessage || '')]);
  return parts.join('\n');
}

/** «Сайт» после Дайвинчика = знакомства; флип/NFT = работа, только если он про это. */
function isDatingSiteAsk(history, userMessage) {
  const msg = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
  if (!msg) return false;
  if (/(?:флип|nft|нфт|токен|крипт|коллекц)/i.test(msg)) return false;
  const asksSite =
    /(?:на\s+)?сайт[еуа]?(?=[^а-яё]|$)|по\s+сайту|с\s+сайта|в\s+боте\s+знакомств|на\s+дв(?=[^а-яё]|$)/i.test(
      msg,
    );
  if (!asksSite) return false;
  const blob = recentDialogBlob(history, userMessage);
  return /дайвинчик|давинчик|леомatch|leomatch|(?:^|[\s/])дв(?=[^а-яё]|$)|с\s+дайв/i.test(blob);
}

function softHint(history, userMessage) {
  const parts = [
    'Пиши как живая девушка в личке с телефона: тепло, чуть хаотично, по-человечески — не саппорт и не ChatGPT. ' +
      'Цепляйся к конкретике из его фразы своими словами, не общие «ого)» / «поняла)». ' +
      'На факт или вопрос — сначала по сути; ритм живой (то короче, то чуть нежнее). ' +
      'Можно «ну/хм/типа/блин/короче/слушая» в начале; скобка «)» — улыбка; смайл — редко один. ' +
      'Можно маленькую опечатку или сбитый порядок слов, если звучит естественно — не переигрывай. ' +
      'Можно своё мини-мнение («мне норм)», «ну спорно)») вместо вежливого согласия. ' +
      'Без коуч-тона, без «чем могу помочь», без пустых «вместе посмотрим», пока нечего кинуть. ' +
      'Два мира: ДВ/сайт знакомств ≠ NFT/флип (работа) — не путай, пока он сам не смешал.',
  ];

  if (isDatingSiteAsk(history, userMessage)) {
    parts.push(
      'ВАЖНО СЕЙЧАС: он про сайт/ДВ знакомств, НЕ про NFT. ' +
        'Ответь в контексте знакомств (общаюсь / смотрю анкеты / просто поболтать). ' +
        'Не пиши про коллекции NFT, токены и флиппинг.',
    );
  }

  if (needsReciprocalQuestion(history, userMessage)) {
    parts.push(
      'ВАЖНО СЕЙЧАС: ты несколько сообщений только отвечала — диалог односторонний. ' +
        'После короткого ответа добавь ОДИН живой вопрос про него: как день, чем занят, что делал, как настроение. ' +
        'НЕ зеркаль «а ты откуда?» / «а ты чем занимаешься?» сразу после своего города/работы. ' +
        'Не допрос: один вопрос, без второго.',
    );
  }
  return parts.join(' ');
}

/** Он прощается / ложится — встречный «чем занят?» абсурд. */
const USER_CLOSING_RE =
  /(?:доброй\s+ночи|спокойной\s+ночи|споки(?:-споки)?|good\s*night|gute\s*nacht|сладких\s+снов|ночи\s*😴|(?:я\s+)?(?:наверно|наверное|пожалуй|сейчас)\s+спать(?![а-яёa-z0-9])|иду\s+спать|пойду\s+спать|(?:^|[^а-яёa-z0-9])спать(?![а-яёa-z0-9])|ложусь|вырубаюсь|отключаюсь|пока\s*[).!]*\s*$|бывай|до\s+завтра)/i;

/** Ответ уже прощание — не дописываем вопрос про день. */
const REPLY_FAREWELL_RE =
  /(?:спокойной(?:\s+ночи)?|доброй\s+ночи|споки|сладких(?:\s+снов)?|good\s*night|ночи\s*[).,]|целую.*(?:ноч|спок)|обнимаю.*(?:ноч|спок))/i;

/**
 * Нужен встречный вопрос: давно не спрашивала, он не закидывает пачкой вопросов.
 */
function needsReciprocalQuestion(history, userMessage) {
  const hist = Array.isArray(history) ? history : [];
  const recentAsst = hist
    .filter((h) => h && h.role === 'assistant')
    .slice(-4)
    .map((h) => String(h.content || ''));

  if (recentAsst.some((t) => /\?/.test(t))) return false;

  const msg = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();

  // Прощание / «иду спать» — только ответить, без «чем занят?».
  if (USER_CLOSING_RE.test(msg)) return false;

  // Поправка «уже утро / в смысле» — сначала признай косяк, без встречного вопроса.
  if (USER_SAYS_DAYTIME_RE.test(msg) || /^(?:в\s+смысле|чё|че|что)\s*\??$/i.test(msg)) {
    return false;
  }

  // Прямо просит, чтобы она спрашивала.
  if (
    /ничего\s+не\s+будешь\s+спрашив|не\s+будешь\s+спрашивать|сама\s+(?:что|чё|че)-?нибудь\s+спроси|задавай\s+(?:мне\s+)?вопрос|спроси\s+(?:уже|что)/i.test(
      msg,
    )
  ) {
    return true;
  }

  const qMarks = (msg.match(/\?/g) || []).length;
  // Он допрашивает — сначала ответь, без встречного.
  if (qMarks >= 2) return false;

  if (recentAsst.length >= 3) return true;
  if (recentAsst.length >= 2 && qMarks === 0 && msg.length >= 8) return true;
  return false;
}

/** Целые фразы-коучи — вырезаем целиком, без обрубков вроде «ться». */
const COACHY_PHRASE_RE =
  /(?:^|[\s,.(])(?:не\s+переживай|вс[её]\s+будет\s+(?:хорошо|ок)|главное(?:\s*[-–,]?\s*(?:не\s+торопи[а-яё]*|быть\s+в\s+форме))?|важно\s+правильно\s+питаться(?:,?\s*чтобы\s+силы\s+были)?|важно\s+ценить\s+(?:время|близких)(?:\s+с\s+близкими)?|поддержка\s+важна|без\s+поддержки\s+трудно|надо\s+беречь\s+себя|беречь\s+себя|радость,?\s*когда\s+дела\s+идут(?:\s+хорошо)?|переживать\s+нормально(?:(?:,|\s+но)\s+важно\s+не\s+забывать\s+о\s+себе)?|чтобы\s+силы\s+были)(?:\s*\)+)?/gi;

const COACHY_HIT_RE =
  /не\s+переживай|вс[её]\s+будет\s+(?:хорошо|ок)|не\s+торопи|быть\s+в\s+форме|правильно\s+питаться|ценить\s+(?:время|близких)|поддержка\s+важна|без\s+поддержки|беречь\s+себя|радость,?\s*когда\s+дела|переживать\s+нормально/i;

const SOFT_ALTS = ['ну бывает)', 'хм, поняла)', 'ну ладно)', 'жесть конечно)'];

function softenCoachy(reply) {
  if (!reply || !COACHY_HIT_RE.test(String(reply))) return reply;
  return String(reply)
    .split('\n')
    .map((line) => {
      const tag = (line.match(/^\s*<<[^>]+>>\s*/) || [''])[0];
      let body = line.slice(tag.length).trim();
      if (!body || !COACHY_HIT_RE.test(body)) return line;

      COACHY_PHRASE_RE.lastIndex = 0;
      let text = body.replace(COACHY_PHRASE_RE, ' ');
      text = text
        .replace(/(?:^|[\s,.(])главное(?![а-яёa-z0-9])/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\(\s*\)/g, '')
        .replace(/^\s*[,.;:\-–]+|[,.;:\-–]+\s*$/g, '')
        .replace(/\s+([).!?])/g, '$1')
        .replace(/([(\s])\.(?=\s|$)/g, '$1')
        .trim();

      // Вся фраза была коуч-вода — короткая живая реакция, не обрубок.
      if (
        text.replace(/[)\s]/g, '').length < 6 ||
        /^(?:,|\.|главное)\s*\)?$/i.test(text)
      ) {
        return tag + SOFT_ALTS[Math.floor(Math.random() * SOFT_ALTS.length)];
      }
      if (text.length < 12 && !/\)$/.test(text)) text += ')';
      return tag + text;
    })
    .join('\n');
}

/** Канцелярит и «робо-связки» → разговорный тон. */
function humanizeChatTexture(reply) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  let body = String(reply).slice(tag.length);
  if (!body.trim() || /^<<(?:REACT|PHOTO|VIDEO|CIRCLE|LAUGH)/i.test(String(reply).trim())) {
    return reply;
  }
  // \b плохо режет кириллицу — границы через lookaround по буквам.
  const b = '(?<![а-яёa-z0-9])';
  const e = '(?![а-яёa-z0-9])';
  body = body
    .replace(new RegExp(`${b}я\\s+хотела\\s+бы${e}`, 'gi'), 'я б хотела')
    .replace(new RegExp(`${b}хотелось\\s+бы${e}`, 'gi'), 'хочется')
    .replace(new RegExp(`${b}безусловно${e}`, 'gi'), 'ну да')
    .replace(new RegExp(`${b}разумеется${e}`, 'gi'), 'ну ясно')
    .replace(new RegExp(`${b}конечно\\s+же${e}`, 'gi'), 'ну да')
    .replace(new RegExp(`${b}в\\s+любом\\s+случае${e}`, 'gi'), 'ну')
    .replace(new RegExp(`${b}тем\\s+не\\s+менее${e}`, 'gi'), 'но')
    .replace(new RegExp(`${b}таким\\s+образом${e}`, 'gi'), 'ну короче')
    .replace(new RegExp(`${b}необходимо${e}`, 'gi'), 'надо')
    .replace(new RegExp(`${b}следует${e}`, 'gi'), 'лучше')
    .replace(new RegExp(`${b}довольно\\s+интересно${e}`, 'gi'), 'прикольно')
    .replace(new RegExp(`${b}весьма${e}`, 'gi'), 'прям')
    .replace(new RegExp(`${b}я\\s+понимаю\\s+тво[её]\\s+чувства?${e}`, 'gi'), 'ну понимаю')
    .replace(new RegExp(`${b}это\\s+нормально\\s+чувствовать${e}`, 'gi'), 'бывает')
    .replace(
      new RegExp(`${b}спасибо\\s+за\\s+(?:тво[её]\\s+)?(?:сообщение|доверие|откровение)${e}`, 'gi'),
      'спасибо)',
    )
    .replace(new RegExp(`${b}давай\\s+продолжим\\s+общение${e}`, 'gi'), 'ну пиши)')
    .replace(new RegExp(`${b}продолжить\\s+общение${e}`, 'gi'), 'писать')
    .replace(new RegExp(`${b}буду\\s+рада\\s+(?:продолжить|общению)${e}`, 'gi'), 'ну ок)')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([).!?])/g, '$1')
    .trim();
  // Иногда разбиваем длинную однострочную реплику на 2 куска — как с телефона.
  if (
    !body.includes('\n') &&
    body.length >= 55 &&
    body.length <= 140 &&
    /[,.]/.test(body) &&
    Math.random() < 0.28
  ) {
    const parts = body.split(/(?<=[,.])\s+/);
    if (parts.length >= 2) {
      const cut = Math.max(1, Math.floor(parts.length / 2));
      const a = parts.slice(0, cut).join(' ').trim();
      const b = parts.slice(cut).join(' ').trim();
      if (a.length >= 12 && b.length >= 8) body = `${a}\n${b}`;
    }
  }
  return tag + body;
}

/** Явный обрубок целого ответа — дожимаем, не трогаем нормальные короткие. */
function softCompleteCut(reply) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!body || body.includes('\n')) return reply;

  // Пустые «дописки» без смысла — не оставляем как целый ответ.
  // Фоллбэки длиннее 8 символов, иначе снова палятся как «слабые».
  if (
    /^(?:а\s+ещё|ой\s+и\s+ещё|кстати\s+да|забыла\s+сказать|ну\s+и\s+всё)\s*\)?$/i.test(
      body,
    )
  ) {
    return (
      tag +
      ['ну ладно тогда)', 'хм, поняла)', 'ок, я тут)'][
        Math.floor(Math.random() * 3)
      ]
    );
  }
  if (/^(?:последний\s+был)\s*\)?$/i.test(body)) {
    return tag + ['ну был норм)', 'хз, обычный)', 'какой-то был)'][Math.floor(Math.random() * 3)];
  }
  if (/^(?:по\s+делу)\s*\)?$/i.test(body)) {
    return tag + ['ну типа того)', 'ага, по делу)', 'да, коротко)'][Math.floor(Math.random() * 3)];
  }
  if (/\s(?:был|была)\s*$/i.test(body) && body.split(/\s+/).length <= 5) {
    return tag + `${body.replace(/\s*$/, '')} норм)`;
  }
  return reply;
}

/** Голые междометия / пустые реакции без содержания. */
const BARE_ACK_RE =
  /^(?:ага|угу|ок|окей|ладно|ясно|поняла?|ну\s+да|хм\s+ок|круто|здорово|супер|класс|аминь|радость|доброе|ок\)\)|ну\s+ок)\s*\){0,2}$/i;

/**
 * На содержательную реплику («я с района», факт, рассказ) голый «ага/ладно»
 * выглядит пусто — подкручиваем реакцию с крюком.
 */
function enrichBareAckOnSubstance(reply, userMessage) {
  if (!reply) return reply;
  const user = String(userMessage || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!user || user.length < 12) return reply;
  if (/^(?:ну\s+|да\s+)?(?:ага|угу|ок|окей|ладно|норм|хорошо|ясно|понял[а]?|спс|спасибо)\b/i.test(user)) {
    return reply;
  }
  if (/\?/.test(user) && user.length < 40) return reply;

  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!BARE_ACK_RE.test(body)) {
    return reply;
  }
  // Есть конкретика у него — короткая реакция с отсылкой, не голое «ага».
  const words = user.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
  const hook = words[0] ? words[0].replace(/[^\p{L}\p{N}-]/gu, '') : '';
  const variants = hook
    ? [
        `ого, ${hook.toLowerCase()})`,
        `а, про ${hook.toLowerCase()})`,
        `ну ясно, интересно)`,
      ]
    : ['ну ясно)', 'интересн)', 'ого, расскажи)'];
  return tag + variants[Math.floor(Math.random() * variants.length)];
}

const RECIPROCAL_QS = [
  'а ты как день?',
  'чем сейчас занят?)',
  'а у тебя как дела?)',
  'ты чего делаешь?)',
  'как настроение?)',
  'а ты чего?)',
  'ну а у тебя как?)',
  'что у тебя нового?)',
];

/**
 * Если нужна взаимность, а в ответе нет «?» — дописать один мягкий вопрос.
 * Не трогаем реакции, медиа-токены и прощания («спокойной ночи»).
 */
function ensureReciprocalQuestion(reply, history, userMessage) {
  if (!reply || !needsReciprocalQuestion(history, userMessage)) return reply;
  const text = String(reply).trim();
  if (!text || /^<<(?:REACT|PHOTO|VIDEO|CIRCLE|LAUGH)/i.test(text)) return reply;
  if (/\?/.test(text)) return reply;
  if (REPLY_FAREWELL_RE.test(text)) return reply;
  // Уже длинновато — не раздуваем.
  if (text.length > 160) return reply;
  const q = RECIPROCAL_QS[Math.floor(Math.random() * RECIPROCAL_QS.length)];
  const base = text.replace(/\s+$/g, '');
  return `${base} ${q}`;
}

/**
 * Модель сама могла воткнуть «спокойной… чем занят?» — срезаем хвостовой
 * вопрос про активность после прощания.
 */
function stripQuestionAfterFarewell(reply) {
  if (!reply) return reply;
  const text = String(reply).trim();
  if (!REPLY_FAREWELL_RE.test(text)) return reply;
  if (!/\?/.test(text)) return reply;
  const cleaned = text
    .replace(
      /\s*[,.]?\s*(?:а\s+)?(?:чем\s+(?:сейчас\s+)?занят|ты\s+чего\s+делаешь|что\s+(?:делаешь|у\s+тебя\s+нового)|как\s+(?:день|дела|настроение)|а\s+ты\s+как(?:\s+день)?|а\s+у\s+тебя\s+как(?:\s+дела)?|ну\s+а\s+у\s+тебя\s+как|а\s+ты\s+чего)\s*\??\s*\)?\s*$/i,
      '',
    )
    .replace(/\s*\?\s*\)?\s*$/, '')
    .trim();
  if (cleaned.length >= 8 && REPLY_FAREWELL_RE.test(cleaned)) {
    return /\)\s*$/.test(cleaned) ? cleaned : `${cleaned})`;
  }
  return reply;
}

/**
 * Для stripHabitualTrailingQuestion: оставить хвостовой вопрос, если нужна взаимность.
 * Зеркала «а ты откуда/чем» всё равно режем снаружи.
 */
function shouldKeepTrailingQuestion(history, userMessage) {
  return needsReciprocalQuestion(history, userMessage);
}

/**
 * «Может вместе глянем?» без ссылки — пустое обещание, режем.
 * Если в ответе уже есть http(s) — не трогаем.
 */
function stripEmptyTogetherInvite(reply) {
  if (!reply) return reply;
  const text = String(reply);
  if (/https?:\/\//i.test(text) || /t\.me\//i.test(text)) return reply;
  let out = text
    .replace(/,?\s*может\s+вместе\s+глянем\??/gi, '')
    .replace(/,?\s*давай\s+вместе\s+(?:глянем|посмотрим)\??/gi, '')
    .replace(/,?\s*вместе\s+(?:глянем|посмотрим)(?:\s+на\s+платформ\w*)?\??/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([).!?,])/g, '$1')
    .trim();
  return out || reply;
}

/** Светлое время МСК (не ночной слот). */
function isDaylightMsk() {
  try {
    const { hour } = require('./timeStyle').getMoscowTimeParts();
    return hour >= 7 && hour < 22;
  } catch (_) {
    return true;
  }
}

const USER_SAYS_DAYTIME_RE =
  /(?:^|[^а-яёa-z0-9])(?:уже\s+утро|сейчас\s+утро|утром|уже\s+день|день\s+же|не\s+ночь|солнце(?:\s|$)|доброе\s+утро|день\s+добрый)/i;

const REPLY_NIGHT_CLAIM_RE =
  /ночь\s+же|уже\s+ночь|сейчас\s+ночь|спокойной(?:\s+ночи)?|доброй\s+ночи|споки|сладких\s+снов|пойду\s+спать|иду\s+спать/i;

/**
 * Запоздалый ответ на вчерашнее «спокойной» / утренний «ночь же» —
 * днём не прощаемся и не спорим, что сейчас ночь.
 */
function fixStaleNightTalk(reply, userMessage) {
  if (!reply || !isDaylightMsk()) return reply;
  const text = String(reply).trim();
  const user = String(userMessage || '');
  const userDay = USER_SAYS_DAYTIME_RE.test(user);

  // Целиком ночное прощание днём (часто ответ на вчерашний «доброй ночи»).
  if (
    /^(?:доброй|спокойной)(?:\s+ночи)?(?:\s*[,.]?\s*отдыхай)?\s*\)?$/i.test(text) ||
    /^(?:споки|сладких\s+снов)(?:\s*[,.]?\s*отдыхай)?\s*\)?$/i.test(text)
  ) {
    return ['ой я только глянула, уже день)', 'хах доброе) я ещё сонная', 'ой уже утро) привет'][
      Math.floor(Math.random() * 3)
    ];
  }

  if (!REPLY_NIGHT_CLAIM_RE.test(text) && !/отдыхай\)?\s*$/i.test(text)) return reply;

  // Он сказал «уже утро» — не оправдываем «ночь же» / «хорошего отдыха».
  if (userDay && REPLY_NIGHT_CLAIM_RE.test(text)) {
    return ['ой да, уже утро) торможу', 'хах точно, уже день)', 'ой блин да утро уже)'][
      Math.floor(Math.random() * 3)
    ];
  }

  // Днём вырезаем куски про «ночь же / спокойной», оставляем смысл если есть.
  if (REPLY_NIGHT_CLAIM_RE.test(text)) {
    let cleaned = text
      .replace(
        /(?:в\s+смысле\s+)?(?:хорошего\s+)?отдых\w*[,.]?\s*/gi,
        '',
      )
      .replace(/ночь\s+же(?:\s+уже)?[,.]?\s*/gi, '')
      .replace(/уже\s+ночь[,.]?\s*/gi, '')
      .replace(/сейчас\s+ночь[,.]?\s*/gi, '')
      .replace(/спокойной(?:\s+ночи)?[,.]?\s*/gi, '')
      .replace(/доброй\s+ночи[,.]?\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^\s*[,.;:\-–]+/, '')
      .trim();
    if (cleaned.length >= 8 && !REPLY_NIGHT_CLAIM_RE.test(cleaned)) {
      return /\)\s*$/.test(cleaned) ? cleaned : `${cleaned})`;
    }
    return ['ой я часы не глянула, уже день)', 'хах доброе)'][Math.floor(Math.random() * 2)];
  }
  return reply;
}

/**
 * Не поправлять сезон «от себя», если он не про сезон и сейчас другая пора года.
 * Общий принцип (не только «весна»), якорь — timeStyle.getSeasonInfo().
 */
function stripFalseSeasonCorrection(reply, userMessage) {
  if (!reply) return reply;
  const user = String(userMessage || '');
  const text = String(reply).trim();

  let season;
  try {
    season = require('./timeStyle').getSeasonInfo();
  } catch (_) {
    season = { id: 'autumn', nameRu: 'осень' };
  }
  const seasonRe = {
    winter: /(?:^|[^а-яёa-z0-9])зим/i,
    spring: /(?:^|[^а-яёa-z0-9])весн/i,
    summer: /(?:^|[^а-яёa-z0-9])лет[оа]/i,
    autumn: /(?:^|[^а-яёa-z0-9])осен/i,
  };
  const enRe = {
    winter: /\bwinter\b/i,
    spring: /\bspring\b/i,
    summer: /\bsummer\b/i,
    autumn: /\b(?:autumn|fall)\b/i,
  };
  // Он сам назвал текущий/любой сезон — не лезем.
  const userMentionsAnySeason =
    Object.values(seasonRe).some((re) => re.test(user)) ||
    Object.values(enRe).some((re) => re.test(user));
  if (userMentionsAnySeason) return reply;

  // Ответ поправляет сезон («какая весна, осень же») или называет НЕ текущий.
  const wrongIds = Object.keys(seasonRe).filter((id) => id !== season.id);
  const mentionsWrong = wrongIds.some((id) => seasonRe[id].test(text) || enRe[id].test(text));
  if (!mentionsWrong) return reply;

  const correctsSeason =
    /какая\s+(?:весн|зим|осен|лет)|не\s+(?:весн|зим|осен|лет)|а\s+не\s+(?:весн|зим|осен|лет)|(?:весн|зим|осен|лет)[а-яё]*,?\s*(?:осен|зим|весн|лет)/i.test(
      text,
    );

  if (correctsSeason && text.split(/\s+/).length <= 16) {
    if (USER_SAYS_DAYTIME_RE.test(user)) {
      return ['ой да, уже утро)', 'хах точно, день уже)', 'ага, утро)'][
        Math.floor(Math.random() * 3)
      ];
    }
    return ['ну ладно)', 'хм, поняла)', 'ага, ясно)'][Math.floor(Math.random() * 3)];
  }

  // Вырезаем чужие сезоны из ответа, оставляя смысл.
  let cleaned = text;
  for (const id of wrongIds) {
    cleaned = cleaned
      .replace(new RegExp(`хах,?\\s*какая\\s+${id === 'spring' ? 'весна' : id === 'winter' ? 'зима' : id === 'summer' ? 'лето' : 'осень'}[,.]?\\s*`, 'gi'), '')
      .replace(seasonRe[id], ' ')
      .replace(enRe[id], ' ');
  }
  cleaned = cleaned
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[,.;:\-–]+/, '')
    .trim();
  if (cleaned.length >= 8 && !wrongIds.some((id) => seasonRe[id].test(cleaned))) {
    return /\)\s*$/.test(cleaned) ? cleaned : `${cleaned})`;
  }
  if (USER_SAYS_DAYTIME_RE.test(user)) {
    return ['ой да, уже утро)', 'хах точно, день уже)'][Math.floor(Math.random() * 2)];
  }
  return cleaned.length >= 3 ? cleaned : reply;
}

/** Режет канцелярит / «режим ассистента», оставляя живой тон. */
function stripRoboticGirl(reply) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>]+>>\s*/) || [''])[0];
  let body = String(reply).slice(tag.length).trim();
  if (!body) return reply;
  const before = body;
  body = body
    .replace(
      /^(?:конечно(?:\s+же)?|разумеется|с\s+удовольствием|безусловно)[,!]?\s*/i,
      '',
    )
    .replace(/чем\s+могу\s+помочь[^.!?\n]*/gi, '')
    .replace(
      /я\s+(?:здесь|тут),?\s+чтобы[^.!?\n]*/gi,
      '',
    )
    .replace(
      /как\s+(?:искусственный\s+интеллект|нейросеть|ассистент)\b[^.!?\n]*/gi,
      '',
    )
    .replace(/\bдавайте\s+разберёмся\b/gi, 'хм')
    .replace(/\bв\s+любом\s+случае\b/gi, 'ну')
    .replace(/\bвс[её]\s+зависит\s+от\s+(?:восприятия|ситуации|тебя)\b/gi, '')
    .replace(/\bтакое\s+может\s+сильно\s+расстроить\b/gi, 'жесть')
    .replace(/\bоценить\s+ситуацию\s+на\s+месте\b/gi, '')
    .replace(/\bоста[её]тся\s+только\s+ждать\s+и\s+надеяться\b/gi, 'ну ждём)')
    .replace(/\bможно\s+попробовать\s+подумать\s+о\b/gi, 'можно подумать про')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[,.;:\-–]+/, '')
    .trim();
  if (!body || body.length < 3) {
    return (
      tag +
      ['ну ладно)', 'хм, ок)', 'поняла)'][Math.floor(Math.random() * 3)]
    );
  }
  if (body !== before && !/[)….!?]$/.test(body)) body += ')';
  return tag + body;
}

/** Финальный гейт: голые короткие ack не уходят в чат. */
function ensureAckNotBare(reply) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!body || body.includes('\n')) return reply;
  if (!BARE_ACK_RE.test(body)) return reply;
  const variants = [
    'ну ладно)',
    'хм, поняла)',
    'ага, ясно)',
    'ок, я тут)',
  ];
  return tag + variants[Math.floor(Math.random() * variants.length)];
}

function fixGluedParticles(reply) {
  if (!reply) return reply;
  // «да нетсейчас?» / «несейчас» — модель слипает частицы.
  return String(reply)
    .replace(/\b(да\s+)?нетсейчас\b/gi, (_, p) => `${p || ''}нет, сейчас`)
    .replace(/\bнесейчас\b/gi, 'не сейчас');
}

function applySoftLite(reply, history, userMessage) {
  if (!reply) return reply;
  let out = softenCoachy(reply);
  out = stripRoboticGirl(out);
  out = softCompleteCut(out);
  out = enrichBareAckOnSubstance(out, userMessage);
  out = stripEmptyTogetherInvite(out);
  out = fixStaleNightTalk(out, userMessage);
  out = stripFalseSeasonCorrection(out, userMessage);
  // Взаимный вопрос — только хинтом модели (buildThinHumanHint / softHint).
  // Не дописываем «а ты как день?» здесь: иначе перебиваем stripHabitualTrailingQuestion.
  out = stripQuestionAfterFarewell(out);
  out = fixStaleNightTalk(out, userMessage);
  out = stripQuestionAfterFarewell(out);
  out = fixGluedParticles(out);
  out = humanizeChatTexture(out);
  // Финальный гейт после всех правок — иначе season/robot снова вернут «ага)».
  out = ensureAckNotBare(out);
  return out;
}

module.exports = {
  softHint,
  isDatingSiteAsk,
  softenCoachy,
  softCompleteCut,
  enrichBareAckOnSubstance,
  ensureAckNotBare,
  fixGluedParticles,
  humanizeChatTexture,
  stripEmptyTogetherInvite,
  stripRoboticGirl,
  fixStaleNightTalk,
  stripFalseSeasonCorrection,
  applySoftLite,
  needsReciprocalQuestion,
  shouldKeepTrailingQuestion,
  ensureReciprocalQuestion,
  stripQuestionAfterFarewell,
  USER_CLOSING_RE,
};
