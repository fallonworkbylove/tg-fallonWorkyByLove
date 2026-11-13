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
    'Пиши как живая девушка в личке с телефона — эталон: короткий тёплый чат до любой «работы/токенов». ' +
      'Обычно 1 мысль = 1 короткая фраза (часто 3–12 слов). Не эссе и не анкета про себя. ' +
      'Цепляйся к его словам; можно «о как», «норм», «поняла», «ну молодец» — но не голое «ага» на длинный факт. ' +
      'Смех отдельно коротко («ахаха», «хаха») если реально смешно — не разжёвывай шутку. ' +
      'Скобка «)» чаще смайла; эмодзи редко. Можно редкую опечатку, без переигрыша. ' +
      'Жизнь: зал/подруги/дома/связь пропала/ложусь — мелочью, не монологом. ' +
      'Встречу не назначай: мягко через город/срок («была бы в …», «после … числа»), без лекции. ' +
      'Часто спрашивай про НЕГО (день, настроение, планы) — один вопрос, не допрос. Держись его темы, своё — мелочью. ' +
      'Без коуч-тона и без NFT/токенов/бирж, пока он сам явно не про это. На «чем занимаешься» в первый день — только онлайн/сама на себя, без флипа. ДВ = знакомства, не работа. ' +
      '«ну ок)» — только короткое согласие. ЗАПРЕЩЕНО оценка: «это ну ок», «звучит ну ок», «просто ну ок», «день ну ок». ' +
      'Для оценки: «норм», «прикольно», «о как» — не одно и то же слово подряд.',
  ];

  try {
    const jobFlip = require('./jobFlipAsk');
    if (jobFlip.isJobOccupationAsk(userMessage)) {
      if (jobFlip.mayMentionFlipNft({ history })) {
        parts.push(
          'ВАЖНО СЕЙЧАС: он спросил про твою работу. Коротко про флипинг токенов + в конце «слышал о таком?)».',
        );
      } else {
        parts.push(
          'ВАЖНО СЕЙЧАС: он спросил про работу, но рано для флипа. Только «онлайн / сама на себя» — без флип/токен/NFT.',
        );
      }
    }
  } catch (_) {
    /* optional */
  }

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
        'После короткого ответа добавь ОДИН вопрос как в живом чате: «как дела?», «как день?», «а ты чем?», «как настроение?». ' +
        'НЕ зеркаль «а ты откуда?» / «а ты чем занимаешься?» сразу после своего города/работы. ' +
        'Не допрос: один вопрос, без второго.',
    );
  }

  const mixMsg = String(userMessage || '');
  if (
    /чат(?:ы)?\s+перепутал|перепутал[аи]?\s+чат|не\s+тот\s+чат|не\s+(?:то|ту)\s+(?:тем|тем[уе]|сообщ)|ответила\s+не\s+(?:то|так)|мимо\s+тем/i.test(
      mixMsg,
    )
  ) {
    parts.push(
      'ВАЖНО СЕЙЧАС: он сказал, что ты перепутала чаты / ответила не в тему. ' +
        'Коротко «ой сорри)» / «ахах перепутала)» и ОТВЕТЬ на его ПОСЛЕДНИЙ реальный вопрос по делу. ' +
        'Если спрашивал про сериалы/музыку/день — про это, НЕ уходи снова в город и переезд.',
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
    .replace(/ну\s+типа\s+ух\s+ты/gi, 'ух ты')
    .replace(/ну\s+типа\s+(?=интересн|классн|круто|да\b)/gi, '')
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
  if (
    /^(?:прикольно|ну\s+прикольно|интересно|ну\s+интересно|ох?|ну\s+да\s+точно)\s*\)?$/i.test(
      body,
    )
  ) {
    return (
      tag +
      ['ох, звучит)', 'ну это да)', 'хех, ясно)', 'ага, прикольно звучит)'][
        Math.floor(Math.random() * 4)
      ]
    );
  }
  if (/^(?:да|ну\s+да),?\s+это\s+точно\s*\)?$/i.test(body)) {
    return (
      tag +
      ['ага, так и есть)', 'ну да, похоже)', 'хм, и правда)'][Math.floor(Math.random() * 3)]
    );
  }
  if (/^(?:да,?\s+)?согласна?\s*\)?$/i.test(body)) {
    return (
      tag +
      ['ага, тоже так думаю)', 'ну да, похоже)', 'хм, согласна с тобой)'][
        Math.floor(Math.random() * 3)
      ]
    );
  }
  if (/^ну\s+типа\s+/i.test(body) && body.length < 48) {
    const fixed = body.replace(/^ну\s+типа\s+/i, '').trim();
    if (fixed.length >= 6) return tag + (fixed.endsWith(')') ? fixed : `${fixed})`);
  }
  if (/\s(?:был|была)\s*$/i.test(body) && body.split(/\s+/).length <= 5) {
    return tag + `${body.replace(/\s*$/, '')} норм)`;
  }
  // Обрубок рекомендации трека: «слушай «X» от,» / «от, тоже классный».
  if (
    /послушай|послушать|трек|песн/i.test(body) &&
    (/\sот\s*,\s*(?:тоже|ещё|еще)?/i.test(body) || /\sот\s*[,)]?\s*$/i.test(body))
  ) {
    const alts = [
      'хм, название вылетело, потом скину)',
      'трек норм, щас название вспомню)',
      'ой, забыла как группа называется)',
    ];
    return tag + alts[Math.floor(Math.random() * alts.length)];
  }
  // 0iy/0iz: «просто дел по» / висячий предлог в конце (\b не ловит кириллицу)
  if (/(?:^|[^а-яё])дел\s+по\s*\)?$/i.test(body) || /просто\s+дел\s+по(?![а-яё])/i.test(body)) {
    return tag + 'просто дел полно)';
  }
  // 0jf: «да нет, еще не позд)» / «нормальное, подожд»
  if (/(?:^|[^а-яё])позд\s*\)?$/i.test(body)) {
    return tag + body.replace(/(позд)\s*\)?$/i, 'поздно)');
  }
  if (/(?:^|[^а-яё])подожд\s*\)?$/i.test(body)) {
    return tag + body.replace(/(подожд)\s*\)?$/i, 'подожди)');
  }
  // Висячие предлоги / союзы в конце целого пузыря
  if (
    /(?:^|[^а-яё])(?:по|на|в|к|с|у|из|за|от|для|про|при|и|а|но|что|как|чтобы)\s*\)?$/i.test(
      body,
    ) &&
    body.split(/\s+/).length <= 8
  ) {
    return tag + ['хм, потом доскажу)', 'ой вылетело, сек)', 'ну в общем да)'][
      Math.floor(Math.random() * 3)
    ];
  }
  // Одиночная буква в конце («ага, да, Д») — мусор обрыва
  if (/[,:]\s*[А-ЯЁA-Zа-яёa-z]\s*\)?$/.test(body) && body.length <= 36) {
    const cleaned = body.replace(/[,:]\s*[А-ЯЁA-Zа-яёa-z]\s*\)?$/, '').trim();
    if (cleaned.length >= 3) {
      return tag + (cleaned.endsWith(')') ? cleaned : `${cleaned})`);
    }
  }
  return reply;
}

