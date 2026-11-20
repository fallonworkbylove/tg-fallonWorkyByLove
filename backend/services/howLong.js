/**
 * How-long helpers: «сколько дней на дв» question / parse / archive threshold.
 */
const db = require('../db');

const howLongInFlight = new Set();

function bufferKey(accountId, peerId) {
  return require('./inbound').bufferKey(accountId, peerId);
}

// Все варианты содержат «на дв?» — по этой подстроке ищем вопрос в истории.
const HOWLONG_QUESTIONS = [
  'слушай, а ты скок дней уже сидишь на дв?',
  'кстати, а сколько дней ты уже на дв?',
  'а скок ты уже дней на дв?',
  // Маркер «на дв?» обязателен — иначе wasHowLongAsked / отсев не видят вопрос.
  'а ты давно на дв? или только зашёл?',
  'интересно скок ты уже дней на дв?',
  'хех а скок примерно уже дней на дв?',
  'ну и скок ты уже тут дней на дв?',
];
const HOWLONG_MARKER = 'на дв?';
const HOWLONG_LEGACY_MARKER = 'давно тут сидишь';

function buildHowLongQuestion() {
  return HOWLONG_QUESTIONS[Math.floor(Math.random() * HOWLONG_QUESTIONS.length)];
}

// Вопрос — 3-м сообщением бота; если в тот ход нельзя (ответ уже с вопросом,
// голосовое, медиа, он сам что-то спросил) — ещё несколько ходов, дальше не спрашиваем.
const HOWLONG_BOT_MSGS_FROM = 2;
// Раньше окно было до 6 реплик — часто не успевали спросить (вопросы/медиа
// откладывали ход). Держим шире, пока диалог свежий.
const HOWLONG_BOT_MSGS_TO = 12;
// Только новые диалоги: первое сообщение не старше этого.
const HOWLONG_NEW_DIALOG_HOURS = 72;
/** ≥3 недель на дв → архив + funnel «отсев». */
const HOWLONG_ARCHIVE_DAYS = 21;

function isHowLongQuestion(content) {
  const c = String(content || '');
  return c.includes(HOWLONG_MARKER) || c.includes(HOWLONG_LEGACY_MARKER);
}

/** Все шаблоны обязаны нести маркер — иначе отсев/архив слепнут. */
function assertHowLongMarkers() {
  for (const q of HOWLONG_QUESTIONS) {
    if (!isHowLongQuestion(q)) {
      throw new Error(`howLong template missing marker: ${q}`);
    }
  }
}
assertHowLongMarkers();

async function wasHowLongAsked(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND (content LIKE ? OR content LIKE ?)
     LIMIT 1`,
    [accountId, peerId, `%${HOWLONG_MARKER}%`, `%${HOWLONG_LEGACY_MARKER}%`],
  );
  return rows.length > 0;
}

async function getHowLongDialogStats(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT
       SUM(role = 'assistant' AND content NOT LIKE '[реакция:%' AND content NOT LIKE '%*') AS bot_msgs,
       TIMESTAMPDIFF(HOUR, MIN(created_at), NOW()) AS age_hours
     FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?`,
    [accountId, peerId],
  );
  const row = rows[0] || {};
  return { botMsgs: Number(row.bot_msgs) || 0, ageHours: row.age_hours == null ? null : Number(row.age_hours) };
}

/**
 * Входящее всё ещё в окне ответа на «сколько на дв?»:
 * после вопроса ещё не было user-сообщения с распознанным сроком
 * («хз» / «а ты?» не закрывают гейт — иначе «месяц» следующим ходом мимо отсева).
 */
function isAnswerToHowLong(history) {
  const list = Array.isArray(history) ? history : [];
  let foundHowLong = false;
  let sawStayAnswer = false;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const h = list[i];
    if (!h) continue;
    if (h.role === 'assistant' && isHowLongQuestion(h.content)) {
      foundHowLong = true;
      break;
    }
    if (h.role === 'user' && parseStayDays(h.content) != null) {
      sawStayAnswer = true;
    }
  }
  return foundHowLong && !sawStayAnswer;
}

