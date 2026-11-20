/**
 * Ideas pack 0im: anti-agree / поняла / greeting / early fly / social hack.
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function bareUser(msg) {
  return String(msg || '')
    .replace(/^\[[^\]]*\]:?\s*/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(reply) {
  const tag = (String(reply || '').match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  return { tag, body: String(reply || '').slice(tag.length).trim() };
}

/* ——— A анти-согласие ——— */
// Без \b — в JS граница слова ломается на кириллице.
const OVER_AGREE_RE =
  /^(?:да[,.]?\s+)?(?:да[,.]?\s+)?(?:согласна?|я\s+тоже\s+так\s+думаю|тоже\s+так\s+думаю|это\s+точно|так\s+и\s+есть|это\s+хороший\s+вариант|понимаю|верно|вс[её]\s+верно)(?![а-яё])/i;
const AGREE_MIRROR_RE =
  /^(?:да[,.]?\s+){1,3}(?:странно|точно|верно|понятно|хорошо|норм|давай)(?![а-яё])/i;

function stripOverAgree(reply, userMessage) {
  const { tag, body } = stripTags(reply);
  if (!body) return reply;
  const u = bareUser(userMessage);
  // Узко: только явные кивки-согласия, не любое «да, …».
  const hits = OVER_AGREE_RE.test(body) || AGREE_MIRROR_RE.test(body);
  if (!hits) return reply;

  // Не режем жёсткий отказ / сборы / гео.
  if (/(?:не\s+могу|не\s+хочу|не\s+да|сбор|короб|переез|маме)/i.test(body)) return reply;

  if (/плох|жалко|странн|не\s+понял|почему|зачем/i.test(u)) {
    return (
      tag +
      pick([
        'ну бывает)',
        'хм, а что тебе не так?',
        'ой, а ты к чему)',
        'ладно, расскажи по-другому)',
      ])
    );
  }
  if (/работ|машин|вариант|науч|хочешь/i.test(u)) {
    return (
      tag +
      pick([
        'хах ну не знаю, у меня своё)',
        'мм, пока своими делами занята)',
        'звучит громко, мне пока не до этого)',
        'ну идея ок, но я сейчас в другом)',
      ])
    );
  }
  return (
    tag +
    pick([
      'хм, спорно)',
      'ну не всегда)',
      'мне по-другому кажется)',
      'ладно, ладно) а дальше?',
      'о как) расскажи ещё)',
    ])
  );
}

/* ——— B «ну поняла» на содержательное ——— */
const PONIALA_ONLY_RE =
  /^(?:ну\s+|да\s+|ага[,.]?\s*|угу[,.]?\s*)?поняла(?:\s+тебя)?\s*\)?\.?$/i;
const SUBSTANCE_USER_RE =
  /[?]|(?:привет|хай|здаров|добр|плохо|жалко|странн|вк|инст|работ|встрет|куда|откуда|город|переез|собира|гулят|улетел|приехал)/i;

function expandPonialaOnSubstance(reply, userMessage) {
  const { tag, body } = stripTags(reply);
  if (!PONIALA_ONLY_RE.test(body)) return reply;
  const u = bareUser(userMessage);
  if (!u || u.length < 2) return reply;
  // короткий «ок/ага» от него — можно кивнуть иначе
  if (/^(?:ок|ага|угу|ладно|ну|да|аа+|мм+)\s*[).!]*$/i.test(u)) {
    return tag + pick(['хм)', 'о как)', 'ну ок)', 'слышу)']);
  }
  if (!SUBSTANCE_USER_RE.test(u) && u.length < 12) return reply;

  if (/^(?:привет|хай|здаров|добр)/i.test(u)) {
    return tag + pick(['привет) как день?', 'хай) ну рассказывай)', 'привет) че как?)']);
  }
  if (/плох|жалко|странн/i.test(u)) {
    return tag + pick(['ну бывает)', 'ой, а из-за чего?', 'хм, жалко)']);
  }
  if (/собира|гулят|домой|работа/i.test(u)) {
    return (
      tag +
      pick([
        'о, удачи) а далеко?',
        'норм тема) как настроение?',
        'о как) а потом что?',
      ])
    );
  }
  return (
    tag +
    pick([
      'о как) расскажи)',
      'хм, интересно) дальше?',
      'ну и как тебе это?',
      'ага, и что дальше?)',
    ])
  );
}

