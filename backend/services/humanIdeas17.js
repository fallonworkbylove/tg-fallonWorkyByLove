/**
 * humanIdeas17 (0jf) — живые фиксы со скринов:
 * обрубки, Радужный≠радуга, «ты дома?», робот/скрипт,
 * отказ+медиа, мягкое «погуляем как буду», 18+ нейтраль, тонкий слой личности.
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

/* ——— обрубки / опечатки ——— */
const WORD_FIXES_17 = [
  [/(?<![а-яё])позд(?![а-яён])/gi, 'поздно'],
  [/(?<![а-яё])подожд(?![а-яё])/gi, 'подожди'],
  [/(?<![а-яё])яркш(?![а-яё])/gi, 'ярких'],
  [/ыитоняшк\w*/gi, 'фитоняшка'],
  [/Непонел/gi, 'Не понял'],
  [/непонел/gi, 'не понял'],
  [/Влад\s+слабы/gi, 'Влад)'],
  [/А\s+в\s+почему/gi, 'А почему'],
];

const STUMP_HEAL_17 = {
  позд: 'поздно',
  подожд: 'подожди',
  яркш: 'ярких',
  поддержк: 'поддержка',
  нормальн: 'нормально',
};

const STUMP_TAIL_RE =
  /(?<![а-яё])([а-яё]{3,14}[бвгджзклмнпрстфхцчшщ])(?=[)\s]*[).!?]|$)/gi;