const STAY_NUM_WORDS = {
  полтора: 1.5,
  полторы: 1.5,
  одну: 1,
  один: 1,
  одна: 1,
  две: 2,
  два: 2,
  пару: 2,
  парочку: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  несколько: 3,
};
const STAY_NUM = `(\\d+(?:[.,]\\d+)?|${Object.keys(STAY_NUM_WORDS).join('|')})`;
const STAY_UNITS = [
  { re: '(?<![а-я])год[а-я]*|(?<![а-я])лет(?![а-я])', days: 365 },
  { re: 'полгода|пол\\s+года', days: 180, noNum: true },
  { re: 'месяц[а-я]*|мес(?=[^а-я]|$)', days: 30 },
  { re: 'недел[а-я]*|нед(?=[^а-я]|$)', days: 7 },
  { re: 'дн[а-я]*|день|сут[а-я]*', days: 1 },
];

function stayNum(raw) {
  if (raw == null) return null;
  const w = String(raw).toLowerCase();
  if (STAY_NUM_WORDS[w] != null) return STAY_NUM_WORDS[w];
  const n = parseFloat(w.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Срезать обёртки [уточнение…]: / [Голосовое]: / [ответ на…]: */
function stripStayMeta(text) {
  let t = String(text || '');
  for (let i = 0; i < 6; i += 1) {
    const next = t
      .replace(/^\[[^\]]*\]:\s*/i, '')
      .replace(/^\[(?:голосовое|voice|фото|кружок|видео)[^\]]*\]\s*/i, '');
    if (next === t) break;
    t = next;
  }
  return t;
}

/** Граница слова для кириллицы (JS \b не видит а-я). */
const WB = '(?<![а-я0-9])';
const WE = '(?![а-я0-9])';

/**
 * Сколько дней он на платформе, по его ответу. null — совсем не про срок.
 * «месяц» → 30, «две недели» → 14, «дня 3» → 3, «20» (на вопрос про дни) → 20.
 */
