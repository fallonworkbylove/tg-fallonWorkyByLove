/**
 * humanIdeas14 (0ih) — пакет идей без бюджета:
 * опечатки/обрубки, анти-клише, «не покажу», хвосты, «хм», анти-эхо,
 * бот-тест, короче ночью, после фото, 1 вопрос, города, карточка,
 * забыла 7д, закрытая тема, до завтра, медиа после отказа, видео-стеснение,
 * 2 отказа фото → смена темы.
 */

function bare(msg) {
  return String(msg || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mskHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      hour: 'numeric',
      hour12: false,
    }).format(date),
  );
}

function peerKey(accountId, peerId) {
  return `${accountId}:${peerId}`;
}

/** accountId:peerId -> { clicheBan, noShowStreak, photoRefuse } */
const peerFlags = new Map();

function getFlags(accountId, peerId) {
  if (accountId == null || peerId == null) return null;
  const k = peerKey(accountId, peerId);
  if (!peerFlags.has(k)) peerFlags.set(k, { clicheBan: false, noShowStreak: 0, photoRefuse: 0 });
  return peerFlags.get(k);
}

/* ——— 1 опечатки / обрубки ——— */
const WORD_FIXES = [
  [/пр\s+альное/gi, 'нормальное'],
  [/поимер/gi, 'пример'],
  [/кааец/gi, 'капец'],
  [/саокойн\w*/gi, 'спокойной'],
  [/Радужеый/gi, 'Радужный'],
  [/Радкжн\w*/gi, 'Радужный'],
  [/Радужнй/gi, 'Радужный'],
  [/иеогда/gi, 'иногда'],
  [/иеогва/gi, 'иногда'],
  [/всегва/gi, 'всегда'],
  [/тогва/gi, 'тогда'],
  [/бывпет/gi, 'бывает'],
  [/разбрров/gi, 'разборов'],
  [/предаочтения/gi, 'предпочтения'],
  [/прикрльно/gi, 'прикольно'],
  [/жнсть/gi, 'жесть'],
  [/поосто/gi, 'просто'],
  [/дрстанут/gi, 'достанут'],
  // 0in H: обрубки перед скобкой / концом
  [/переписк(?=[).!?]|$)/gi, 'переписку'],
  [/сообщен(?=[).!?]|$)/gi, 'сообщение'],
  [/(?<![а-яё])делам(?=\))/gi, 'делаю'],
  // 0iy: скрины воркеров — обрубки слов
  [/(?<![а-яё])вещ(?![а-яё])/gi, 'вещи'],
  [/(?<![а-яё])нуже(?![а-яё])/gi, 'нужна'],
  [/(?<![а-яё])серьёз(?![а-яён])/gi, 'серьёзно'],
  [/из\s+Липецк(?![а-яё])/gi, 'из Липецка'],
  [/из\s+липецк(?![а-яё])/gi, 'из Липецка'],
  [/поддержка\s+нуже(?![а-яё])/gi, 'поддержка нужна'],
  [/собираю\s+вещ(?![а-яё])/gi, 'собираю вещи'],
  // 0iz: ещё хвосты из логов/скринов
  [/(?<![а-яё])передвигаю(?![а-яё])/gi, 'переезжаю'],
  [/(?<![а-яё])называется\s*\)?$/gi, 'называется так, потом вспомню)'],
  [/поддержк(?=[).!?]|$)/gi, 'поддержка'],
  // 0jf: скрины — обрубки
  [/(?<![а-яё])позд(?![а-яён])/gi, 'поздно'],
  [/(?<![а-яё])подожд(?![а-яё])/gi, 'подожди'],
  [/(?<![а-яё])яркш(?![а-яё])/gi, 'ярких'],
  [/ыитоняшк\w*/gi, 'фитоняшка'],
  // 0mf: live typos
  [/бувет/gi, 'будет'],
  [/отншмает/gi, 'отнимает'],
  [/можео/gi, 'можно'],
  [/спокойной\s+ноч(?![аи])/gi, 'спокойной ночи'],
];

