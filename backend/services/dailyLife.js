/**
 * Режим дня: подъём/сон, «доброе утро» / «спокойной ночи», idle-pokes.
 * tgSendMessage / buffers / processBuffered / getAccountSettings — через configureDailyLife.
 */
const db = require('../db');
const { detectReplyLanguage } = require('./aiResponder');
const helpRequestNotifier = require('./helpRequestNotifier');
const timeStyle = require('./timeStyle');
const memoryTriggers = require('./memoryTriggers');
const {
  accountKey,
  accountLabel,
  getActiveClient,
  deactivateAccount,
  isRevokedSessionError,
} = require('./clientPool');
const {
  saveMessage,
  getDialogTail,
  hasUnansweredProactive,
} = require('./history');
const { WORK_TIMEZONE, sleep } = require('./timing');
const {
  isPeerBlacklisted,
  shouldSkipProactivePeer,
  isNeverContact,
  isDeletedUser,
  isPermanentSendError,
  retireUnreachablePeer,
} = require('./peers');

const SCAN_DIALOGS_LIMIT = 100;

let hooks = {
  getAccountSettings: null,
  tgSendMessage: null,
  bufferKey: null,
  getMessageBuffers: () => new Map(),
  getDeferredDialogs: () => new Map(),
  getProcessingInFlight: () => new Set(),
  extractIncomingText: null,
  processBufferedMessages: null,
};

function configureDailyLife(next) {
  hooks = { ...hooks, ...next };
}

// ---------------------------------------------------------------------------
// ПОЖЕЛАНИЯ «СПОКОЙНОЙ НОЧИ» / «ДОБРОЕ УТРО»
// На ГРАНИЦЕ рабочих часов бот пишет НЕархивным личным диалогам, с кем
// недавно общался (активность за GREETING_RECENT_DAYS дней):
//   день -> ночь  (наступает WORK_END_HOUR):   «спокойной ночи»
//   ночь -> день  (наступает WORK_START_HOUR):  «доброе утро»
// Ночью пишем ТОЛЬКО тем, где последнее слово за нами (разговор на паузе);
// непрочитанные вопросы ночью не трогаем. Если уже попрощались — молча уходим.
// Утром пишем «доброе утро» ВСЕМ недавним, и если человек написал ночью и
// ждёт ответа — СЛЕДОМ (вторым сообщением) отвечаем ему по теме.
// ---------------------------------------------------------------------------

// Варианты фраз (случайный выбор — чтобы не выглядело шаблонно).
const NIGHT_GREETINGS = [
  'спокойной ночи, сладких снов)',
  'ладно, спать пора, целую, споки',
  'всё, отрубаюсь, сладких снов, береги себя',
  'пойду спать, споки-споки, ты мне снись',
  'доброй ночи, до завтра, буду скучать',
  'споки) сладких снов',
  'спокойной ночи)',
  'всё я спать, спокойной)',
  'отключаюсь, споки',
  'глаза не держат, спокойной ночи)',
  'баиньки, до завтра)',
  'спокойной, пиши завтра)',
  'ладно споки, не скучай)',
  'спокойной ночи тебе)',
  'иду спать, сладких)',
  'всё, вырубаюсь, доброй ночи)',
  'споки-споки)',
  'спокойной ночи, обнимаю)',
  'пора в кровать, споки)',
  'до завтра, спокойной)',
];
const MORNING_GREETINGS = [
  'доброе утро, как спалось)',
  'утро доброе, соскучилась',
  'привееет, с добрым утром',
  'доброе, проснулась и сразу про тебя',
  'утречко доброе, береги себя)',
  'доброе утро)',
  'утречко)',
  'с добрым утром)',
  'доброе) как ты',
  'привет, доброе утро)',
  'проснулась, доброе)',
  'утречка тебе)',
  'доброе утро, солнышко)',
  'о проснулась, привет)',
  'доброе) соскучилась чуть',
  'утро) как спал',
  'хай, доброе утро)',
  'доброе утречко)',
  'только встала, доброе)',
  'с утречком)',
  // 0t17: живее, меньше «солнышко»-штампа
  'утро, кофе уже?)',
  'доброе) я ещё сонная',
  'хей, с утром)',
  'проснулась наконец)',
  'утречко, ты как)',
];