function parseStayDays(text) {
  let t = stripStayMeta(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Возраст / стаж не про дв: «мне 25 лет», «учёба 5 лет», «работаю 3 года».
    .replace(/мне\s+\d+\s*(лет|год[а-я]*)?/g, ' ')
    .replace(/(?:учёб[а-я]*|учеба|работ[а-я]*|стаж[а-я]*|живу|прожил[а-я]*)\s+\d+\s*(лет|год[а-я]*)/g, ' ')
    .replace(/\d+\s*(лет|год[а-я]*)\s*(?:учёб|учеб|работ|стаж|в\s+школ|в\s+универ)/g, ' ')
    .replace(/[😂😁🙂😅🤣😉😊🔥❤️💕💜]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;

  // Совсем не ответ про срок — не выдумываем.
  if (
    /^(покажи|скинь|отправь|запиши|привет|ку|хай)(?![а-я])/.test(t) ||
    /^(а\s+ты|а\s+сама|откуда|как\s+дела|что\s+делаешь)/.test(t)
  ) {
    if (!/\d|день|дн|недел|мес|год|лет|давно|недавно|вчера|сегодня/.test(t)) {
      return null;
    }
  }

  // «с лета» / «с прошлого года».
  if (
    new RegExp(`${WB}с\\s+(лета|весны|зимы|осени)${WE}`).test(t) ||
    new RegExp(`${WB}с\\s+прошлого\\s+год`).test(t)
  ) {
    return 90;
  }

  // Новичок / коротко.
  if (
    /(только\s+(что|вот)?\s*(зарегал|зарегистр|скачал|зашел|зашла|начал|начала|установ)|только\s+зарег|только\s+скачал|первый\s+день|с\s+сегодня|со\s+вчера)/.test(
      t,
    ) ||
    new RegExp(`${WB}(вчера|сегодня)${WE}`).test(t)
  ) {
    return 1;
  }
  if (/(недавно|не\s+давно|относительно\s+не\s*давно|не\s+так\s+давно)/.test(t)) {
    return 5;
  }
  if (
    new RegExp(`${WB}недолго${WE}|${WB}не\\s+долго${WE}|${WB}немного${WE}`).test(t) &&
    !new RegExp(`${WB}давно${WE}`).test(t)
  ) {
    return 3;
  }

  // Явно долго (≥ порога отсева).
  if (
    /^(?:ну\s+|да\s+|хз,?\s*|вообще\s+|довольно\s+|достаточно\s+|уже\s+)?(?:очень\s+)?(?:давно|долго|дофига|вечность|прилично|достаточно)(?:\s+уже)?(?:\s+тут|\s+сижу|\s+на\s+дв)?[\s)!.]*$/i.test(
      t,
    ) ||
    /(давно\s+уже|уже\s+давно|вообще\s+давно|довольно\s+давно|достаточно\s+давно|сижу\s+давно|давно\s+сижу)/.test(
      t,
    ) ||
    /^(?:ну\s+|да\s+)?много(?:\s+времени)?[\s)!.]*$/i.test(t) ||
    /(куча\s+времени|дофига\s+времени|вечность)/.test(t)
  ) {
    return 60;
  }
  if (
    new RegExp(`${WB}(прилично|достаточно)${WE}`).test(t) &&
    !/\d/.test(t) &&
    !/не\s+прилично/.test(t)
  ) {
    return 30;
  }
  // «не знаю, много…» / «много сижу»
  if (
    new RegExp(`${WB}много${WE}`).test(t) &&
    /(дн|день|недел|мес|сиж|тут|на\s+дв|время|не\s*знаю|хз|служи)/.test(t)
  ) {
    return 60;
  }

  let best = null;
  for (const unit of STAY_UNITS) {
    const before = new RegExp(`${STAY_NUM}?\\s*(?:с\\s+)?(?:${unit.re})`, 'g');
    let m;
    while ((m = before.exec(t))) {
      let n = unit.noNum ? 1 : stayNum(m[1]);
      if (n == null) {
        const after = t.slice(m.index + m[0].length).match(new RegExp(`^\\s*${STAY_NUM}`));
        n = after ? stayNum(after[1]) : 1;
      }
      const days = n * unit.days;
      if (best == null || days > best) best = days;
    }
  }
  if (best != null) return best;

  if (/^(?:ну\s+|да\s+|хз,?\s*)?(?:очень\s+)?(?:давно|долго|дофига|вечность)[\s)!.]*$/i.test(t)) {
    return 60;
  }

  // Голое число / словесное число: «5», «два а что», «дня 3».
  const bare = t.match(
    new RegExp(
      `^(?:ну\\s+|да\\s+|где[- ]то\\s+|около\\s+|примерно\\s+|дня\\s+|дней\\s+)?(${Object.keys(STAY_NUM_WORDS).join('|')}|\\d{1,3})(?:\\s*(?:а\\s+что|дня|день|дней|дн\\.?|штук)?)?[\\s)!.]*$`,
      'i',
    ),
  );
  if (bare) {
    const n = stayNum(bare[1]);
    if (n != null && n >= 1 && n <= 3650) return n;
  }
  const headNum = t.match(/^(?:ну\s+|да\s+)?(\d{1,3})(?![0-9])/);
  if (headNum && t.length <= 40) {
    const n = Number(headNum[1]);
    if (n >= 1 && n <= 3650) return n;
  }

  if (/не\s*знаю|хз|без\s+понятия|не\s+счита/.test(t) && best == null) {
    return null;
  }

  return null;
}

async function shouldAskHowLong(accountId, peerId) {
  if (howLongInFlight.has(bufferKey(accountId, peerId))) return false;
  if (await wasHowLongAsked(accountId, peerId)) return false;
  const { botMsgs, ageHours } = await getHowLongDialogStats(accountId, peerId);
  if (ageHours == null || ageHours > HOWLONG_NEW_DIALOG_HOURS) return false;
  return botMsgs >= HOWLONG_BOT_MSGS_FROM && botMsgs <= HOWLONG_BOT_MSGS_TO;
}

module.exports = {
  howLongInFlight,
  HOWLONG_ARCHIVE_DAYS,
  HOWLONG_BOT_MSGS_FROM,
  HOWLONG_BOT_MSGS_TO,
  HOWLONG_NEW_DIALOG_HOURS,
  buildHowLongQuestion,
  isHowLongQuestion,
  wasHowLongAsked,
  getHowLongDialogStats,
  isAnswerToHowLong,
  stayNum,
  stripStayMeta,
  parseStayDays,
  shouldAskHowLong,
};