const STUCK_TAIL_RE =
  /(?:^|\s)(?:ться|ения|остью|аться|ивать|евать|ся)\s*[,.)]?\s*$/i;

/** Обрубок: «хвост» без гласной на конце перед ) . ! ? (от 3 букв — вещ/серьёз). */
const STUMP_BEFORE_PUNCT_RE =
  /(?<![а-яё])([а-яё]{3,14}[бвгджзклмнпрстфхцчшщ])(?=[)\s]*[).!?]|$)/gi;

const STUMP_HEAL = {
  переписк: 'переписку',
  сообщени: 'сообщение',
  сообщен: 'сообщение',
  нормальн: 'нормально',
  прикольн: 'прикольно',
  поня: 'поняла',
  написа: 'написала',
  испорти: 'испортила',
  вещ: 'вещи',
  нужн: 'нужна',
  нуже: 'нужна',
  серьёз: 'серьёзно',
  позд: 'поздно',
  подожд: 'подожди',
  яркш: 'ярких',
};

function healWordStumps(text) {
  return String(text || '').replace(STUMP_BEFORE_PUNCT_RE, (m, stem) => {
    const low = String(stem || '').toLowerCase();
    if (STUMP_HEAL[low]) {
      const fix = STUMP_HEAL[low];
      return stem[0] === stem[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
    }
    return m;
  });
}

function fixBrokenWords(reply) {
  let out = String(reply || '');
  if (!out) return reply;
  for (const [re, to] of WORD_FIXES) {
    re.lastIndex = 0;
    if (re.test(out)) {
      re.lastIndex = 0;
      out = out.replace(re, to);
    }
  }
  out = healWordStumps(out);
  // «щас пр альное» already covered; glue spaced syllables inside word-ish
  out = out.replace(/\b([а-яё]{1,3})\s+([а-яё]{4,})\b/gi, (m, a, b) => {
    const joined = `${a}${b}`;
    if (/^(?:нормальное|правильное|пример|спокойной)$/i.test(joined)) return joined;
    return m;
  });
  if (STUCK_TAIL_RE.test(out) && out.length < 80) {
    out = out.replace(STUCK_TAIL_RE, '').trim();
    if (!out) return pick(['о как)', 'хех ну да)', 'ага)']);
  }
  return out;
}

/* ——— 2 бан «я обычная / просто общаемся» ——— */
const CLICHE_ME_RE =
  /(?:я\s+обычн\w*|просто\s+обща(?:юсь|емся)|просто\s+общен\w*|я\s+простая\s+девч)/i;

function banClicheMe(reply, history, accountId, peerId) {
  const out = String(reply || '');
  if (!CLICHE_ME_RE.test(out)) return reply;
  const flags = getFlags(accountId, peerId);
  const usedBefore = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-12)
    .some((m) => CLICHE_ME_RE.test(String(m.content || '')));
  if (usedBefore || (flags && flags.clicheBan)) {
    return pick([
      'ну да, просто пишу тебе)',
      'ага, обычный вечер)',
      'да так, в чате сижу)',
    ]);
  }
  if (flags) flags.clicheBan = true;
  // first time — soften but allow once
  return out
    .replace(/я\s+обычн\w*[^.!?\n]{0,40}/gi, 'ну да')
    .replace(/просто\s+обща(?:юсь|емся)[^.!?\n]{0,20}/gi, 'просто пишу')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ——— 3 «не покажу» 3+ ——— */
const NO_SHOW_RE = /не\s+покаж|не\s+скин|не\s+пришлю|не\s+отправлю\s+(?:фото|видео|круж)/i;

const NO_SHOW_ALTS = [
  'давай лучше просто поболтаем)',
  'мне так комфортнее текстом)',
  'ой, в другой раз как-нибудь)',
  'лучше расскажи, как день)',
];

function diversifyNoShow(reply, history) {
  const out = String(reply || '');
  if (!NO_SHOW_RE.test(out)) return reply;
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-6)
    .filter((m) => NO_SHOW_RE.test(String(m.content || '')));
  if (recent.length >= 2) return pick(NO_SHOW_ALTS);
  return out;
}