const NIGHT_GREETINGS_EN = [
  'good night, sweet dreams)',
  'alright, time to sleep, night night',
  'gonna pass out, sweet dreams, take care',
  'going to bed, night night, dream of me',
  'good night, see you tomorrow, gonna miss you',
  'night night)',
  'good night)',
  'im out, sleep well)',
  'crashing now, night)',
  'sweet dreams)',
  'gn, talk tomorrow)',
  'bedtime, night)',
  'good night, hugs)',
  'lights out, night night)',
  'sleep tight)',
];
const MORNING_GREETINGS_EN = [
  'good morning, how did you sleep)',
  'morning, missed you',
  'heyyy, good morning',
  'morning, woke up and thought of you',
  'good morning, take care)',
  'morning)',
  'good morning)',
  'hey, morning)',
  'just woke up, morning)',
  'gm)',
  'morning you)',
  'rise and shine kinda)',
  'good morning hey)',
  'woke up, hi)',
  'morning, how are you)',
];

const NIGHT_GREETINGS_DE = [
  'gute nacht, schlaf gut',
  'ok ich geh schlafen, gute nacht',
  'werd jetzt schlafen, träum was schönes',
  'gute nacht, bis morgen',
  'ich hau ab ins bett, gute nacht',
  'gute nacht)',
  'schlaft gut, bis morgen',
  'bin weg, gute nacht',
  'träum was schönes)',
  'gute n8)',
];
const MORNING_GREETINGS_DE = [
  'guten morgen, wie hast du geschlafen',
  'morgen, hab dich vermisst',
  'heyy guten morgen',
  'morgen, bin aufgewacht und an dich gedacht',
  'guten morgen, pass auf dich auf',
  'guten morgen)',
  'morgen)',
  'hey guten morgen)',
  'gerade aufgewacht, morgen)',
  'moin)',
];

const MORNING_BY_KIND = {
  robot: MORNING_GREETINGS,
  early: [
    'чё так рано вскочила, доброе утро)',
    'рано проснулась, привет',
    'не спалось, уже встала',
    'глаза сами открылись, доброе',
    'капец рано, доброе утро)',
    'ещё светло почти, а я уже тут)',
    'утречко) рано встала сегодня',
    'не выспалась, но уже доброе)',
    'будильник зверь, доброе)',
    'с добрым) совсем рано',
  ],
  normal: [
    'доброе утро, как спалось)',
    'утро доброе, соскучилась',
    'привееет, с добрым утром',
    'доброе, проснулась и сразу про тебя',
    'доброе утро)',
    'утречко тебе)',
    'с добрым утром)',
    'привет, доброе)',
    'проснулась, хай)',
    'доброе) как ночь',
    'утречка)',
    'доброе утречко, как ты)',
  ],
  oversleep: [
    'проспала жесть, только встала',
    'заспалась, доброе',
    'сори, проспала',
    'только глаза открыла, заспалась',
    'доброе) я спала крепко',
    'упс проспала, привет)',
    'только выползла, доброе)',
    'заспалась нормально, утро)',
  ],
  lunch: [
    'я только к обеду глаза открыла ахах',
    'проспала до обеда, привет',
    'в обед встала, доброе)',
    'доброе, я к обеду только выползла',
    'доброе) день уже в разгаре а я тока',
    'встала к обеду стыдно)',
    'полуденное утро моё)',
  ],
  late: [
    'только встала, заспалась нормально',
    'доброе, почти до обеда спала',
    'проспала почти до обеда, привет',
    'доброе) долго спала сегодня',
    'вылезла наконец, привет)',
  ],
};

const NIGHT_BY_KIND = {
  robot: NIGHT_GREETINGS,
  early: [
    'что-то меня рубит, пойду спать',
    'глаза закрываются, споки',
    'сегодня рано отрубаюсь, спокойной',
    'спокойной ночи) рано сегодня',
    'уже клонит, споки)',
    'пойду раньше, спокойной)',
    'глаза тяжелые, доброй ночи)',
    'всё, спать, споки-споки)',
  ],
  half_past: [
    'не хотела спать, но уже полпервого, споки',
    'ещё бы посидела, но глаза слипаются',
    'ладно всё, засиделась, спокойной ночи)',
    'полпервого, спокойной)',
    'пора, споки)',
    'засиделась чуть, спокойной ночи)',
    'глаза липнут, доброй ночи)',
  ],
  late: [
    'что-то не спалось, но всё отрубаюсь',
    'засиделась, уже поздно, споки',
    'глаза сами закрываются, спокойной',
    'уже поздно, спокойной ночи)',
    'всё отключаюсь, споки)',
    'ночь, спокойной)',
    'сладких снов, я спать)',
  ],
  three_am: [
    'уже часа три, всё я спать',
    'досиделась до трёх, спокойной',
    'не хотела ложиться и вот, отрубаюсь',
    'три часа жесть, споки)',
    'досиделась, спокойной ночи)',
    'всё хватит, доброй ночи)',
  ],
};