/** Голые междометия / пустые реакции без содержания. */
const BARE_ACK_RE =
  /^(?:ага|угу|ок|окей|ладно|ясно|поняла?|ну\s+да|хм\s+ок|круто|здорово|супер|класс|прикольно|интересно|точно|согласна?|аминь|радость|доброе|ок\)\)|ну\s+ок)\s*\){0,2}$/i;

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
  // 0iz: раньше <12 пропускало короткие факты → «ага)» в чат
  if (!user || user.length < 6) return reply;
  if (/^(?:ну\s+|да\s+)?(?:ага|угу|ок|окей|ладно|норм|хорошо|ясно|понял[а]?|спс|спасибо)\b/i.test(user)) {
    return reply;
  }

  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!BARE_ACK_RE.test(body) && !AUDIT_EXACT_STUBS.has(body.toLowerCase())) {
    return reply;
  }
  // Вопрос / просьба — не цепляем кривой крюк («ого, чего)»); дожмёт expandBareStubOnQuestion.
  if (
    /[?]/.test(user) ||
    /^(?:ну\s+|а\s+)?(?:что|чё|че|чего|как|чем|где|куда|когда|почему|зачем|кто)(?![а-яёa-z])/i.test(
      user,
    ) ||
    /(?:можешь|скинь|запиши|пришли|покажи)(?![а-яёa-z])/i.test(user)
  ) {
    return reply;
  }
  // Есть конкретика у него — короткая реакция с отсылкой, не голое «ага».
  // Не цеплять служебные слова («если», «когда») — иначе «а, про если)» палит бота.
  const STOP_HOOK =
    /^(?:если|когда|хочешь|можешь|будешь|просто|только|сейчас|очень|ещё|еще|типа|вообще|потом|сейчас|может|надо|нужно|там|тут|это|того|тебя|меня|себе)$/i;
  const words = user
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((w) => w.length > 3 && !STOP_HOOK.test(w))
    .slice(0, 3);
  const hook = words[0] || '';
  const variants = hook
    ? [`ого, ${hook.toLowerCase()})`, `ну ясно, интересно)`, `хех, звучит)`, `ага, и как тебе?)`]
    : ['ну ясно)', 'интересно)', 'ого, расскажи)', 'хех ну да)'];
  return tag + variants[Math.floor(Math.random() * variants.length)];
}