function noteNoShow(accountId, peerId, reply) {
  const flags = getFlags(accountId, peerId);
  if (!flags) return;
  if (NO_SHOW_RE.test(String(reply || ''))) flags.noShowStreak += 1;
  else flags.noShowStreak = 0;
}

/* ——— 4 обрезанные хвосты ——— */
function stripCutTails(reply) {
  let out = String(reply || '').trim();
  if (!out) return reply;
  // ends with comma / bare «но» / hanging conjunction
  if (/(?:,|но|а|и|что|чтобы|если)\s*$/i.test(out) && !/[)….!?]$/.test(out)) {
    out = out.replace(/(?:,|но|а|и|что|чтобы|если)\s*$/i, '').trim();
    if (out && !/[)….!?]$/.test(out)) out += ')';
  }
  // mid cut: "поняла) но иногда полезно,"
  out = out.replace(/([)….!])\s*(?:но|а)\s+[а-яёa-z][^!?]{0,40},\s*$/i, '$1');
  return out || reply;
}

/* ——— 5 меньше «хм» в начале ——— */
const HM_START = /^(?:\s*<<[^>\n]+>>\s*)?(?:хм+|хмм+|эм+|ее+|ee+)\s*[,.]?\s*/i;
const START_ALTS = ['', 'ну ', 'ага, ', 'слушай, ', 'короче '];

function rotateHmStart(reply, history) {
  let out = String(reply || '');
  if (!HM_START.test(out)) return reply;
  const recentHm = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-4)
    .filter((m) => /^(?:\s*<<[^>]+>>\s*)?(?:хм+|хмм+)/i.test(String(m.content || '')));
  if (recentHm.length < 1 && Math.random() > 0.55) return reply;
  const tag = (out.match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = out.slice(tag.length).replace(HM_START, '');
  return tag + pick(START_ALTS) + body;
}

/* ——— 6 анти-эхо ок/ага/поняла ——— */
const SHORT_ACK_RE =
  /^(?:\s*<<[^>\n]+>>\s*)?(?:ну\s+)?(?:ок|окей|ага|угу|поняла|ясно|хорошо|ладно)\s*\)?\.?$/i;

function breakShortAckEcho(reply, history) {
  const out = String(reply || '').trim();
  if (!SHORT_ACK_RE.test(out)) return reply;
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-5)
    .filter((m) => SHORT_ACK_RE.test(String(m.content || '').trim()));
  if (recent.length < 2) return reply;
  return pick(['хаха ну да)', 'звучит)', 'интересно)', 'поняла, дальше что)']);
}

/* ——— 7 бот-тест короче ——— */
function shortenBotDefense(reply, userMessage) {
  const u = bare(userMessage);
  if (!/ты\s+(?:бот|нейро|ии|chatgpt|робот)|докажи\s+что\s+ты|не\s+бот\s*\?|скрипт/i.test(u)) {
    return reply;
  }
  const out = String(reply || '');
  // Согласие «ну да / как-то так / автоматизированное» — срезаем.
  if (/ну\s+да|как-то\s+так|автоматизированн|скрипт\s*[-—:]/i.test(out)) {
    return pick(['хах ну ты чего)', 'смешно) я тут', 'ага, живые тоже так пишут)']);
  }
  if (out.length <= 60 && !/я\s+не\s+бот|я\s+живая|нейросет/i.test(out)) return reply;
  return pick(['хах ну ты чего)', 'смешно) я тут', 'ага, живые тоже так пишут)']);
}

/* ——— 8 короче после 23 МСК ——— */
function shortenLateNight(reply) {
  const h = mskHour();
  if (h < 23 && h >= 6) return reply;
  let out = String(reply || '').trim();
  if (out.length <= 90) return reply;
  const first = out.split(/(?<=[)….!?])\s+/)[0] || out;
  return first.length >= 12 && first.length < out.length ? first : out.slice(0, 90).replace(/\s+\S*$/, '') + ')';
}