const MORNING_BY_KIND_EN = {
  robot: MORNING_GREETINGS_EN,
  early: [
    'woke up so early lol, good morning)',
    'up early, hey',
    'couldnt sleep, already awake',
    'eyes just opened, morning',
    'way too early, morning)',
    'sunrise club somehow, hey)',
    'up already, good morning)',
  ],
  normal: [
    'good morning, how did you sleep)',
    'morning, missed you',
    'heyyy, good morning',
    'morning, woke up and thought of you',
    'good morning)',
    'morning)',
    'hey, morning)',
    'just woke up, hi)',
    'gm)',
  ],
  oversleep: [
    'overslept hard, just woke up',
    'slept in, morning',
    'sorry, overslept',
    'just opened my eyes, slept in',
    'whoops overslept, hey)',
    'crawled out of bed, morning)',
  ],
  lunch: [
    'literally woke up around lunch haha',
    'slept till lunch, hey',
    'got up at lunch, morning)',
    'morning, only crawled out around lunch',
    'lunch oclock wake up, hi)',
  ],
  late: [
    'just woke up, slept in properly',
    'morning, almost slept till lunch',
    'slept almost till lunch, hey',
    'finally up, morning)',
  ],
};

const NIGHT_BY_KIND_EN = {
  robot: NIGHT_GREETINGS_EN,
  early: [
    'getting sleepy, gonna go to bed',
    'eyes closing, night night',
    'hitting the bed early tonight, good night',
    'turning in early, night)',
    'sleepy already, good night)',
  ],
  half_past: [
    'didnt want to sleep but its already half past twelve, night',
    'could stay up but my eyes are closing',
    'alright im done, stayed up too late, good night)',
    'half past twelve, night night)',
  ],
  late: [
    'couldnt sleep but im crashing now',
    'stayed up too late, night',
    'eyes closing on their own, good night',
    'late already, gn)',
  ],
  three_am: [
    'its like 3am, im going to sleep',
    'stayed up till three, good night',
    'didnt want to go to bed and here we are, crashing',
    '3am oops, night)',
  ],
};

function guessGreetingLang(text) {
  if (!text || typeof text !== 'string') return null;
  const letters = text.replace(/[^a-zA-ZäöüÄÖÜßа-яёА-ЯЁ]/gi, '');
  if (letters.length < 2) return null;
  const cyr = (letters.match(/[а-яёА-ЯЁ]/gi) || []).length;
  const lat = (letters.match(/[a-zA-ZäöüÄÖÜß]/g) || []).length;
  if (lat > cyr) return detectReplyLanguage(text, []);
  return 'ru';
}

function pickGreetingPhrases(kind, mood, lang) {
  if (lang === 'en') {
    if (kind === 'night') return NIGHT_BY_KIND_EN[mood] || NIGHT_GREETINGS_EN;
    return MORNING_BY_KIND_EN[mood] || MORNING_GREETINGS_EN;
  }
  if (lang === 'de') {
    if (kind === 'night') return NIGHT_GREETINGS_DE;
    return MORNING_GREETINGS_DE;
  }
  if (kind === 'night') return NIGHT_BY_KIND[mood] || NIGHT_GREETINGS;
  return MORNING_BY_KIND[mood] || MORNING_GREETINGS;
}

async function resolveGreetingLang(client, sender, message) {
  const lastText = typeof message?.message === 'string' ? message.message : '';
  if (!message?.out) {
    return guessGreetingLang(lastText) || 'ru';
  }
  try {
    const msgs = await client.getMessages(sender, { limit: 12 });
    for (const m of msgs) {
      if (m.out) continue;
      const text = typeof m.message === 'string' ? m.message : '';
      const lang = guessGreetingLang(text);
      if (lang) return lang;
    }
  } catch (_) {
    // ignore
  }
  return guessGreetingLang(lastText) || 'ru';
}