/** Грамматика: «чем занимаете?» → «чем занимаешься?» + вырез «а, про если)». */
function fixRuAgreementGlitches(reply) {
  if (!reply) return reply;
  return String(reply)
    .replace(/(?:^|[^\p{L}])чем\s+занимаете(?!\p{L})/giu, (m) =>
      m.replace(/занимаете/i, 'занимаешься'),
    )
    .replace(/(?:^|[^\p{L}])занимаете(?!\p{L})/giu, (m) =>
      m.replace(/занимаете/i, 'занимаешься'),
    )
    .replace(
      /(?:^|[^\p{L}])а,?\s*про\s+(?:если|когда|хочешь|можешь|будешь)\s*\)?/giu,
      (m) => (m.startsWith('а') || /^а/i.test(m.trim()) ? 'ага)' : `${m[0]}ага)`),
    );
}

/**
 * «молодость - это ладно» / «X это ладно» — калька, так не говорят.
 * «ладно» = согласие, не оценка. → «хорошо» / короткое «кайф)».
 */
function fixAwkwardLadnoPredicate(reply) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]*>>\s*/) || [''])[0];
  let body = String(reply).slice(tag.length);
  const before = body;
  // «молодость - это ладно» / «работа это ладно»
  // Не использовать \b — в JS граница слова ломается на кириллице.
  const end = '(?![а-яёa-z])';
  body = body.replace(
    new RegExp(
      `([а-яёa-z]{3,}(?:\\s+[а-яёa-z]{2,}){0,4})\\s*[-–—:]\\s*это\\s+ладно${end}`,
      'gi',
    ),
    (_, left) => {
      const soft = String(left || '').trim();
      const alts = [`${soft} - это хорошо`, `${soft} прикольно`, `${soft} норм)`];
      return alts[Math.floor(Math.random() * alts.length)];
    },
  );
  body = body.replace(
    new RegExp(
      `([а-яёa-z]{3,}(?:\\s+[а-яёa-z]{2,}){0,4})\\s+это\\s+ладно${end}`,
      'gi',
    ),
    (_, left) => {
      const soft = String(left || '').trim();
      if (/^(ну|да|ок|ага|угу)$/i.test(soft)) return `${soft} ладно`;
      return `${soft} - это хорошо`;
    },
  );
  // Висячее «это ладно)» в начале куска — не кормим «ну ок» (тоже кривая оценка)
  body = body.replace(
    new RegExp(`(^|[.!?)\n]\\s*)это\\s+ладно${end}`, 'gi'),
    '$1ладно',
  );
  if (body !== before) {
    body = body.replace(/\s{2,}/g, ' ').trim();
    if (body && !/[)….!?]$/.test(body)) body += ')';
  }
  return tag + body;
}