/* ——— 9 после фото не «как тебе» ——— */
function stripHowPhotoAsk(reply, history) {
  const out = String(reply || '');
  if (!/как\s+тебе|норм\s*\?|нравится\s*\?/i.test(out)) return reply;
  const lastAsst = [...(Array.isArray(history) ? history : [])]
    .reverse()
    .find((m) => m && m.role === 'assistant');
  const prevMedia =
    lastAsst &&
    (/\[медиа:|outbound media|отправил|скинул/i.test(String(lastAsst.content || '')) ||
      /^\[медиа:/.test(String(lastAsst.content || '')));
  // also if this turn is with media tag left in history pair
  const recentMedia = (Array.isArray(history) ? history : [])
    .slice(-3)
    .some((m) => m && m.role === 'assistant' && /\[медиа:/.test(String(m.content || '')));
  if (!prevMedia && !recentMedia) return reply;
  return out
    .replace(/[^.!?\n]*(?:как\s+тебе|норм\s*\?|нравится\s*\?)[^.!?\n]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || pick(['держи)', 'вот)', 'скинула)']);
}

/* ——— 10 один вопрос если он спросил ——— */
function limitOneQuestion(reply, userMessage) {
  const u = bare(userMessage);
  if (!/[?]/.test(u) && !/(?:как|что|где|зачем|почему|кто)\s+/i.test(u)) return reply;
  let out = String(reply || '');
  const parts = out.split(/(?<=[?])/);
  if (parts.filter((p) => /\?/.test(p)).length <= 1) return reply;
  // keep first sentence with ? or drop trailing questions
  let seen = 0;
  out = out
    .split(/(?<=[.!)])\s+/)
    .map((s) => {
      if (!/\?/.test(s)) return s;
      seen += 1;
      return seen === 1 ? s : s.replace(/\?/g, '').replace(/\s+$/, '') + ')';
    })
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out || reply;
}

/* ——— 11 города: хинт ——— */
function cityConsistencyHint(systemPrompt, history) {
  try {
    const card = require('./personaFacts').parsePersonaCard(systemPrompt || '');
    if (!card?.fromCity && !card?.toCity) return null;
    const bits = [];
    if (card.fromCity) bits.push(`сейчас/родом: ${card.fromCity}`);
    if (card.toCity) bits.push(`переезд: ${card.toCity}`);
    return (
      `Города легенды: ${bits.join('; ')}. Не путай и не называй третий город. ` +
      'Если уже сказала один — держись его в этом чате.'
    );
  } catch (_) {
    return null;
  }
}

/* ——— 12 карточка peer раз в N ходов ——— */
function peerCardNudgeHint(history, memoryHint) {
  const turns = (Array.isArray(history) ? history : []).filter((m) => m && m.role === 'user').length;
  if (turns < 4 || turns % 5 !== 0) return null;
  if (!memoryHint) return 'Если помнишь его работу/хобби — коротко опереться, не допрашивай.';
  return 'Раз в несколько реплик мягко опереться на его карточку (работа/хобби), без анкеты.';
}

/* ——— 13 забыла честно 7д ——— */
function honestForgetHint() {
  return (
    'Факты старше ~недели можешь честно не помнить: «бля забыла) напомни» — лучше, чем выдумывать.'
  );
}

/* ——— 14 закрытая тема ——— */
const CLOSED_TOPIC_RE =
  /(?:ладно\s+хватит|хватит\s+(?:об\s+этом|уже)|не\s+хочу\s+(?:об\s+этом|говорить)|давай\s+не\s+(?:об\s+этом|будем)|закроем\s+тему|проехали)/i;

function closedTopicHint(userMessage) {
  if (!CLOSED_TOPIC_RE.test(bare(userMessage))) return null;
  return 'Он закрыл тему. НЕ возвращайся к ней. Короткий кивок и другая лёгкая тема.';
}

function stripReturnToClosed(reply, userMessage, history) {
  if (!CLOSED_TOPIC_RE.test(bare(userMessage))) {
    const prevUser = [...(Array.isArray(history) ? history : [])]
      .reverse()
      .find((m) => m && m.role === 'user');
    if (!prevUser || !CLOSED_TOPIC_RE.test(bare(prevUser.content))) return reply;
  }
  const out = String(reply || '');
  // if she re-asks same pressure topic (фото/встреча) after close — soften
  if (/давай\s+(?:вс[её]\s+)?(?:таки\s+)?(?:скин|фото|встрет|покаж)/i.test(out)) {
    return pick(['ок, не давлю)', 'ладно, проехали)', 'ну ладно, проехали)']);
  }
  return reply;
}

/* ——— 15 до завтра ——— */
const FAREWELL_RE =
  /(?:до\s+завтра|спокойной\s+ночи|спокойно\s+ночи|баиньки|доброй\s+ночи|я\s+спать|пойду\s+спать)/i;

function hadRecentFarewell(history) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-4)
    .some((m) => FAREWELL_RE.test(String(m.content || '')));
}

/**
 * После нашего «спокойной» вечером/ночью — молчим до утра МСК.
 * Hard media (явная просьба фото/видео) не глушим.
 */
function shouldSkipUntilMorning(history, userMessage, opts = {}) {
  if (!hadRecentFarewell(history)) return false;
  if (opts && opts.hardMedia) return false;
  try {
    if (require('./mediaSend').isHardMediaRequest(userMessage, history)) return false;
  } catch (_) {
    /* optional */
  }
  const h = mskHour();
  // День 07–20 — новый круг, можно отвечать.
  if (h >= 7 && h < 21) return false;
  // 21–06 после farewell — тишина (не эссе / не второй «спокойной»).
  return true;
}

function farewellRespectHint(history, userMessage) {
  if (!hadRecentFarewell(history)) return null;
  const h = mskHour();
  if (h >= 7 && h < 21) return null;
  return (
    'Уже прощались на ночь — не пиши сама до утра. Если он всё же написал коротко — ' +
    'только ультракороткий ack без вопроса, без новой темы.'
  );
}

/* ——— 16/20 медиа после «не покажу» / 2 отказа ——— */
function countPhotoRefusals(history) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-10)
    .filter((m) => NO_SHOW_RE.test(String(m.content || ''))).length;
}