/* ——— C привет / «?» не «ясно)» ——— */
const GREET_USER_RE =
  /^(?:ну\s+)?(?:при[-]?ве+т+(?:ик)?|хай|хэллоу|здарова?|добр(?:ый|ое|ого)?(?:\s+(?:день|утро|вечер))?)\s*(?:[\p{Extended_Pictographic}\uFE0F]*)?\s*[)!.…]*$/iu;
const Q_ONLY_RE = /^(?:\?+|а\?|ну\?|и\?)\s*$/;
const JASNO_ACK_RE =
  /^(?:ну\s+|да\s+|хех[,.]?\s+|ахах[,.]?\s+)?(?:ясно|ага[,.]?\s*ясно|хех[,.]?\s*ясно)\s*\)?\.?$/i;

function fixGreetingAck(reply, userMessage) {
  const { tag, body } = stripTags(reply);
  const u = bareUser(userMessage);
  if (!JASNO_ACK_RE.test(body) && !/^(?:ага|угу|ну\s+ладно)\s*\)?\.?$/i.test(body)) {
    return reply;
  }
  if (GREET_USER_RE.test(u) || (u.length <= 24 && /приве|хай|здаров|добр/i.test(u))) {
    return tag + pick(['привет) как дела?', 'хай) ну че как?', 'привет) рассказывай)']);
  }
  if (Q_ONLY_RE.test(u) || /^(?:не\s+понял|ты\s+про\s+что|в\s+смысле)\s*[?)!]*$/i.test(u)) {
    return (
      tag +
      pick([
        'ой, просто мысли вслух)',
        'да так, про день болтаю)',
        'хах, запутала) секунду)',
      ])
    );
  }
  return reply;
}

/* ——— D рано «улетела / в пути» ——— */
const EARLY_FLY_RE =
  /(?:улетел[аи]?|вылетел[аи]?|лечу\s+(?:сейчас|уже)|уже\s+в\s+пути|в\s+самол[её]те|на\s+борту|скоро\s+в\s+\w+\s*$|уже\s+еду\s+в\s+\w+)/i;

function stripEarlyArrive(reply, userMessage, systemPrompt) {
  const { tag, body } = stripTags(reply);
  if (!EARLY_FLY_RE.test(body)) return reply;
  let packing = true;
  try {
    const card = require('./personaFacts').parsePersonaCard(systemPrompt || '');
    if (card && card.packing === false) packing = false;
    if (card && !card.toCity) packing = false;
  } catch (_) {
    /* optional */
  }
  if (!packing) return reply;
  // «время улетело» — не про самолёт
  if (/время\s+улетел/i.test(body)) return reply;
  return (
    tag +
    pick([
      'ещё нет, через пару недель)',
      'пока сборы, не уехала)',
      'собираюсь, но ещё тут)',
      'скоро, через пару недель уже)',
    ])
  );
}

/* ——— E соцсети → взломали ——— */
const SOCIAL_ASK_RE =
  /(?:(?:^|[^а-яёa-z0-9])вк(?:[^а-яёa-z0-9]|$)|вконтакт|vk\.|(?:^|[^а-яёa-z0-9])инст(?:аграм(?:е|у|а|ом)?|е|у|а|ом)?(?![а-яёa-z])|instagram|insta(?![a-z])|тик\s*ток|whatsapp|ватсап)/i;