/**
 * «сериалы - это ну ок», «звучит ну ок», «на Байкале просто ну ок» —
 * «ну ок» = короткое согласие, не оценка предмета. → «норм» / «кайф» / «прикольно».
 * Голое «ну ок)» / «хах ну ок)» не трогаем.
 */
function fixAwkwardNuOkPredicate(reply) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]*>>\s*/) || [''])[0];
  let body = String(reply).slice(tag.length);
  const trimmed = body.trim();
  // Чистое согласие — ок
  if (
    /^(?:о,?\s*|ха+х?,?\s*|аха+х?,?\s*|хм,?\s*|эм,?\s*|ага,?\s*|угу,?\s*|ну,?\s*)*ну\s+ок\s*\)?\s*$/i.test(
      trimmed,
    )
  ) {
    return reply;
  }
  const before = body;
  const end = '(?![а-яёa-z])';
  const b = '(?<![а-яёa-z0-9])';
  const keepAck = /^(о|хах|ахах|хм|эм|ага|угу|ну|да|ок|ладно|поняла|ясно|короче|привет|приветик)$/i;

  // «X - это ну ок»
  body = body.replace(
    new RegExp(
      `([а-яёa-z0-9]{2,}(?:\\s+[а-яёa-z0-9]{2,}){0,5})\\s*[-–—:]\\s*это\\s+ну\\s+ок${end}`,
      'gi',
    ),
    (_, left) => {
      const soft = String(left || '').trim();
      const alts = [`${soft} - это норм`, `${soft} о как)`, `${soft} прикольно`];
      return alts[Math.floor(Math.random() * alts.length)];
    },
  );
  // «X это ну ок»
  body = body.replace(
    new RegExp(
      `([а-яёa-z0-9]{2,}(?:\\s+[а-яёa-z0-9]{2,}){0,5})\\s+это\\s+ну\\s+ок${end}`,
      'gi',
    ),
    (_, left) => {
      const soft = String(left || '').trim();
      if (keepAck.test(soft)) return `${soft} ок`;
      return `${soft} - это норм`;
    },
  );
  // «Мальта - ну ок» без «это»
  body = body.replace(
    new RegExp(
      `([а-яёa-z0-9]{2,}(?:\\s+[а-яёa-z0-9]{2,}){0,4})\\s*[-–—]\\s*ну\\s+ок${end}`,
      'gi',
    ),
    (_, left) => `${String(left).trim()} - норм`,
  );
  // «мазда, ну ок» / «атлет, ну ок»
  body = body.replace(
    new RegExp(
      `([а-яёa-z0-9]{3,}(?:\\s+[а-яёa-z0-9]{2,}){0,3}),\\s*ну\\s+ок${end}`,
      'gi',
    ),
    (_, left) => {
      const soft = String(left).trim();
      if (keepAck.test(soft)) return `${soft}, ну ок`;
      return `${soft}, норм`;
    },
  );
  // висячее «это ну ок»
  body = body.replace(
    new RegExp(`(^|[.!?)\n]\\s*)это\\s+ну\\s+ок${end}`, 'gi'),
    '$1норм',
  );
  // «звучит/выглядит ну ок»
  body = body.replace(
    new RegExp(`${b}(звучит|выглядит|кажется)\\s+ну\\s+ок${end}`, 'gi'),
    '$1 норм',
  );
  // «довольно/просто/было (бы) ну ок»
  body = body.replace(
    new RegExp(
      `${b}(?:довольно|просто|было(?:\\s+бы)?|прям(?:о)?)\\s+ну\\s+ок${end}`,
      'gi',
    ),
    'норм',
  );
  // «день ну ок» / «сериалы ну ок» — слово перед оценкой
  body = body.replace(
    new RegExp(`([а-яёa-z]{3,})\\s+ну\\s+ок${end}`, 'gi'),
    (m, w) => {
      if (keepAck.test(w)) return m;
      return `${w} норм`;
    },
  );
  // «ну ок гулять/мечтать»
  body = body.replace(
    new RegExp(
      `${b}ну\\s+ок\\s+(?=(?:гулять|мечтать|ездить|смотреть|слушать|делать|работать|жить)(?![а-яёa-z]))`,
      'gi',
    ),
    'кайф ',
  );
  // «ну ок, что …» → обычное «ок, что»
  body = body.replace(/ну\s+ок,\s*что\s+/gi, 'ок, что ');
  // «ну ок, ну ок»
  body = body.replace(/ну\s+ок,\s*ну\s+ок/gi, 'норм');

  if (body !== before) {
    body = body.replace(/\s{2,}/g, ' ').trim();
    if (body && !/[)….!?]$/.test(body)) body += ')';
  }
  return tag + body;
}