const WAKE_ROLLS = [
  { id: 'robot', weight: 12, from: 9 * 60, to: 9 * 60 + 8 },
  { id: 'early', weight: 20, from: 6 * 60 + 15, to: 8 * 60 + 20 },
  { id: 'normal', weight: 16, from: 8 * 60, to: 10 * 60 },
  { id: 'oversleep', weight: 20, from: 10 * 60, to: 11 * 60 + 50 },
  { id: 'late', weight: 14, from: 11 * 60, to: 12 * 60 + 40 },
  { id: 'lunch', weight: 18, from: 12 * 60, to: 14 * 60 + 30 },
];
const SLEEP_ROLLS = [
  { id: 'robot', weight: 12, from: 23 * 60, to: 23 * 60 + 8 },
  { id: 'early', weight: 16, from: 22 * 60, to: 22 * 60 + 50 },
  { id: 'half_past', weight: 22, from: 23 * 60 + 20, to: 24 * 60 + 15 },
  { id: 'late', weight: 22, from: 24 * 60 + 20, to: 26 * 60 },
  { id: 'three_am', weight: 18, from: 26 * 60 + 20, to: 27 * 60 + 40 },
];

const dailyLifeByAccount = new Map();

// Кому писать: диалоги с активностью за последние N дней.
const GREETING_RECENT_DAYS = 3;
// Максимум приветствий за один переход (антифлуд Telegram).
const GREETING_MAX_DIALOGS = 22;
const GREETING_SKIP_IF_BOT_WROTE_HOURS = 4;
// Если уже попрощались за это окно — ночью молча уходим, без второго «спокойной».
const FAREWELL_LOOKBACK_HOURS = 10;

/** Прощание / «иду спать» — не слать повторную «спокойной ночи» по таймеру. */
function looksLikeFarewell(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 280) return false;
  if (
    /спокойн(ой|ая)\s*ночи|доброй\s*ночи|споки|сладких\s*снов|отрубаюсь|пойду\s*спать|иду\s*спать|пора\s*спать|я\s*спать|спать\s*пора|глаза\s*(слипа|закрыв)|засыпаю|ложусь(\s*спать)?|до\s*завтра.*(спать|ночи)|good\s*night|night\s*night|\bgn\b|sweet\s*dreams|going\s*to\s*(bed|sleep)|off\s*to\s*bed|gonna\s*(sleep|pass\s*out)|gute\s*nacht|schlaf\s*gut|träum\s*was|werd(?:e)?\s*jetzt\s*schlafen|ich\s*geh(?:e)?\s*schlafen/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /^(спокойной|доброй|споки|споки-споки|бай|bb|bye|good night|gute nacht)([\s).!,…♥❤💕]*)$/i.test(t)
  ) {
    return true;
  }
  return false;
}

async function dialogAlreadySaidGoodbye(accountId, peerId, hours = FAREWELL_LOOKBACK_HOURS) {
  const mins = Math.max(1, Math.floor(Number(hours) * 60));
  const [rows] = await db.execute(
    `SELECT content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
       AND created_at > NOW() - INTERVAL ${mins} MINUTE
     ORDER BY id DESC
     LIMIT 24`,
    [accountId, String(peerId)],
  );
  return rows.some((row) => looksLikeFarewell(row.content));
}