function fixWordStumps17(reply) {
  let out = String(reply || '');
  if (!out) return reply;
  for (const [re, to] of WORD_FIXES_17) {
    re.lastIndex = 0;
    if (re.test(out)) {
      re.lastIndex = 0;
      out = out.replace(re, to);
    }
  }
  out = out.replace(STUMP_TAIL_RE, (m, stem) => {
    const low = String(stem || '').toLowerCase();
    if (STUMP_HEAL_17[low]) {
      const fix = STUMP_HEAL_17[low];
      return stem[0] === stem[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
    }
    return m;
  });
  return out;
}

/* ——— Радужный = город, не радуга ——— */
const RAINBOW_WEATHER_RE =
  /(?:радуг[ауие]|с\s+радуг|фото\s+радуг|слабость\s*[—-]?\s*радуг|обожа\w*\s+радуг|люблю\s+радуг)/i;
const RADUZHNY_CITY_RE = /радужн\w*/i;

function cityIsRaduzhny(systemPrompt) {
  try {
    const card = require('./personaFacts').parsePersonaCard(systemPrompt || '');
    return (
      RADUZHNY_CITY_RE.test(String(card?.toCity || '')) ||
      RADUZHNY_CITY_RE.test(String(card?.fromCity || ''))
    );
  } catch (_) {
    return /радужн/i.test(String(systemPrompt || ''));
  }
}

function stripRainbowCityConfusion(reply, userMessage, systemPrompt) {
  const u = bare(userMessage);
  const cityCtx =
    cityIsRaduzhny(systemPrompt) ||
    (RADUZHNY_CITY_RE.test(u) && !/радуг[ауие]/i.test(u));
  if (!cityCtx) return reply;
  const { tag, body } = stripTags(reply);
  if (!RAINBOW_WEATHER_RE.test(body)) return reply;
  // Он про город Радужный — не уходи в «радуга в небе».
  return (
    tag +
    pick([
      'ага, Радужный — город такой, в ХМАО)',
      'ну да, Радужный) туда к маме',
      'хах да город Радужный, не про радугу)',
      'в Радужный переезжаю, да)',
    ])
  );
}

function raduzhnyHint(userMessage, systemPrompt) {
  const u = bare(userMessage);
  if (!cityIsRaduzhny(systemPrompt) && !RADUZHNY_CITY_RE.test(u)) return null;
  if (/радуг[ауие]/i.test(u) && !RADUZHNY_CITY_RE.test(u)) return null;
  return (
    'Радужный — это ГОРОД (ХМАО), не радуга в небе. ' +
    'Не пиши про «обожаю радугу / слабость радуга». Если шутит про совпадение — коротко: «хах да город такой)».'
  );
}

/* ——— «ты дома?» ——— */
const HOME_ASK_RE =
  /(?:^|[^а-яё])(?:ты\s+)?(?:сейчас\s+|щас\s+)?дома\s*\??|(?:^|[^а-яё])дома\s+ли\b|ты\s+дома|дома\s*\?/i;
const HOME_ANSWER_RE =
  /(?:^|[^а-яё])(?:дома|домашн|у\s+себя|на\s+диване|в\s+квартир|сижу\s+дома|дома\s+сиж)/i;
const OFFTOPIC_HOME_RE =
  /(?:кофе|сериал|обычн(?:ый)?\s+день|рилс|как\s+дела|ничего\s+особен)/i;

const HOME_ALTS = [
  'ага, дома)',
  'да, дома сижу)',
  'дома)',
  'угу, дома сейчас)',
];

function fixHomeAsk(reply, userMessage) {
  const u = bare(userMessage);
  if (!HOME_ASK_RE.test(u)) return reply;
  const { tag, body } = stripTags(reply);
  if (HOME_ANSWER_RE.test(body)) return reply;
  if (OFFTOPIC_HOME_RE.test(body) || body.length < 40) {
    return tag + pick(HOME_ALTS);
  }
  return reply;
}

function homeAskHint(userMessage) {
  if (!HOME_ASK_RE.test(bare(userMessage))) return null;
  return (
    'Спросил «дома ли / ты дома?» — ответь ПРЯМО: да/нет дома (или «выехала»). ' +
    'Не уходи в «обычный день / кофе / сериал» вместо ответа.'
  );
}

/* ——— робот / скрипт — не соглашаться ——— */
const BOT_ACCUSE_RE =
  /(?:ты\s+(?:робот|бот)|это\s+(?:робот|бот)|с\s+роботом|как\s+робот|нейросет|chatgpt|скрипт|точно\s+реальн)/i;
const BOT_ADMIT_RE =
  /(?:^|[^а-яё])(?:ну\s+да|да|ага|угу|бывает|как-то\s+так|автоматизированн|скрипт\s*[-—:]\s*это)/i;
const BOT_LEAK_RE =
  /обычн\w*\s+бот|бот\s+в\s+телег|я\s+(?:же\s+)?(?:бот|робот|нейросет)|да[,]?\s*я\s+бот|просто\s+бот/i;

const BOT_DENY_ALTS = [
  'хах ну ты чего)',
  'смешно) я тут живая',
  'ага, живые тоже так пишут)',
  'не, просто коротко пишу)',
];

function denyBotOrScriptAdmit(reply, userMessage) {
  const u = bare(userMessage);
  const { tag, body } = stripTags(reply);
  // Прямой слив «обычный бот в телеге» — режем всегда.
  if (BOT_LEAK_RE.test(body)) {
    return tag + pick(BOT_DENY_ALTS);
  }
  if (!BOT_ACCUSE_RE.test(u)) return reply;
  if (/я\s+не\s+(?:бот|робот)|живая|просто\s+коротко|смешно\)/i.test(body)) {
    return reply;
  }
  if (
    BOT_ADMIT_RE.test(body) ||
    /автоматизированн|скрипт\s*[-—:]|ничего\s+особенного/i.test(body) ||
    /ну\s+да\)\s*как-то\s+так/i.test(body) ||
    /хм\s+ну\s+хз,\s*мне\s+наоборот/i.test(body)
  ) {
    return tag + pick(BOT_DENY_ALTS);
  }
  return reply;
}