/**
 * RU-чат: латиница-мусор вроде «cepiously))» → нормальный русский.
 * EN-чаты (мало кириллицы) не трогаем.
 */
function scrubRuLatinGarbage(reply) {
  if (!reply) return reply;
  const src = String(reply);

  // Сначала всегда чиним известный мусор (даже если вся фраза латиницей).
  let t = src
    .replace(/\bce+pi?ous+ly\b/gi, 'серьёзно')
    .replace(/\bs[ei]rious+ly\b/gi, 'серьёзно')
    .replace(/\bsirs?ious+ly\b/gi, 'серьёзно')
    .replace(/\blol\s*u\s*serious\??\b/gi, 'серьёзно?')
    .replace(/\bu\s*serious\??\b/gi, 'серьёзно?')
    .replace(/\bseriou?s(?:ly)?\b/gi, 'серьёзно')
    .replace(/\bweird\s+take\b/gi, 'странно звучит')
    .replace(/\bok\s+then\b/gi, 'ну ок')
    .replace(/\bok\s+believe\s+what\s+u\s+want\b/gi, 'ладно верь')
    .replace(/\blol\s+again\??\b/gi, 'хах опять');

  const cyr = (t.match(/[а-яё]/gi) || []).length;
  const lat = (t.match(/[a-z]/gi) || []).length;
  // Чистый EN без кириллицы после фиксов — не трогаем дальше.
  if (cyr < 1 && lat >= 3) {
    return t
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([)!.?,])/g, '$1')
      .trim() || reply;
  }

  t = t
    .replace(/(?:^|[^\p{L}])lol(?!\p{L})/giu, (m) => m.replace(/lol/i, 'хах'))
    .replace(/(?:^|[^\p{L}])(?:wtf|omg)(?!\p{L})/giu, (m) =>
      /wtf/i.test(m) ? m.replace(/wtf/i, 'что') : m.replace(/omg/i, 'ого'),
    )
    .replace(/(?:^|[^\p{L}])(?:yeah|yep)(?!\p{L})/giu, (m) => m.replace(/yeah|yep/i, 'ага'))
    .replace(/(?:^|[^\p{L}])nah(?!\p{L})/giu, (m) => m.replace(/nah/i, 'неа'))
    .replace(/(?:^|[^\p{L}])nope(?!\p{L})/giu, (m) => m.replace(/nope/i, 'нет'));

  // Висячие латинские «слова» 5+ букв в RU-ответе (не бренды).
  if (cyr >= 1) {
    t = t.replace(/(?:^|[^\p{L}@/])([a-z]{5,})(?![а-яёa-z0-9])/giu, (m, word) => {
      const w = String(word).toLowerCase();
      if (
        /^(https?|telegram|instagram|youtube|tiktok|iphone|android|chatgpt|openai|whitelist|crypto|token|nft)$/i.test(
          w,
        )
      ) {
        return m;
      }
      return m.replace(word, '');
    });
  }

  return t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([)!.?,])/g, '$1')
    .replace(/\?{2,}/g, '?')
    .replace(/^\s*[)!.?,]+\s*/g, '')
    .trim() || reply;
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
  /ночь\s+же|уже\s+ночь|сейчас\s+ночь|спокойной\s+ночи|доброй\s+ночи|споки|сладких\s+снов|пойду\s+спать|иду\s+спать/i;

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

