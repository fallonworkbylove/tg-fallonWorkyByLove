/**
 * LIFE TEXTURE — «человечность» поверх persona/mood:
 *  1) мелкие сюжеты на 2–3 дня (у каждого аккаунта свой)
 *  2) несогласия и «не в настроении»
 *  3) редкая забывчивость без извинений-эссе
 *
 * Разный «онлайн» по времени — в timeStyle.js (+ per-account flavor отсюда).
 */

const timeStyle = require('./timeStyle');

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mskDateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
}

function mskDayIndex() {
  // стабильный «день с эпохи» по Москве
  const key = mskDateKey(); // YYYY-MM-DD
  return Math.floor(new Date(`${key}T12:00:00+03:00`).getTime() / 86400000);
}

/** Сюжеты: 3 бита на 3 календарных дня, ротация раз в ~неделю. */
const STORY_ARCS = [
  {
    id: 'mom_tiff',
    beats: [
      'вчера с мамой немного поспорили из-за ерунды, настроение так себе',
      'с мамой уже спокойно переписывались — отпустило',
      'мама сегодня норм написала, без претензий',
    ],
  },
  {
    id: 'sleep_debt',
    beats: [
      'две ночи плохо спала, сегодня чуть тормознутая',
      'выспалась получше, но ещё не на 100',
      'сон наконец нормальный, легче',
    ],
  },
  {
    id: 'avito_shelf',
    beats: [
      'выставила полку на авито, пишут странные',
      'полку вроде забирают скоро',
      'с полкой разрулилось, уже не парюсь',
    ],
  },
  {
    id: 'token_swing',
    beats: [
      'токен вчера качнуло вниз, бесила чуть',
      'по токену ровнее, жду',
      'по токену сегодня спокойнее',
    ],
  },
  {
    id: 'neighbor_drill',
    beats: [
      'соседи с утра сверлят — бесит',
      'сверление то есть то нет, уже привыкаю',
      'сегодня тихо, кайф',
    ],
  },
  {
    id: 'friend_visit',
    beats: [
      'подружка собиралась зайти, ждала',
      'с подружкой поболтали, потом разгребала хвосты',
      'после подружки ещё отхожу, домашний день',
    ],
  },
  {
    id: 'nail_redo',
    beats: [
      'ногти вчера криво сделала, бесит',
      'сегодня переделываю / подчищаю',
      'с ногтями уже ок',
    ],
  },
  {
    id: 'grocery_fail',
    beats: [
      'в магазине забыла половину списка',
      'сегодня добирала то что вчера забыла',
      'с продуктами на пару дней закрыла вопрос',
    ],
  },
];

const OPINION_RE =
  /(?:мне\s+кажется|по-?моему|надо\s+|нужно\s+|лучше\s+|всегда\s+|никогда\s+|точно\s+|очевидно|все\s+так\s+делают|это\s+же\s+|согласна?\s*\?|правда\s+же)/i;

const DIRECT_Q_RE =
  /(?:^|[?\n]|скажи|расскажи|ответь).{0,40}\?|(?:как\s+тебя\s+зовут|где\s+ты|откуда|чем\s+занима|сколько\s+тебе)/i;

const FORGET_MARK_RE = /стой[,.]?\s*а\s+|или\s+я\s+путаю|по-моему\s+ты\s+|забыла[,.]?\s*ты\s+/i;

const ASK_HIS_MEDIA_BOT_RE =
  /(?:скинь|пришли|кинь|покажи|запиши|дай).{0,24}(?:фот|фото|круж|селфи|видос)|а\s+есть\s+(?:фот|фото|круж)|хочу\s+(?:увидеть\s+)?(?:фот|круж)|кружочек\s+бы|фотку\s+бы/i;
const HIS_MEDIA_RE = /\[(?:фото|кружок|видео|стикер)\s+от\s+собеседника\]/i;
const MEDIA_REFUSE_RE =
  /(?:не\s+буду\s+(?:скидывать|кидать|фот)|без\s+фоток|не\s+кидаю|потом\s+(?:фот|круж)|не\s+хочу\s+(?:фот|круж|скид)|зачем\s+тебе\s+(?:фот|круж)|не\s+шлю\s+фот)/i;