// Голосовые заготовки глубокой ночью звучат дико: человек уже лёг, а бот
// присылает голосовое в 1:30. Тихие часы — по Москве.
async function botWroteWithin(accountId, peerId, hours) {
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND created_at > NOW() - INTERVAL ${Number(hours) * 60} MINUTE
     LIMIT 1`,
    [accountId, peerId],
  );
  return rows.length > 0;
}

// Защита от параллельной рассылки приветствий.
const greetingInFlight = new Set();

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function weightedRoll(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function moscowClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WORK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(read('hour')) % 24;
  const minute = Number(read('minute'));
  return {
    dateKey: `${read('year')}-${read('month')}-${read('day')}`,
    minutes: hour * 60 + minute,
  };
}

function formatClock(totalMinutes) {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function crossedMinute(lastMin, nowMin, target) {
  if (lastMin === nowMin) return false;
  if (nowMin > lastMin) return target > lastMin && target <= nowMin;
  return target > lastMin || target <= nowMin;
}

function rollDailyLife(dateKey) {
  const wake = weightedRoll(WAKE_ROLLS);
  let sleep = weightedRoll(SLEEP_ROLLS);
  const wakeMin = randInt(wake.from, wake.to);
  let sleepMin = randInt(sleep.from, sleep.to);
  let sleepKind = sleep.id;

  // Сон всегда заметно позже подъёма (минимум ~8 часов «бодрствования»),
  // иначе выпадало «встала в 13:00 / легла в 22:05» слишком коротко
  // или подъём оказывался после сна в одном дне.
  let guard = 0;
  while (sleepMin - wakeMin < 8 * 60 && guard < 10) {
    sleep = weightedRoll(SLEEP_ROLLS);
    sleepMin = randInt(sleep.from, sleep.to);
    sleepKind = sleep.id;
    guard += 1;
  }
  if (sleepMin - wakeMin < 8 * 60) {
    sleepMin = wakeMin + 8 * 60 + randInt(30, 180);
    sleepKind = sleepMin >= 26 * 60 ? 'three_am' : sleepMin >= 24 * 60 ? 'late' : 'half_past';
  }

  // Дневной «пэк» — сама пишет, если он затих (инициатива).
  // 0t2: третье окно около полудня — чаще напоминает о себе.
  const lateMorningMin = randInt(11 * 60, 12 * 60 + 40);
  const afternoonMin = randInt(13 * 60 + 30, 16 * 60 + 30);
  const eveningMin = randInt(18 * 60 + 30, 21 * 60);
  return {
    dateKey,
    wakeMin,
    sleepMin,
    wakeKind: wake.id,
    sleepKind,
    morningSent: false,
    nightSent: false,
    lateMorningMin,
    lateMorningSent: false,
    afternoonMin,
    afternoonSent: false,
    eveningMin,
    eveningSent: false,
    lastMin: null,
    booted: true,
  };
}

function ensureDailyLife(accountId) {
  const key = accountKey(accountId);
  const now = moscowClock();
  let life = dailyLifeByAccount.get(key);
  if (!life || life.dateKey !== now.dateKey) {
    const carryNight = life && !life.nightSent && life.sleepMin >= 24 * 60
      ? { min: life.sleepMin - 24 * 60, kind: life.sleepKind }
      : life?.carryNight && !life.carryNight.sent
        ? life.carryNight
        : null;
    const lastMin = life ? life.lastMin : null;
    life = rollDailyLife(now.dateKey);
    life.carryNight = carryNight;
    life.lastMin = lastMin;
    life.booted = !lastMin && lastMin !== 0;
    dailyLifeByAccount.set(key, life);
    console.log(
      `[${accountLabel(accountId)}] Режим дня: подъём ${formatClock(life.wakeMin)} (${life.wakeKind}), сон ${formatClock(life.sleepMin)} (${life.sleepKind}).`,
    );
  }
  return life;
}

function tickDailyLife(accountId) {
  const life = ensureDailyLife(accountId);
  const now = moscowClock();

  if (life.booted || life.lastMin == null) {
    life.booted = false;
    const nowM = now.minutes;
    // 0t3: один catch-up — самое позднее прошедшее окно.
    // Три параллельных setTimeout раньше молча скипались (greetingInFlight).
    const windows = [
      ['lateMorningSent', 'lateMorningMin'],
      ['afternoonSent', 'afternoonMin'],
      ['eveningSent', 'eveningMin'],
    ];
    let pickFlag = null;
    for (const [flag, minKey] of windows) {
      if (life[flag]) continue;
      if (life[minKey] == null) continue;
      if (nowM >= life[minKey]) pickFlag = flag;
    }
    for (const [flag, minKey] of windows) {
      if (life[minKey] != null && nowM >= life[minKey] && flag !== pickFlag) {
        life[flag] = true;
      }
    }
    if (pickFlag) {
      life[pickFlag] = true;
      setTimeout(() => {
        sendIdlePokes(accountId).catch((err) => {
          console.error(
            `[${accountLabel(accountId)}] Ошибка idle catch-up:`,
            err.message,
          );
        });
      }, 8000 + Math.random() * 16000);
    }
    life.lastMin = nowM;
    return;
  }

  const lastMin = life.lastMin;
  if (!life.morningSent && crossedMinute(lastMin, now.minutes, life.wakeMin)) {
    life.morningSent = true;
    sendGreetings(accountId, 'morning', life.wakeKind).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка рассылки доброго утра:`,
        err.message,
      );
    });
  }

  if (
    !life.lateMorningSent &&
    life.lateMorningMin != null &&
    crossedMinute(lastMin, now.minutes, life.lateMorningMin)
  ) {
    life.lateMorningSent = true;
    sendIdlePokes(accountId).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка дневной инициативы (утро):`,
        err.message,
      );
    });
  }

  if (
    !life.afternoonSent &&
    life.afternoonMin != null &&
    crossedMinute(lastMin, now.minutes, life.afternoonMin)
  ) {
    life.afternoonSent = true;
    sendIdlePokes(accountId).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка дневной инициативы:`,
        err.message,
      );
    });
  }

  if (
    !life.eveningSent &&
    life.eveningMin != null &&
    crossedMinute(lastMin, now.minutes, life.eveningMin)
  ) {
    life.eveningSent = true;
    sendIdlePokes(accountId).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка вечерней инициативы:`,
        err.message,
      );
    });
  }

  const sameDaySleep = life.sleepMin < 24 * 60 ? life.sleepMin : null;
  if (!life.nightSent && sameDaySleep != null && crossedMinute(lastMin, now.minutes, sameDaySleep)) {
    life.nightSent = true;
    sendGreetings(accountId, 'night', life.sleepKind).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка рассылки спокойной ночи:`,
        err.message,
      );
    });
  }

  if (life.carryNight && !life.carryNight.sent && crossedMinute(lastMin, now.minutes, life.carryNight.min)) {
    life.carryNight.sent = true;
    life.nightSent = true;
    sendGreetings(accountId, 'night', life.carryNight.kind).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка рассылки спокойной ночи (после полуночи):`,
        err.message,
      );
    });
  }

  life.lastMin = now.minutes;
}

/**
 * Рассылает приветствие ('night' | 'morning') недавним активным диалогам.
 */

const IDLE_POKE_RU = [
  'ку, как ты там)',
  'ну что молчишь)',
  'хех ты где)',
  'скучно без тебя немного)',
  'напиши как там у тебя)',
  'как день проходит?)',
  'я тут в телефоне, а ты чем занят?)',
  'эй, ты ещё на связи?)',
  'подумала о тебе — как ты?)',
  'не пропади совсем)',
  'ну ты живой там?)',
  'мне скучно, напиши)',
  'чем занят сейчас?)',
  'я на связи, если что)',
];
const IDLE_POKE_RU_COFFEE = 'я тут кофе пью, а ты чем занят?)';
const IDLE_POKE_RU_EVENING = [
  'как вечер?)',
  'ты ещё не спишь?)',
  'я ещё тут — как ты?)',
];
const IDLE_POKE_EN = [
  'hey you alive?',
  'yo',
  'missed you a bit)',
  'u there?',
];
const IDLE_POKE_DE = [
  'hey bist du noch da?',
  'yo',
  'hab dich ein bisschen vermisst',
  'alles gut bei dir?',
];

/**
 * Днём сама пишет тем, кто давно молчит (последнее слово было за нами).
 * Инициатива без «доброго утра» — живой пэк.
 */
async function sendIdlePokes(accountId) {
  if (greetingInFlight.has(accountId)) return;
  greetingInFlight.add(accountId);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;
    const settings = await hooks.getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;

    let dialogs;
    try {
      dialogs = await client.getDialogs({ limit: 60 });
    } catch (e) {
      return;
    }

    const bufferKey = hooks.bufferKey;
    const processingInFlight = hooks.getProcessingInFlight();
    const deferredDialogs = hooks.getDeferredDialogs();
    const tgSendMessage = hooks.tgSendMessage;

    let sent = 0;
    for (const dialog of dialogs) {
      if (sent >= 10) break;
      if (!dialog.isUser || dialog.archived) continue;
      const message = dialog.message;
      if (!message || !message.out) continue; // последнее слово за нами
      const ageH = (Date.now() / 1000 - (message.date || 0)) / 3600;
      // 0t2: раньше с 3ч — лиды остывали; теперь с ~1.5ч, потолок 36ч.
      if (ageH < 1.5 || ageH > 36) continue;

      const sender = dialog.entity;
      if (!sender || sender.bot || sender.self || isDeletedUser(sender) || isNeverContact(sender)) continue;
      const peerId = String(sender.id);
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) continue;
      if (await shouldSkipProactivePeer(client, sender)) continue;
      if (processingInFlight.has(bufferKey(accountId, peerId))) continue;
      if (deferredDialogs.has(bufferKey(accountId, peerId))) continue;
      if (await dialogAlreadySaidGoodbye(accountId, peerId)) continue;

      const tail = await getDialogTail(accountId, peerId);
      if (!tail.hasIncoming) continue;
      if (await hasUnansweredProactive(accountId, peerId)) continue;

      const lang = await resolveGreetingLang(client, sender, message);
      const memPoke = lang === 'en' || lang === 'de' ? null : await memoryTriggers.pickMemoryPoke(accountId, peerId);
      let bank =
        lang === 'en'
          ? IDLE_POKE_EN
          : lang === 'de'
            ? IDLE_POKE_DE
            : timeStyle.isCoffeeOkHourMsk()
              ? [...IDLE_POKE_RU, IDLE_POKE_RU_COFFEE]
              : [...IDLE_POKE_RU];
      // Вечер MSK — чуть другие покe.
      try {
        const h = new Date(Date.now() + 3 * 3600 * 1000).getUTCHours();
        if (lang === 'ru' && h >= 19 && h <= 23) bank = [...bank, ...IDLE_POKE_RU_EVENING];
      } catch (_) {}
      let phrase = memPoke?.phrase || bank[Math.floor(Math.random() * bank.length)];
      // 0t7: если знаем имя — иногда обратиться.
      if (!memPoke && lang !== 'en' && lang !== 'de' && Math.random() < 0.35) {
        try {
          const facts = await memoryTriggers.listPeerFacts(accountId, peerId);
          const nameF = (facts || []).find((f) => f.fact_type === 'name');
          const nm = String(nameF?.fact_text || '')
            .trim()
            .split(/\s+/)[0];
          if (nm && /^[А-ЯЁA-Z][а-яёa-zЁё]{1,14}$/.test(nm)) {
            const named = [
              `${nm}, ты как там)`,
              `${nm}, не пропал?)`,
              `эй ${nm}, живой?)`,
              `${nm}, чем занят?)`,
            ];
            phrase = named[Math.floor(Math.random() * named.length)];
          }
        } catch (_) {}
      }
      const senderName = sender.username || sender.firstName || peerId;
      try {
        await sleep(2500 + Math.random() * 4000);
        await tgSendMessage(client, sender, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        if (memPoke?.id) memoryTriggers.markFollowedUp(memPoke.id).catch(() => {});
        sent += 1;
        console.log(
          `[${accountLabel(accountId)}] Дневная инициатива → ${senderName}: "${phrase}"` +
            (memPoke ? ' (память)' : ''),
        );
      } catch (_) {}
    }
  } finally {
    greetingInFlight.delete(accountId);
  }
}

async function sendGreetings(accountId, kind, mood) {
  if (greetingInFlight.has(accountId)) return;
  greetingInFlight.add(accountId);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;

    const settings = await hooks.getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;

    let dialogs;
    try {
      dialogs = await client.getDialogs({ limit: SCAN_DIALOGS_LIMIT });
    } catch (e) {
      console.error(
        `[${accountLabel(accountId)}] Приветствия: не удалось получить диалоги:`,
        e.errorMessage || e.message,
      );
      if (isRevokedSessionError(e)) {
        console.error(
          `[${accountLabel(accountId)}] Сессия отозвана — останавливаю аккаунт, нужна повторная авторизация.`,
        );
        deactivateAccount(accountId).catch(() => {});
      }
      return;
    }

    const bufferKey = hooks.bufferKey;
    const messageBuffers = hooks.getMessageBuffers();
    const deferredDialogs = hooks.getDeferredDialogs();
    const processingInFlight = hooks.getProcessingInFlight();
    const tgSendMessage = hooks.tgSendMessage;
    const extractIncomingText = hooks.extractIncomingText;
    const processBufferedMessages = hooks.processBufferedMessages;

    const nowSec = Math.floor(Date.now() / 1000);
    const recentThreshold = nowSec - GREETING_RECENT_DAYS * 24 * 3600;
    let sent = 0;

    // Чтобы антифлуд не бил всегда по одним и тем же «хвостовым» диалогам.
    for (let i = dialogs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = dialogs[i];
      dialogs[i] = dialogs[j];
      dialogs[j] = tmp;
    }

    for (const dialog of dialogs) {
      if (sent >= GREETING_MAX_DIALOGS) break;

      if (!dialog.isUser) continue;
      if (dialog.archived) continue;

      const message = dialog.message;
      if (!message) continue;
      // Только недавняя активность (мы правда общались).
      if (!message.date || message.date < recentThreshold) continue;

      // Есть ли непрочитанный вопрос (последнее сообщение — ИХ, входящее).
      const hasUnanswered = !message.out;

      // Ночью пишем «спокойной ночи» ТОЛЬКО тем, где последнее слово за нами
      // (разговор на паузе). Непрочитанные ночью не трогаем — утром ответим.
      // Утром пишем «доброе утро» ВСЕМ недавним; если есть непрочитанный
      // вопрос — следом идёт обычный ответ по теме.
      if (kind === 'night' && hasUnanswered) continue;

      const sender = dialog.entity;
      if (!sender || sender.bot || sender.self || isDeletedUser(sender) || isNeverContact(sender)) continue;

      const peerId = String(sender.id);
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) continue;
      if (await shouldSkipProactivePeer(client, sender)) continue;
      if (messageBuffers.has(bufferKey(accountId, peerId))) continue;
      // По диалогу с активной паузой занятости приветствие не шлём.
      if (deferredDialogs.has(bufferKey(accountId, peerId))) continue;
      // Диалог уже обрабатывается (генерация ответа/пауза) — не мешаем ему.
      if (processingInFlight.has(bufferKey(accountId, peerId))) continue;

      // Не пишем «доброе/спокойной» в чаты, где от человека не было ни одного
      // входящего — только наши рассылки.
      const tail = await getDialogTail(accountId, peerId);
      if (!tail.hasIncoming) continue;
      if (await hasUnansweredProactive(accountId, peerId)) continue;
      // Уже переписывались недавно — «доброе утро / проспала» после свежего ответа звучит как бот.
      if (kind === 'morning' && (await botWroteWithin(accountId, peerId, GREETING_SKIP_IF_BOT_WROTE_HOURS))) continue;
      // Собеседник (или мы) уже попрощались — по режиму сна просто молча уходим.
      if (kind === 'night') {
        const lastText = message.message || '';
        if (looksLikeFarewell(lastText) || (await dialogAlreadySaidGoodbye(accountId, peerId))) {
          continue;
        }
      }

      const senderName = sender.username || sender.firstName || peerId;
      const lang = await resolveGreetingLang(client, sender, message);
      const phrases = pickGreetingPhrases(kind, mood, lang);
      const phrase = pickRandom(phrases);
      try {
        // Небольшая человеческая пауза между отправками (антифлуд).
        await sleep(2000 + Math.random() * 4000);
        await tgSendMessage(client, sender, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        sent += 1;
      } catch (e) {
        console.error(
          `[${accountLabel(accountId)}] Не удалось отправить приветствие ${senderName}:`,
          e.errorMessage || e.message,
        );
        if (isPermanentSendError(e)) {
          await retireUnreachablePeer(
            client,
            accountId,
            peerId,
            sender,
            e.errorMessage || e.message || 'unreachable',
          );
        }
        continue;
      }

      // Утром: если человек написал ночью и ждёт ответа — СЛЕДОМ за «доброе
      // утро» отвечаем ему по теме (маленькая пауза, чтобы шло двумя
      // отдельными сообщениями, а не слитно).
      if (kind === 'morning' && hasUnanswered) {
        let text;
        try {
          text = await extractIncomingText(accountId, message);
        } catch (_) {
          text = message.message || '';
        }
        if (text && text.trim()) {
          console.log(
            `[${accountLabel(accountId)}] Утро: отвечаю на ночное сообщение ${senderName}.`,
          );
          await sleep(1500 + Math.random() * 2500);
          await processBufferedMessages(
            accountId,
            sender,
            message,
            peerId,
            senderName,
            text.trim(),
          );
        }
      }
    }

    if (sent > 0) {
      const label = kind === 'night' ? 'спокойной ночи' : 'доброе утро';
      console.log(
        `[${accountLabel(accountId)}] Разослано «${label}» диалогам — ${sent}.`,
      );
    }
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Ошибка рассылки приветствий:`,
      err.message,
    );
  } finally {
    greetingInFlight.delete(accountId);
  }
}

function clearDailyLifeAccount(accountId) {
  dailyLifeByAccount.delete(accountId);
  greetingInFlight.delete(accountId);
}

module.exports = {
  configureDailyLife,
  ensureDailyLife,
  tickDailyLife,
  moscowClock,
  formatClock,
  looksLikeFarewell,
  dialogAlreadySaidGoodbye,
  clearDailyLifeAccount,
  sendGreetings,
  sendIdlePokes,
};