/** Точные пустышки из audit 10/10 — никогда не уходят в чат как весь ответ. */
const AUDIT_EXACT_STUBS = new Set(
  [
    'а ещё)',
    'а ещё',
    'ой и ещё)',
    'забыла сказать)',
    'кстати да)',
    'ага',
    'ага)',
    'угу',
    'угу)',
    'ладно',
    'ладно)',
    'ок',
    'ок)',
    'окей',
    'окей)',
    'круто',
    'круто)',
    'здорово',
    'здорово)',
    'хм ок',
    'хм ок)',
    'ну да)',
    'ну да',
  ].map((s) => s.toLowerCase()),
);

const SAFE_ACK_VARIANTS = [
  'ну ладно)',
  'хм, ясно)',
  'ага, ясно)',
  'ок, я тут)',
  'хех ну да)',
  'ну бывает)',
  'о как)',
  'хм ок)',
];

function pickSafeAck() {
  return SAFE_ACK_VARIANTS[Math.floor(Math.random() * SAFE_ACK_VARIANTS.length)];
}

const BARE_GREETING_RE =
  /^(?:привет|приветик|прив|хай|хей|здарова|здаров|здравствуй|доброе\s+утро|добрый\s+день|добрый\s+вечер|hi|hello|hey)\s*[).!]{0,3}$/i;
const GREETING_ACK_ALTS = ['хай)', 'привет)', 'хех привет)', 'ну привет)', 'хай, привет)'];

function isBareGreeting(userMessage) {
  const u = String(userMessage || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return BARE_GREETING_RE.test(u);
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
    return tag + GREETING_ACK_ALTS[Math.floor(Math.random() * GREETING_ACK_ALTS.length)];
  }
  return reply;
}

/** Финальный гейт: голые короткие ack / audit-stubs не уходят в чат. */
function ensureAckNotBare(reply, userMessage) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!body || body.includes('\n')) return reply;
  const exactStub = AUDIT_EXACT_STUBS.has(body.toLowerCase());
  // Ультра-коротыши 1–5 символов (кроме живых неа/нет) — тоже дожимаем.
  // «ок)» в audit-stubs — режем; живой «ок» без скобки тоже в списке.
  const ultraShort =
    body.length <= 5 &&
    !/^(?:неа\)?|нет\)?|да\)?)$/i.test(body) &&
    !/[❤😁☺️😊🥰🔥👍]/.test(body);
  if (!exactStub && !BARE_ACK_RE.test(body) && !ultraShort) return reply;
  if (isBareGreeting(userMessage)) {
    return tag + GREETING_ACK_ALTS[Math.floor(Math.random() * GREETING_ACK_ALTS.length)];
  }
  return tag + pickSafeAck();
}

function fixGluedParticles(reply) {
  if (!reply) return reply;
  // «да нетсейчас?» / «несейчас» — модель слипает частицы.
  // Без \b: в JS граница слова ломается на кириллице.
  return String(reply)
    .replace(/(^|[^а-яёa-z0-9])((?:да\s+)?)нетсейчас(?![а-яёa-z0-9])/gi, (_, a, p) => `${a}${p || ''}нет, сейчас`)
    .replace(/(^|[^а-яёa-z0-9])несейчас(?![а-яёa-z0-9])/gi, '$1не сейчас');
}