const VISUAL_TOPIC_RE =
  /(?:дома|на\s+работе|на\s+улице|в\s+зале|на\s+кухне|ем\b|пью|кофе|готовл|машин|гуля|парк|вид\s+из|кот|собак|корги|что\s+делаешь|чем\s+занят|сейчас\s+в|сижу\s+в)/i;

function buildWeekendHint() {
  if (!timeStyle.isWeekendMsk()) return null;
  return (
    'Сейчас ВЫХОДНОЙ (сб/вс по Москве). Не веди себя как в будний рабочий день: ' +
    'без «урывками с работы», можно ленивее/домашнее, чуть больше быта и отдыха. ' +
    'Утром — сонная дольше; вечером — живее. Не объявляй «у меня выходной» каждое сообщение.'
  );
}

/**
 * Редко просит у НЕГО фото/кружок — жест интереса, не спам.
 */
function buildAskHisMediaHint(accountId, userMessage, history, opts = {}) {
  if (opts.objectionHint || opts.campaignHint) return null;
  if (opts.flash === 'hurt' || opts.flash === 'annoyed') return null;

  const hist = Array.isArray(history) ? history : [];
  if (hist.length < 8) return null;

  const msg = String(userMessage || '');
  if (HIS_MEDIA_RE.test(msg)) return null;
  if (/^\s*\[/.test(msg) && /от\s+собеседника\]/i.test(msg)) return null;
  if (DIRECT_Q_RE.test(msg) && !VISUAL_TOPIC_RE.test(msg)) return null;

  const recent = hist.slice(-24);
  const recentBot = recent.filter((h) => h && h.role === 'assistant').map((h) => String(h.content || ''));
  const recentUser = recent.filter((h) => h && h.role === 'user').map((h) => String(h.content || ''));

  if (recentBot.some((t) => ASK_HIS_MEDIA_BOT_RE.test(t))) return null;
  if (recentUser.slice(-6).some((t) => HIS_MEDIA_RE.test(t))) return null;
  if (recentUser.some((t) => MEDIA_REFUSE_RE.test(t))) return null;

  // Уже просила за «сутки» диалога (по последним ~40 репликам)
  const widerBot = hist
    .slice(-40)
    .filter((h) => h && h.role === 'assistant')
    .map((h) => String(h.content || ''));
  const asksBefore = widerBot.filter((t) => ASK_HIS_MEDIA_BOT_RE.test(t)).length;
  if (asksBefore >= 1) return null;

  const weekend = timeStyle.isWeekendMsk();
  const visual = VISUAL_TOPIC_RE.test(msg) || recentUser.slice(-3).some((t) => VISUAL_TOPIC_RE.test(t));
  const rand = mulberry32(hashSeed(`askMedia:${accountId}:${mskDateKey()}:${hist.length}`));
  // Базовый шанс низкий; выше если визуальная тема или выходной вечер
  let chance = weekend ? 0.1 : 0.06;
  if (visual) chance += 0.08;
  if (weekend && visual) chance += 0.04;
  if (rand() > chance) return null;

  const wantCircle = rand() < 0.55;
  const examples = wantCircle
    ? ['скинь кружок как там)', 'а кружочек запиши)', 'покажи кружком)']
    : ['скинь фотку)', 'а есть фотка как там?)', 'фотку бы глянуть)'];
  const example = examples[Math.floor(rand() * examples.length)];

  return (
    `МОЖНО (не обязана) одним коротким жестом попросить у него ${wantCircle ? 'кружок' : 'фото'} — ` +
    `интерес к нему, не допрос. Пример тона: «${example}». ` +
    'Только если к месту по теме. Не ной если не пришлёт. Не проси интим/лицо «для проверки». ' +
    'Не совмещай с отказом от своих фото. В большинстве ответов просьба НЕ нужна.'
  );
}

/**
 * Текущий бит сюжета аккаунта (меняется каждый день МСК, арка раз в 7 дней).
 */
function getCurrentStoryBeat(accountId) {
  const day = mskDayIndex();
  const week = Math.floor(day / 7);
  const rand = mulberry32(hashSeed(`arc:${accountId}:${week}`));
  const arc = STORY_ARCS[Math.floor(rand() * STORY_ARCS.length)];
  const beatIdx = ((day % 7) + Math.floor(rand() * 3)) % 3;
  return { arcId: arc.id, beatIdx, text: arc.beats[beatIdx], week };
}