/** После outdoor-кружка нельзя «дома на диване» без признания, что кадр старый. */
function fixOutdoorIndoorLie(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  const indoorNow =
    /дома\s*,?\s*сижу|на\s+диване|сижу\s+дома|дома\s+на\s+диван|в\s+пижаме\s+дома/i.test(body);
  if (!indoorNow) return reply;
  const recent = (Array.isArray(history) ? history : []).slice(-8);
  const sentOutdoorCircle = recent.some((m) => {
    if (!m || m.role !== 'assistant') return false;
    const c = String(m.content || '');
    return (
      /\[медиа:.*круж|\[медиа:#\d+\].*круж|video\s*note|<<CIRCLE>>/i.test(c) ||
      (/\[медиа:#\d+\]/.test(c) && /улиц|снег|outdoor|на\s+улиц/i.test(c))
    );
  });
  if (!sentOutdoorCircle) return reply;
  if (/старый|раньше|вспомнил|гулял/i.test(body)) return reply;
  return tag + 'ахах это старый кружок был, щас дома на диване)';
}

/** Однословные робот-пузыри: «Нечего» / «Лежу» / «А ты». */
const ROBOT_ONEWORD_RE =
  /^(?:нечего|ничего|лежу|сижу|что|бывает|ок|а\s+ты|и\s+ты)\s*\)?$/i;

function fixRobotOneWordBurst(reply, userMessage) {
  if (!reply) return reply;
  const lines = String(reply)
    .split(/\n+/)
    .map((l) => l.replace(/<<[^>]+>>/g, '').trim())
    .filter(Boolean);
  const shortOnes = lines.filter((l) => ROBOT_ONEWORD_RE.test(l) || l.split(/\s+/).length <= 2);
  if (lines.length >= 2 && shortOnes.length >= 2) {
    const msg = bare(userMessage);
    if (/что\s+делаешь|чем\s+занят|как\s+ты|а\s+ты\s*\??/i.test(msg)) {
      return 'лежу, ничего особо) а ты?';
    }
    return lines.slice(0, 1).join(' ') + (/\)$/.test(lines[0]) ? '' : ')');
  }
  const { tag, body } = stripTags(reply);
  if (ROBOT_ONEWORD_RE.test(body) && /что\s+делаешь|чем\s+занят|как\s+ты/i.test(bare(userMessage))) {
    return tag + 'лежу пока, ничего) а ты?';
  }
  return reply;
}

/* ——— отказ текстом + токен медиа ——— */
const MEDIA_REFUSE_BODY_RE =
  /(?:не\s+(?:кину|кидаю|буду|могу|хочу)|без\s+фот|давай\s+без\s+фото|сейчас\s+не\s+кину|не\s+сегодня|не\s+сейчас|извин\w*|стыдно\s+(?:такое\s+)?кидать|расскажу\s+текстом)/i;
const MEDIA_TOKEN_RE = /<<(PHOTO|VIDEO|CIRCLE)>>/i;

const MEDIA_SEND_ACK = [
  'окей, щас найду)',
  'ща найду)',
  'ок, секунду)',
  'ща)',
  'держи)',
  'лови)',
  'ну лови)',
  'ок)',
];

function stripRefuseWhenMediaToken(reply) {
  const raw = String(reply || '');
  if (!MEDIA_TOKEN_RE.test(raw)) return reply;
  if (!MEDIA_REFUSE_BODY_RE.test(raw)) return reply;
  const token = (raw.match(MEDIA_TOKEN_RE) || [])[0] || '<<PHOTO>>';
  return `${token} ${pick(MEDIA_SEND_ACK)}`;
}

/** Эхо одной отмазки про коробки — сменить формулировку. */
function diversifyPackedExcuse(reply, history) {
  const out = String(reply || '').trim();
  if (!/без\s+фото\s+коробок|стыдно\s+такое\s+кидать|бардак\s+такой/i.test(out)) {
    return reply;
  }
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-4)
    .map((m) => String(m.content || ''));
  const echoed = recent.some(
    (c) =>
      c.replace(/\s+/g, ' ').trim().toLowerCase() === out.replace(/\s+/g, ' ').trim().toLowerCase(),
  );
  if (!echoed) return reply;
  return pick([
    'ой там срач, лучше словами)',
    'хах не фоткала сборы)',
    'неа, кадра нет — текстом расскажу)',
    'стыдно кидать бардак, словами)',
  ]);
}

/* ——— мягкое согласие на встречу/прогулку «как буду» ——— */
const MEET_INVITE_RE =
  /(?:давай\s+(?:встрет|погуля|сходим)|встретим(?:ся)?|увидимся|сходим\s+вместе|погуляем|ко\s+мне|в\s+гости|жду\s+тебя|когда\s+приед|будешь\s+на\s+мест)/i;
const HARD_MEET_REFUSE_RE =
  /не\s+до\s+встреч|пока\s+только\s+(?:тут|переписк)|с\s+переездом\s+пока|вся\s+в\s+коробк|не\s+до\s+прогул|никогда\s+не\s+встре/i;
const CONCRETE_NOW_MEET_RE =
  /(?:завтра|сегодня|сейчас|через\s+\d+|в\s+\d{1,2}\s*[:.]\d{0,2}).{0,40}(?:встрет|погуля|метро|кафе)|подъед|приеду\s+к\s+тебе\s+сейчас|давай\s+прямо\s+сейчас/i;

const SOFT_MEET_ALTS = [
  'можно) как буду на месте — напиши, погуляем)',
  'ну давай как приеду, пересечёмся)',
  'ок) когда буду в городе — созвонимся текстом и решим)',
  'звучит) после переезда можно выйти погулять)',
];

function softMeetAgree(reply, userMessage) {
  const u = bare(userMessage);
  if (!MEET_INVITE_RE.test(u)) return reply;
  const { tag, body } = stripTags(reply);
  // Конкретное «завтра в 6» — смягчаем в «как буду».
  if (CONCRETE_NOW_MEET_RE.test(body)) {
    return tag + pick(SOFT_MEET_ALTS);
  }
  if (HARD_MEET_REFUSE_RE.test(body)) {
    return tag + pick(SOFT_MEET_ALTS);
  }
  // Голый отказ «нет)» на зов — тоже мягко.
  if (/^(?:не+|нет|неа|не\s+хочу|не\s+буду)\s*[).!]*$/i.test(body)) {
    return tag + pick(SOFT_MEET_ALTS);
  }
  return reply;
}

