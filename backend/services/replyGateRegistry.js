/**
 * replyGateRegistry (0m2) — единая точка postfilter-волн + live-клише.
 * Новые гейты подключать сюда, не раздувая humanIdeas*.
 */
const gates = require('./softHumanGates');
const pack = require('./scaleIdeasPack');

let CLICHE_TRACK = [
  'просто общаюсь',
  'не покажу',
  'я обычная',
  'как тебе',
  'ну ок',
  'кайф',
  'ага)',
  'поняла)',
  'слушай',
  'ну ты)',
  'интересно)',
  'о как)',
  'ну ты милый)',
  'спасибо что написал)',
  'мило)',
  'хех)',
];
try {
  const live = require('./opsLiveMetrics');
  if (Array.isArray(live.CLICHE_TRACK) && live.CLICHE_TRACK.length) {
    CLICHE_TRACK = live.CLICHE_TRACK.slice();
  }
} catch (_) {
  /* optional */
}

const CLICHE_ALTS = {
  кайф: ['норм)', 'прикольно)', 'о как)'],
  'ну ок': ['ага)', 'ну да)', 'хех)'],
  'ага)': ['угу)', 'ну да)', 'мм)'],
  'как тебе': ['ну и как?)', 'что скажешь?)', 'интересн?)'],
  'просто общаюсь': ['ну вот так)', 'да просто)', 'сама по себе)'],
  'я обычная': ['ну обычная)', 'да обычная)', 'сама по себе)'],
  'не покажу': ['не сейчас)', 'потом как-нибудь)', 'не хочу пока)'],
  'поняла)': ['ага)', 'ну да)', 'о как)', 'хех)'],
  слушай: ['хм)', 'ну)', 'эй)'],
  'ну ты)': ['хах)', 'ой)', 'серьёзно?)'],
  'интересно)': ['о как, расскажи)', 'ну и?)', 'а дальше?)'],
  'о как)': ['серьёзно?)', 'ого)', 'ну ты)'],
  'ну ты милый)': ['хех ну ты)', 'тепло от тебя)', 'радует)'],
  'спасибо что написал)': ['мне тоже приятно)', 'рада)', 'тепло)'],
  'мило)': ['хех ну ты)', 'тепло)', 'радует)'],
  'хех)': ['ну ты)', 'о как)', 'ага)'],
};

function pickAlt(arr) {
  const list = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!list.length) return '';
  return list[Math.floor(Math.random() * list.length)];
}

function stripTag(reply) {
  const m = String(reply || '').match(/^(\s*<<[^>\n]+>>\s*)/);
  return { tag: m ? m[1] : '', body: m ? String(reply).slice(m[1].length) : String(reply || '') };
}

/** Список зарегистрированных волн (для audit/smoke). */
function listWaves() {
  return [
    { id: '0lo', apply: 'applyWave0loGates', src: 'softHumanGates' },
    { id: '0m1', apply: 'applyWave0m1Gates', src: 'scaleIdeasPack' },
    { id: '0m2', apply: 'fixLiveClicheOveruse', src: 'replyGateRegistry' },
    { id: '0t2', apply: 'applyWave0t2Gates', src: 'softHumanGates' },
    { id: '0t6', apply: 'applyWave0t6Gates', src: 'softHumanGates' },
  ];
}

/**
 * Клише из opsLiveMetrics.CLICHE_TRACK: если фраза уже была у бота
 * в хвосте истории ≥1 раз — переписать на alt (короткие ответы).
 */
function fixLiveClicheOveruse(reply, history) {
  if (!reply) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  const low = body.toLowerCase();
  const asst = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-8)
    .map((h) => String(h.content || '').toLowerCase());

  for (const phrase of CLICHE_TRACK) {
    if (!low.includes(phrase)) continue;
    const alts = CLICHE_ALTS[phrase];
    if (!alts || !alts.length) continue;
    const hits = asst.filter((t) => t.includes(phrase)).length;
    if (hits < 1) continue;
    // Не трогаем длинные ответы — только короткие клише-ходы.
    if (body.length > 90) continue;
    return tag + pickAlt(alts);
  }
  return reply;
}

/** Полный реестр волн после базового softHumanLite. */
function applyRegisteredGates(reply, history, userMessage) {
  let out = reply;
  if (typeof gates.applyWave0loGates === 'function') {
    out = gates.applyWave0loGates(out, history, userMessage);
  }
  if (typeof gates.applyWave0m1Gates === 'function') {
    out = gates.applyWave0m1Gates(out, history, userMessage);
  } else if (typeof pack.applyWave0m1Gates === 'function') {
    out = pack.applyWave0m1Gates(out, history, userMessage);
  }
  out = fixLiveClicheOveruse(out, history);
  if (typeof gates.applyWave0t2Gates === 'function') {
    out = gates.applyWave0t2Gates(out, history, userMessage);
  }
  if (typeof gates.applyWave0t6Gates === 'function') {
    out = gates.applyWave0t6Gates(out, history, userMessage);
  }
  return out;
}

module.exports = {
  CLICHE_ALTS,
  CLICHE_TRACK,
  listWaves,
  fixLiveClicheOveruse,
  applyRegisteredGates,
};