function alreadyToldBeat(history, beatText) {
  const said = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .map((h) => String(h.content || '').toLowerCase())
    .join('\n');
  const key = String(beatText || '')
    .toLowerCase()
    .split(/[ ,]+/)
    .slice(0, 4)
    .join(' ');
  return key.length >= 8 && said.includes(key.slice(0, 18));
}

function buildStoryHint(accountId, history) {
  const beat = getCurrentStoryBeat(accountId);
  if (alreadyToldBeat(history, beat.text)) {
    return (
      `Сюжет фона (уже касалась — не повторяй дословно): «${beat.text}». ` +
      'Можно максимум лёгкая отсылка, если к месту. Не начинай с этого ответ.'
    );
  }
  // ~35% шанс подсветить сюжет в промпт на бытовой вопрос / иначе реже
  const rand = mulberry32(hashSeed(`arcHint:${accountId}:${mskDateKey()}:${(history || []).length}`));
  if (rand() > 0.45) return null;
  return (
    `Мелкий сюжет этих дней (фон, не тема каждого ответа): «${beat.text}». ` +
    'Если уместно (как день / что делаешь / просто болтовня) — можно вскользь одной короткой фразой. ' +
    'Не вываливай весь сюжет. Не начинай с этого, если он задал другой вопрос по делу.'
  );
}

/**
 * Несогласие / «не в настроении» — редко, по ситуации.
 */
function buildAttitudeHint(accountId, userMessage, opts = {}) {
  const msg = String(userMessage || '');
  if (!msg.trim()) return null;
  if (DIRECT_Q_RE.test(msg) && !OPINION_RE.test(msg)) {
    // на прямой факт-вопрос не юлим «не в настроении»
  }

  const period = timeStyle.getTimeStyle(undefined, accountId);
  const mood = String(opts.accountMood || opts.accountMoodHint || '').toLowerCase();
  const flash = String(opts.flash || '');
  const rand = mulberry32(hashSeed(`att:${accountId}:${mskDateKey()}:${msg.slice(0, 40)}`));

  const lowEnergy =
    flash === 'hurt' ||
    period?.id === 'wake_up' ||
    period?.id === 'going_to_bed' ||
    period?.id === 'late_evening' ||
    /tired|устал/.test(mood);

  // «не в настроении» — чаще при low energy
  const moodChance = lowEnergy ? 0.28 : 0.08;
  if (rand() < moodChance && !/\?/.test(msg.slice(0, 80))) {
    return (
      'Сейчас ты не особо в настроении: отвечай короче и суше обычного, без энтузиазма. ' +
      'Можно «ну не знаю», «потом», «хз». Без драмы и без «у меня депрессия». Не груби просто так.'
    );
  }

  // несогласие — только если он давит мнением (0t8: чуть чаще характер)
  if (OPINION_RE.test(msg) && rand() < 0.62) {
    return (
      'Он высказал мнение — можно коротко не согласиться или усомниться («не, мне кажется наоборот», «ну спорно)», «хз»). ' +
      'Одна фраза, без лекции и без спора на три абзаца. Если тема важная/обидная — мягче.'
    );
  }

  // лёгкая вредность без триггера — очень редко
  if (rand() < 0.14) {
    return (
      'Можно чуть с характером: лёгкий подкол или не поддакивать («ну не знаю насчёт этого)»). Коротко.'
    );
  }
  return null;
}

/**
 * Редкая забывчивость: путает неважное, без «прости я всё забыла».
 */
function buildForgetHint(accountId, history, userMessage) {
  const msg = String(userMessage || '');
  if (DIRECT_Q_RE.test(msg)) return null;
  if (/как\s+меня\s+зовут|мое\s+имя|как\s+тебя|где\s+ты\s+жив|чем\s+занима/i.test(msg)) return null;

  const recent = (Array.isArray(history) ? history : []).slice(-14);
  const recentBot = recent
    .filter((h) => h && h.role === 'assistant')
    .map((h) => String(h.content || ''))
    .join('\n');
  if (FORGET_MARK_RE.test(recentBot)) return null;

  const userBlob = recent
    .filter((h) => h && h.role === 'user')
    .map((h) => String(h.content || ''))
    .join('\n');

  // есть хоть какая-то бытовуха в истории
  const hasSoft =
    /(собак|кот|кошк|сериал|игр|футбол|барбер|работ|машин|кофе|пицц|ресторан|зал|качалк)/i.test(userBlob);
  if (!hasSoft) return null;

  const rand = mulberry32(hashSeed(`forget:${accountId}:${mskDateKey()}:${recent.length}`));
  if (rand() > 0.1) return null;

  const raw = (
    'РЕДКАЯ забывчивость: можно слегка перепутать или уточнить неважную бытовую мелочь из прошлого ' +
    '(не имя, не город, не работу/флип) — например «стой а ты не про … говорил?» / «или я путаю)». ' +
    'Одна короткая фраза. БЕЗ «прости что забыла», БЕЗ оправданий и эссе. Не на его прямой вопрос.'
  );
  // once-per-day gate is applied in buildLifeTextureHints with peerId
  return raw;
}