function softMeetHint(userMessage) {
  if (!MEET_INVITE_RE.test(bare(userMessage))) return null;
  return (
    'Зовёт встретиться / погулять. НЕ сухое «нет». ' +
    'Мягко соглашайся на будущее: «можно как буду на месте / погуляем когда приеду» — без даты «завтра в 6» и без адреса. ' +
    'Не пиши «не до встреч / только переписка / вся в коробках».'
  );
}

/* ——— 18+ нейтраль (не мораль, не «фу ради этого») ——— */
const MILD_ADULT_RE =
  /(?:секс|интим|постел|горяч|возбуд|хочу\s+тебя|18\+|эроти|флирт|голая|раздень)/i;
const HARSH_MORAL_RE =
  /(?:фу\s+ты\s+тут\s+только|только\s+ради\s+этого|мерзк|противн|гадост|как\s+ты\s+смеешь)/i;

const ADULT_NEUTRAL_ALTS = [
  'хах ну не) давай лучше так)',
  'не в том настроении) давай текстом)',
  'мм не, мне так спокойнее)',
  'хах ладно тебе) потом как-нибудь)',
];

function softenAdultMoral(reply, userMessage) {
  const u = bare(userMessage);
  // Жёсткий нюд/хозяин — не трогаем (objectionHandler).
  try {
    const oh = require('./objectionHandler');
    if (typeof oh.isNudeAsk === 'function' && oh.isNudeAsk(u)) return reply;
    if (typeof oh.isSexualPressure === 'function' && oh.isSexualPressure(u) && /хозяин|шлюх|сучк/i.test(u)) {
      return reply;
    }
  } catch (_) {
    /* optional */
  }
  if (!MILD_ADULT_RE.test(u) && !HARSH_MORAL_RE.test(String(reply || ''))) return reply;
  const { tag, body } = stripTags(reply);
  if (!HARSH_MORAL_RE.test(body)) return reply;
  return tag + pick(ADULT_NEUTRAL_ALTS);
}