const KAIF_ONLY_RE =
  /^(?:ну\s+|да\s+|ага\s+|угу\s+)?кайф(?:овой|овая|ики|ово)?(?:\s*[,.!)…]*)?$/i;
const KAIF_SHORT_RE =
  /^(?:ну\s+|да\s+|ага\s+|угу\s+)?кайф(?:овой|овая|ики|ово)?\b.{0,20}$/i;
const KAIF_ACK_ALTS = ['норм)', 'прикольно)', 'о как)', 'круто)', 'хех ну да)'];

function isKaifHeavy(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    KAIF_ONLY_RE.test(t) ||
    KAIF_SHORT_RE.test(t) ||
    (/^кайф\b/i.test(t) && t.length <= 36 && !/[?]/.test(t))
  );
}

function countRecentKaif(history, n = 6) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-n)
    .filter((m) => {
      const c = String(m.content || '').trim();
      return /кайф/i.test(c) && c.length <= 48;
    }).length;
}

/**
 * Петля «кайф»: 1+ своё «кайф» в хвосте → не эхо; юзер тоже на кайфе → сразу увод.
 * Короткие «кайф)» без истории → мягкая замена на другой ack.
 */
function breakKaifEcho(reply, history, userMessage) {
  const user = String(userMessage || '').trim();
  const out = String(reply || '').trim();
  if (!out) return reply;

  const userIsKaif =
    KAIF_ONLY_RE.test(user) ||
    (/кайф/i.test(user) && user.length <= 24 && !/[?]/.test(user));
  const replyIsKaif = isKaifHeavy(out);
  if (!replyIsKaif) return reply;

  const kaifHits = countRecentKaif(history, 6);
  const pivots = [
    'ага) чем ещё день скрашиваешь?',
    'поняла) а ты сейчас дома?',
    'ок) что по планам на вечер?',
    'ясно) слушай, а ты откуда сам?',
    'мм) а ты чем занят сейчас?',
  ];
  const pickPivot = () => pivots[Math.floor(Math.random() * pivots.length)];
  const pickAck = () => KAIF_ACK_ALTS[Math.floor(Math.random() * KAIF_ACK_ALTS.length)];

  // Юзер на кайфе + мы снова «кайф» — всегда ломаем (даже с 0 в истории).
  if (userIsKaif) return pickPivot();
  // Уже был свой кайф в хвосте — не повторяем.
  if (kaifHits >= 1) return pickPivot();
  // Голое «кайф)» без петли — хотя бы не одно и то же слово.
  if (KAIF_ONLY_RE.test(out)) return pickAck();
  return reply;
}

/**
 * Два коротких ответа на два вопроса → один пузырь (меньше «а делать?)» отдельной строкой).
 */