/**
 * Per-account оттенок «онлайна» к периоду суток.
 */
function getOnlineFlavor(accountId, periodId) {
  const rand = mulberry32(hashSeed(`online:${accountId}`));
  const styles = ['burst', 'slow', 'chatty', 'dry'];
  const style = styles[Math.floor(rand() * styles.length)];
  const map = {
    wake_up: {
      burst: 'Утром пишешь рывками: то коротко, то задержка — как только открыла глаза.',
      slow: 'Утром особенно медленная и немногословная.',
      chatty: 'Даже утром можешь чуть разговорчивее обычного, но всё равно сонная.',
      dry: 'Утром суше и короче, почти без скобочек.',
    },
    work: {
      burst: 'На «работе» отвечаешь урывками, иногда одной строкой.',
      slow: 'Сейчас занята — ответы короче, без болтовни.',
      chatty: 'Между делами можешь чуть живее отвлечься на переписку.',
      dry: 'Рабочий режим: коротко и по делу, без лишних эмоций.',
    },
    mid_day: {
      burst: 'Днём обычный темп, иногда внезапно короче.',
      slow: 'Днём спокойный ровный тон.',
      chatty: 'Днём можно чуть разговорнее.',
      dry: 'Днём без лишней воды.',
    },
    social_evening: {
      burst: 'Вечером живее и с инициативой, но не каждое сообщение вопросом.',
      slow: 'Вечером теплее, но не разгоняйся в эссе.',
      chatty: 'Вечером самый общительный режим — можно чуть длиннее обычного (всё ещё 1–2 фразы).',
      dry: 'Вечером живая, но без приторности.',
    },
    going_to_bed: {
      burst: 'Ночью почти не пишешь; если пишешь — обрывки.',
      slow: 'Ночью еле отвечает, очень коротко.',
      chatty: 'Даже ночью коротко — сонливость важнее болтовни.',
      dry: 'Ночью сухо и минимально.',
    },
    late_evening: {
      burst: 'Поздно: короче, можно «скоро спать».',
      slow: 'Поздно и спокойно, без разгона темы.',
      chatty: 'Ещё не спишь, но уже сворачиваешь разговор.',
      dry: 'Поздно — минимум слов.',
    },
  };
  const block = map[periodId] || map.mid_day;
  return block[style] || block.burst;
}

/**
 * Капля любовнобильности — редко, когда диалог уже живой и он не грубит.
 * Не путать с шаблонами «всегда рада общению».
 */