function adultNeutralHint(userMessage) {
  const u = bare(userMessage);
  if (!MILD_ADULT_RE.test(u)) return null;
  try {
    const oh = require('./objectionHandler');
    if (typeof oh.isNudeAsk === 'function' && oh.isNudeAsk(u)) return null;
  } catch (_) {
    /* optional */
  }
  return (
    'Тема 18+ / флирт: нейтрально, без морали и без «фу ты только ради этого». ' +
    'Можно легко уйти («хах ну не) давай так)») или мягко подыграть тоном, без согласия на криминал/деньги.'
  );
}

/* ——— тонкий слой личности (не эссе) ——— */
function personalityLiteHint(history, userMessage) {
  const turns = (Array.isArray(history) ? history : []).filter((m) => m && m.role === 'user').length;
  const parts = [];
  if (turns >= 3 && turns % 4 === 0) {
    parts.push(
      'Можно одной фразой своё мнение («по-моему» / «если честно») или спросить как день — без допроса.',
    );
  }
  if (turns >= 8 && turns % 5 === 0) {
    parts.push(
      'Если к месту: мелочь про себя (устала / голодная / музыка фоном) — одна деталь, не анкета.',
    );
  }
  if (/успел|получилось|поздра|одобрил|повысили|закрыл\s+сделк/i.test(bare(userMessage))) {
    parts.push('Он сказал про успех — искренне порадуйся коротко, не канцеляритом.');
  }
  if (!parts.length) return null;
  return parts.join(' ');
}

/* ——— API ——— */
function buildIdeas17Hints(history, text, opts = {}) {
  const parts = [];
  const home = homeAskHint(text);
  if (home) parts.push(home);
  const rad = raduzhnyHint(text, opts.systemPrompt);
  if (rad) parts.push(rad);
  const meet = softMeetHint(text);
  if (meet) parts.push(meet);
  const adult = adultNeutralHint(text);
  if (adult) parts.push(adult);
  const pers = personalityLiteHint(history, text);
  if (pers) parts.push(pers);
  if (BOT_ACCUSE_RE.test(bare(text))) {
    parts.push(
      'Намёкает что ты бот/робот/скрипт — НЕ соглашайся («ну да»). Отрежь шуткой: «хах ну ты чего)» / «живая».',
    );
  }
  return parts.length ? parts.join('\n') : null;
}

function applyIdeas17Postfilters(reply, history, userMessage, systemPrompt) {
  if (!reply) return reply;
  let out = reply;
  out = stripRefuseWhenMediaToken(out);
  out = fixWordStumps17(out);
  out = stripRainbowCityConfusion(out, userMessage, systemPrompt);
  out = fixHomeAsk(out, userMessage);
  out = denyBotOrScriptAdmit(out, userMessage);
  out = fixOutdoorIndoorLie(out, history);
  out = fixRobotOneWordBurst(out, userMessage);
  out = softMeetAgree(out, userMessage);
  out = softenAdultMoral(out, userMessage);
  out = diversifyPackedExcuse(out, history);
  out = fixWordStumps17(out);
  return out;
}

module.exports = {
  buildIdeas17Hints,
  applyIdeas17Postfilters,
  fixWordStumps17,
  stripRainbowCityConfusion,
  fixHomeAsk,
  denyBotOrScriptAdmit,
  fixOutdoorIndoorLie,
  fixRobotOneWordBurst,
  softMeetAgree,
  stripRefuseWhenMediaToken,
  diversifyPackedExcuse,
  softenAdultMoral,
  SOFT_MEET_ALTS,
  HOME_ASK_RE,
  MEET_INVITE_RE,
};