function shouldBlockMediaAfterNoShow(history) {
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-3);
  return recent.some((m) => NO_SHOW_RE.test(String(m.content || '')));
}

function afterTwoPhotoRefusesHint(history, userMessage) {
  if (countPhotoRefusals(history) < 2) return null;
  if (!/фото|скин|покаж|видео|круж/i.test(bare(userMessage))) return null;
  return (
    'Уже дважды отказала в фото. НЕ отказывай третьим «не покажу». ' +
    'Смени тему: хобби / день / переезд / шутка. Одна короткая фраза.'
  );
}

function divertAfterPhotoRefuses(reply, history) {
  if (countPhotoRefusals(history) < 2) return reply;
  if (!NO_SHOW_RE.test(String(reply || ''))) return reply;
  return pick([
    'давай лучше про день расскажи)',
    'ок, тогда чем ещё увлекаешься?)',
    'ладно) а как обычно вечер проводишь?',
  ]);
}

/* ——— 19 видео + стеснение ——— */
function shyVideoRefusal(reply, userMessage) {
  const u = bare(userMessage);
  const asksVideo = /видео|кружок|voice|видос/i.test(u);
  const shyAsk = /стесня|не\s+хоч|можно\s+без\s+видео|текстом/i.test(u);
  const out = String(reply || '');
  if (!asksVideo && !shyAsk) return reply;
  if (/нфт|\bnft\b|токен|флип|платформ/i.test(out)) {
    return pick([
      'ой, на видео стесняюсь, давай лучше тут)',
      'неа, видео не записываю) текстом ок?',
      'давай без видео, мне так спокойнее)',
    ]);
  }
  if (asksVideo && /стесня|не\s+буду\s+на\s+видео|не\s+запис/i.test(out)) {
    // already fine — keep short
    if (out.length > 100) return 'ой, на видео стесняюсь, давай лучше тут)';
  }
  return reply;
}

function shyVideoHint(userMessage) {
  const u = bare(userMessage);
  if (!/видео|кружок|видос|запиши/i.test(u)) return null;
  return (
    'Просит видео/кружок. Можно честно стесняться: «ой на видео стесняюсь, давай тут)» — ' +
    'БЕЗ NFT/платформы/токенов. 1 фраза.'
  );
}