function buildAffectionHint(accountId, userMessage, history, opts = {}) {
  const hist = Array.isArray(history) ? history : [];
  if (accountId == null || hist.length < 8) return null;
  if (opts.flash === 'hurt' || opts.flash === 'annoyed') return null;
  if (opts.objectionHint || opts.campaignHint) return null;

  const msg = String(userMessage || '');
  if (/мошен|воркер|фейк|ты\s+бот|секс|шлюх|хозяин|сиськ|голая|маммонт|мамонт/i.test(msg)) {
    return null;
  }

  const recentBot = hist
    .filter((h) => h && h.role === 'assistant')
    .slice(-6)
    .map((h) => String(h.content || ''))
    .join('\n');
  if (/скучаю|обнимаю|милый|мне\s+с\s+тобой|приятно\s+что\s+написа|улыбнуло|соскуч/i.test(recentBot)) {
    return null;
  }

  const recentUser = hist
    .filter((h) => h && h.role === 'user')
    .slice(-5)
    .map((h) => String(h.content || ''))
    .join('\n');
  const heWarm =
    opts.flash === 'warm' ||
    /нрав|мил|красав|скучал|обнимаю|❤|❤️|🥰|😘|люблю|хорош|приятно\s+с\s+тобой|ты\s+класс/i.test(
      `${msg}\n${recentUser}`,
    );

  const rand = mulberry32(hashSeed(`aff:${accountId}:${mskDateKey()}:${hist.length}`));
  // База ~10%; если он теплый — чаще (~30%).
  if (rand() > (heWarm ? 0.3 : 0.1)) return null;

  return (
    'КАПЛЯ ТЕПЛА (любовнобильность): в ЭТОМ ответе можно одну короткую тёплую ноту к нему — ' +
    'как девушке, которой он симпатичен. Тон: «приятно что написал)», «ну ты милый)», ' +
    '«мне с тобой ок)», «улыбнуло)», «соскучилась чуть по переписке)» — на выбор, одна фраза. ' +
    'ЗАПРЕЩЕНО: «я тебя люблю», «дорожу тобой», «всегда рада общению», «ты мне так важен», эссе. ' +
    'Сначала по сути его сообщения, тепло — вкраплением. Не каждый ответ.'
  );
}

/**
 * Ритм печати: иногда суше, иногда с микро-деталью — без запретов.
 */
function buildChatRhythmHint(accountId, userMessage, history) {
  const hist = Array.isArray(history) ? history : [];
  if (hist.length < 3) return null;
  const msg = String(userMessage || '');
  if (/\?/.test(msg) && msg.length > 60) return null;
  const rand = mulberry32(hashSeed(`rhythm:${accountId}:${mskDateKey()}:${hist.length}`));
  const roll = rand();
  if (roll < 0.22) {
    return (
      'Ритм сейчас: ответь чуть суше и короче обычного — как будто параллельно чем-то занята. ' +
      'Одна фраза, без разгона.'
    );
  }
  if (roll < 0.4) {
    let detail = 'чай/сериал/улица/телефон';
    try {
      if (require('./timeStyle').isCoffeeOkHourMsk()) detail = 'чай/сериал/улица/кофе';
    } catch (_) {
      /* optional */
    }
    return (
      `Ритм сейчас: можно чуть живее — одна мелкая деталь из своего момента (${detail}), ` +
      'если не мешает ответу по сути. Не объявляй «я сейчас…» каждый раз.'
    );
  }
  if (roll < 0.52 && msg.length >= 20 && !/\?/.test(msg)) {
    return (
      'Можно начать с короткой реакции на его тон («хах», «ну да», «ого»), потом по сути — ' +
      'как в живом чате, не двумя эссе.'
    );
  }
  return null;
}

/**
 * Собирает 0–3 коротких хинта для generateReply.
 */
function buildLifeTextureHints(accountId, userMessage, history, opts = {}) {
  if (accountId == null) return [];
  const hints = [];
  const weekend = buildWeekendHint();
  if (weekend) hints.push(weekend);
  const story = buildStoryHint(accountId, history);
  if (story) hints.push(story);
  const attitude = buildAttitudeHint(accountId, userMessage, opts);
  if (attitude) hints.push(attitude);
  const rhythm = buildChatRhythmHint(accountId, userMessage, history);
  if (rhythm) hints.push(rhythm);
  // Тепло чуть важнее забывчивости — если оба выпали, affection раньше в списке.
  const affection = buildAffectionHint(accountId, userMessage, history, opts);
  if (affection) hints.push(affection);
  let forget = buildForgetHint(accountId, history, userMessage);
  try {
    forget = require('./humanIdeas10').maybeForgetHintOnce(
      accountId,
      opts.peerId,
      forget,
    );
  } catch (_) {
    /* optional */
  }
  if (forget) hints.push(forget);
  const askMedia = buildAskHisMediaHint(accountId, userMessage, history, opts);
  if (askMedia) hints.push(askMedia);
  // Не раздуваем system: максимум 3 текстурных хинта за ход.
  return hints.slice(0, 3);
}

module.exports = {
  buildLifeTextureHints,
  getCurrentStoryBeat,
  getOnlineFlavor,
  buildStoryHint,
  buildAttitudeHint,
  buildAffectionHint,
  buildForgetHint,
  buildWeekendHint,
  buildAskHisMediaHint,
  buildChatRhythmHint,
};