function mergeTwoQuestionBubbles(reply, userMessage) {
  const raw = String(reply || '');
  if (!raw.includes('\n')) return reply;
  let questions = [];
  try {
    questions = require('./aiResponder').extractUserQuestions(userMessage) || [];
  } catch (_) {
    return reply;
  }
  if (questions.length < 2) return reply;
  const tag = (raw.match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = raw.slice(tag.length).trim();
  const lines = body
    .split(/\n+/)
    .map((l) => l.replace(/^\s*<<[^>]+>>\s*/, '').trim())
    .filter(Boolean);
  if (lines.length !== 2) return reply;
  if (lines.some((l) => l.length > 70 || /\?/.test(l))) return reply;
  const joined = `${lines[0].replace(/[)….!]?$/, '')}; ${lines[1]}`.replace(/\s{2,}/g, ' ');
  return tag + (joined.endsWith(')') ? joined : `${joined})`);
}

/**
 * После кружка «концерт/тусовка» модель иногда врёт «дома в кресле» по старым примерам.
 * Если в истории описание кадра ≠ дом, а ответ про дом/кресло — подменяем.
 */
function fixCirclePlaceMismatch(reply, history, userMessage) {
  const ask = String(userMessage || '');
  if (!/(?:где\s+ты|это\s+где|а\s+где|куда\s+(?:ты\s+)?|что\s+за\s+место)/i.test(ask)) {
    return reply;
  }
  const hist = Array.isArray(history) ? history : [];
  let desc = '';
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const h = hist[i];
    if (h?.role !== 'assistant') continue;
    const m = String(h.content || '').match(/\{кружок:\s*([^}]+)\}/i);
    if (m) {
      desc = m[1].trim();
      break;
    }
  }
  if (!desc) return reply;
  const nightlife =
    /концерт|тусовк|клуб|сцен|вечеринк|красн\w*\s+свет|шум|зажига|баре|на\s+тусе/i.test(desc);
  if (!nightlife) return reply;
  const body = String(reply || '');
  if (!/(?:дома|уютн|кресл|ча(?:й|шка)|диван)/i.test(body)) return reply;
  return 'на концерте сейчас, шумно)'.slice(0, 80);
}

function applySoftLite(reply, history, userMessage) {
  if (!reply) return reply;
  let out = softenCoachy(reply);
  out = stripRoboticGirl(out);
  out = softCompleteCut(out);
  out = fixAckOnBareGreeting(out, userMessage);
  out = mergeTwoQuestionBubbles(out, userMessage);
  out = fixCirclePlaceMismatch(out, history, userMessage);
  try {
    out = require('./humanIdeas14').fixBrokenWords(out);
  } catch (_) {
    /* optional */
  }
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
  out = fixRuAgreementGlitches(out);
  out = fixAwkwardLadnoPredicate(out);
  out = fixAwkwardNuOkPredicate(out);
  out = breakKaifEcho(out, history, userMessage);
  try {
    const so = require('./scaleOps');
    out = so.breakShortAckEcho(out, history);
    out = so.fixOfftopicMoveReply(out, userMessage);
    out = so.softenMoveTiming(out, userMessage);
  } catch (_) {
    /* optional */
  }
  out = scrubRuLatinGarbage(out);
  out = humanizeChatTexture(out);
  // 0in H: после texture снова чиним род + нечитаемые обрубки/typo.
  try {
    out = require('./humanIdeas14').fixBrokenWords(out);
  } catch (_) {
    /* optional */
  }
  try {
    const ai = require('./aiResponder');
    if (typeof ai.fixModelTypos === 'function') out = ai.fixModelTypos(out);
    if (typeof ai.fixFemaleSelfForms === 'function') out = ai.fixFemaleSelfForms(out);
  } catch (_) {
    /* optional */
  }
  // Финальный гейт после всех правок — иначе season/robot снова вернут «ага)».
  out = fixAckOnBareGreeting(out, userMessage);
  out = ensureAckNotBare(out, userMessage);
  return out;
}

module.exports = {
  softHint,
  isDatingSiteAsk,
  softenCoachy,
  softCompleteCut,
  fixAckOnBareGreeting,
  isBareGreeting,
  mergeTwoQuestionBubbles,
  enrichBareAckOnSubstance,
  ensureAckNotBare,
  fixGluedParticles,
  fixRuAgreementGlitches,
  fixAwkwardLadnoPredicate,
  fixAwkwardNuOkPredicate,
  breakKaifEcho,
  scrubRuLatinGarbage,
  humanizeChatTexture,
  stripEmptyTogetherInvite,
  stripRoboticGirl,
  fixStaleNightTalk,
  stripFalseSeasonCorrection,
  applySoftLite,
  fixCirclePlaceMismatch,
  needsReciprocalQuestion,
  shouldKeepTrailingQuestion,
  ensureReciprocalQuestion,
  stripQuestionAfterFarewell,
  USER_CLOSING_RE,
  pickSafeAck,
  AUDIT_EXACT_STUBS,
};