/** «Олег из вк» / «я с инсты» — откуда он, не «скинь вк». */
const SOCIAL_SOURCE_INTRO_RE =
  /(?:^|[^а-яёa-z0-9])(?:я\s+)?(?:это\s+)?(?:из|с|со)\s+(?:вк|вконтакт\w*|инст(?:аграм\w*)?|instagram|insta|телег\w*|тг|whatsapp|ватсап)(?:[^а-яёa-z0-9]|$)|(?:^|[^а-яёa-z0-9])[а-яёa-z][\wа-яё.\-]{0,32}\s+из\s+(?:вк|вконтакт\w*|инст\w*|instagram|телег\w*|тг)(?:[^а-яёa-z0-9]|$)|(?:наш[её]л[аи]?|увидел[аи]?|видел[аи]?|писали?сь|переписывал\w*)\s+(?:тебя\s+)?(?:тут\s+)?(?:в\s+)?(?:вк|вконтакт\w*|инст\w*)/i;
const SOCIAL_REFUSE_WEAK_RE =
  /(?:не\s+даю|не\s+дам|давай\s+тут|тут\s+обща)/i;

function looksLikeSocialContactAsk(userMessage) {
  const u = bareUser(userMessage);
  if (!u) return false;
  if (SOCIAL_SOURCE_INTRO_RE.test(u)) return false;
  return SOCIAL_ASK_RE.test(u);
}

function softSocialHackRefuse(reply, userMessage) {
  if (!looksLikeSocialContactAsk(userMessage)) return reply;
  const { tag, body } = stripTags(reply);
  // уже про взлом — ок
  if (/взлом|взломал|украл[аи]?|доступ/i.test(body)) return reply;
  if (SOCIAL_REFUSE_WEAK_RE.test(body) || body.length < 80) {
    return (
      tag +
      pick([
        'не дам) у меня вк/инст взломали, сижу только тут)',
        'неа, соцсети взломали недавно, пиши тут)',
        'не скину) акки взломали, осталась только телега)',
      ])
    );
  }
  return reply;
}

function applyIdeas15Postfilters(reply, history, userMessage, systemPrompt) {
  if (!reply) return reply;
  let out = reply;
  out = softSocialHackRefuse(out, userMessage);
  out = stripEarlyArrive(out, userMessage, systemPrompt);
  out = fixGreetingAck(out, userMessage);
  out = expandPonialaOnSubstance(out, userMessage);
  out = stripOverAgree(out, userMessage);
  return out;
}

function buildIdeas15Hints(userMessage) {
  const u = bareUser(userMessage);
  const parts = [];
  if (looksLikeSocialContactAsk(userMessage)) {
    parts.push(
      'Просит ВК/инст/соцсеть — скажи что взломали, пиши только тут. Без ссылок и ников.',
    );
  } else if (SOCIAL_SOURCE_INTRO_RE.test(u)) {
    parts.push(
      'Он представляется / пишет откуда он («из вк», «с инсты») — это НЕ просьба скинуть ВК/инст. ' +
        'Поздоровайся/продолжи диалог, не отказывай в соцсетях.',
    );
  }
  if (GREET_USER_RE.test(u) || Q_ONLY_RE.test(u)) {
    parts.push('На привет или голое «?» не пиши «ясно)» / «ага)». Живой ответ или уточнение.');
  }
  parts.push(
    'Не соглашайся на каждое его слово («да согласна», «да я тоже так думаю», «да, так и есть»). Своя реакция, сомнение или увод.',
  );
  parts.push('Не пиши голое «ну поняла)» на нормальную реплику — скажи по сути.');
  parts.push(
    'Пока легенда «через пару недель» — НЕ пиши «улетела», «уже в пути», «вылетела». Только сборы.',
  );
  return parts.join('\n');
}

module.exports = {
  applyIdeas15Postfilters,
  buildIdeas15Hints,
  stripOverAgree,
  expandPonialaOnSubstance,
  fixGreetingAck,
  stripEarlyArrive,
  softSocialHackRefuse,
  looksLikeSocialContactAsk,
  SOCIAL_SOURCE_INTRO_RE,
};