/* ——— API ——— */
function buildIdeas14Hints(history, text, opts = {}) {
  const parts = [];
  const closed = closedTopicHint(text);
  if (closed) parts.push(closed);
  const fare = farewellRespectHint(history, text);
  if (fare) parts.push(fare);
  const shy = shyVideoHint(text);
  if (shy) parts.push(shy);
  const divert = afterTwoPhotoRefusesHint(history, text);
  if (divert) parts.push(divert);
  const city = cityConsistencyHint(opts.systemPrompt, history);
  if (city) parts.push(city);
  const card = peerCardNudgeHint(history, opts.memoryHint);
  if (card) parts.push(card);
  if ((Array.isArray(history) ? history : []).length >= 6) {
    parts.push(honestForgetHint());
  }
  const h = mskHour();
  if (h >= 23 || h < 6) {
    parts.push('Сейчас поздно по МСК — отвечай короче (1 фраза), без длинных расспросов.');
  }
  return parts.length ? parts.join('\n') : null;
}

/** «40 — новый 20 / жизнь только начинается» — AI-эссе, не живая. */
const AGE_PLATITUDE_RE =
  /(?:\d+\s*[-–—]\s*новый\s*\d+|новый\s*20|жизнь\s+только\s+начинается|возраст\s*[-–—]\s*это\s+просто\s+цифр)/i;
const AGE_PLATITUDE_ALTS = [
  'хах ну да)',
  'ну бывает)',
  'о как)',
  'норм)',
];

function stripAgePlatitude(reply) {
  const t = String(reply || '');
  if (!AGE_PLATITUDE_RE.test(t)) return reply;
  if (t.length <= 60) {
    return AGE_PLATITUDE_ALTS[Math.floor(Math.random() * AGE_PLATITUDE_ALTS.length)];
  }
  return t
    .replace(/\d+\s*[-–—]\s*новый\s*\d+[).!]?\s*/gi, '')
    .replace(/жизнь\s+только\s+начинается[).!]?\s*/gi, '')
    .replace(/возраст\s*[-–—]\s*это\s+просто\s+цифр\w*[).!]?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || AGE_PLATITUDE_ALTS[0];
}

function applyIdeas14Postfilters(reply, history, userMessage, accountId, peerId) {
  if (!reply) return reply;
  let out = reply;
  out = fixBrokenWords(out);
  out = stripAgePlatitude(out);
  out = stripCutTails(out);
  out = banClicheMe(out, history, accountId, peerId);
  out = diversifyNoShow(out, history);
  out = rotateHmStart(out, history);
  out = breakShortAckEcho(out, history);
  out = shortenBotDefense(out, userMessage);
  out = shortenLateNight(out);
  out = stripHowPhotoAsk(out, history);
  out = limitOneQuestion(out, userMessage);
  out = stripReturnToClosed(out, userMessage, history);
  out = shyVideoRefusal(out, userMessage);
  out = divertAfterPhotoRefuses(out, history);
  out = fixBrokenWords(out);
  try {
    const ai = require('./aiResponder');
    if (typeof ai.fixFemaleSelfForms === 'function') out = ai.fixFemaleSelfForms(out);
  } catch (_) {
    /* optional */
  }
  noteNoShow(accountId, peerId, out);
  const flags = getFlags(accountId, peerId);
  if (flags && NO_SHOW_RE.test(String(out || ''))) flags.photoRefuse = Math.max(flags.photoRefuse, countPhotoRefusals(history) + 1);
  return out;
}

module.exports = {
  buildIdeas14Hints,
  applyIdeas14Postfilters,
  stripAgePlatitude,
  AGE_PLATITUDE_RE,
  fixBrokenWords,
  shouldBlockMediaAfterNoShow,
  shouldSkipUntilMorning,
  hadRecentFarewell,
  countPhotoRefusals,
  FAREWELL_RE,
  NO_SHOW_RE,
  CLOSED_TOPIC_RE,
};
