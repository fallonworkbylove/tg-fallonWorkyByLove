/**
 * humanIdeas13 (0ib) — новые идеи под 10/10:
 * 1 анти-анкета клише («просто общаюсь», «ищу знакомых»…)
 * 2 не переспрашивать «как дела/чем занят» после его ответа
 * 3 пустые обещания («напишу завтра обязательно») → мягче
 * 4 намёк дня недели МСК (пн/пт/вс)
 * 5 анти-зеркало его последней фразы почти дословно
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

function mskWeekdayShort(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
  }).format(date);
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

/** #1 клише анкеты / колл-центра */
const ANKETA_CLICHE_RE =
  /(?:^|[.!?)\s])(?:просто\s+(?:общаюсь|переписываюсь|поболтать|поболтать хочу)|ищу\s+(?:новых?\s+)?знаком(?:ых|ств)|ищу\s+общен|просто\s+развиваться|развиваться\s+и\s+наслаждаться|наслаждаться\s+жизн|цели\s*[—–-]?\s*просто\s+развив|всегда\s+рада\s+общению|продолжим\s+общение|посмотрим,?\s+что\s+будет\s+дальше|да\s+так,?\s*поболтать)/i;

const ANKETA_WHOLE_RE =
  /^(?:ну\s+)?(?:да\s+)?(?:просто\s+(?:общаюсь|переписываюсь|поболтать)|ищу\s+(?:новых?\s+)?знаком(?:ых|ств)|ищу\s+общен\w*|да\s+так,?\s*поболтать)\s*\)?\.?$/i;

const ANKETA_ALTS = [
  'ну просто тут сижу, пишу тебе)',
  'да так, захотелось поболтать)',
  'скучно было, вот и пишу)',
  'ну честно — просто втыкаю в чат)',
];

function softenAnketaCliche(reply) {
  const out = String(reply || '').trim();
  if (!out) return reply;
  if (ANKETA_WHOLE_RE.test(out)) return pick(ANKETA_ALTS);
  if (!ANKETA_CLICHE_RE.test(out)) return out;
  // вырезаем клише-куски, если остаётся смысл
  let cleaned = out
    .replace(
      /(?:^|[.!?)\s,])(?:просто\s+(?:общаюсь|переписываюсь)|ищу\s+(?:новых?\s+)?знаком(?:ых|ств)[а-яё]*|ищу\s+общен[а-яё]*|развиваться\s+и\s+наслаждаться\s+жизн[а-яё]*|наслаждаться\s+жизн[а-яё]*|всегда\s+рада\s+общению|продолжим\s+общение|посмотрим,?\s+что\s+будет\s+дальше|да\s+так,?\s*поболтать)/gi,
      ' ',
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, '')
    .trim();
  if (
    !cleaned ||
    cleaned.length < 8 ||
    ANKETA_CLICHE_RE.test(cleaned) ||
    /^(?:и\s+)?общен[а-яё]*\s*\)?\.?$/i.test(cleaned) ||
    /^(?:ну\s+)?и\s+вс[её]\s*\)?\.?$/i.test(cleaned)
  ) {
    return pick(ANKETA_ALTS);
  }
  if (!/[)….!?]$/.test(cleaned) && cleaned.length < 60) cleaned += ')';
  return cleaned;
}

/** #2 он уже ответил на «как дела» — не спрашивай снова */
const HOW_ASK_OUT_RE =
  /(?:как\s+(?:дела|день|настроение|ты)(?![а-яё])|а\s+ты\s+(?:как|чем)(?![а-яё])|а\s+ты\s+чем\s+занят|чем\s+(?:занят|занимаешься)|что\s+делаешь|че\s+как)/i;

const USER_STATUS_ANSWER_RE =
  /^(?:ну\s+)?(?:да\s+)?(?:норм(?:ально)?|нормально|хорошо|отлично|плохо|так\s+себе|ничего|дома|на\s+работе|на\s+смене|работаю|сплю|лежал|лежала|ел|ела|пью|кофе|устала?|занят|свободн\w*|ок|окей|кайф|ага|угу)\b/i;

function stripStaleHowAsk(reply, userMessage, history) {
  const out = String(reply || '');
  if (!HOW_ASK_OUT_RE.test(out) || !/[?]/.test(out)) return reply;

  const u = bare(userMessage);
  const heJustAnswered =
    USER_STATUS_ANSWER_RE.test(u) ||
    /(?:^|\s)(?:я\s+)?(?:на\s+работе|на\s+смене|дома|работаю|отдыхаю|ем|пью)\b/i.test(u);

  const recentHow = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-3)
    .some((m) => HOW_ASK_OUT_RE.test(String(m.content || '')));

  // он только что ответил статусом ИЛИ мы сами недавно уже спрашивали
  if (!heJustAnswered && !recentHow) return reply;

  let cleaned = out
    .replace(
      /[.,!]?\s*(?:а\s+)?(?:ну\s+)?(?:как\s+(?:дела|день|настроение|ты)|а\s+ты\s+чем\s+занят(?:а)?|а\s+ты\s+(?:как|чем)|чем\s+(?:занят(?:а)?|занимаешься)|что\s+делаешь|че\s+как)(?:\s*\?)?\s*\)?/gi,
      '',
    )
    .replace(/\?\s*\)?$/g, ')')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;]+|[\s,;]+$/g, '')
    .trim();

  if (!cleaned || cleaned.length < 3) {
    return pick(['поняла)', 'ну ясно)', 'ага, слышу)', 'ок, ясно)']);
  }
  if (!/[)….!?]$/.test(cleaned)) cleaned += ')';
  return cleaned;
}

/** #3 пустые жёсткие обещания */
const HOLLOW_PROMISE_RE =
  /(?:обязательно\s+напишу|напишу\s+(?:тебе\s+)?(?:завтра|вечером)\s+обязательно|точно\s+напишу\s+завтра|созвонимся\s+(?:скоро|завтра|на\s+днях)|завтра\s+точно\s+(?:напишу|созвоним)|обещаю\s+напис)/i;

function softenHollowPromise(reply) {
  const out = String(reply || '').trim();
  if (!out || !HOLLOW_PROMISE_RE.test(out)) return reply;
  if (out.length < 55) {
    return pick([
      'если не закручусь — напишу)',
      'позже отпишусь, если смогу)',
      'ну постараюсь не пропасть)',
      'если будет время — маякну)',
    ]);
  }
  return out
    .replace(
      /(?:я\s+)?(?:обязательно\s+напишу|напишу\s+(?:тебе\s+)?(?:завтра|вечером)\s+обязательно|точно\s+напишу\s+завтра|созвонимся\s+(?:скоро|завтра|на\s+днях)|завтра\s+точно\s+(?:напишу|созвоним)|обещаю\s+напис\w*)/gi,
      'если смогу — маякну',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** #4 день недели — только хинт */
function weekdayMicroHint(date = new Date()) {
  const wd = mskWeekdayShort(date);
  const h = mskHour(date);
  if (wd === 'Mon' && h >= 7 && h < 14) {
    return 'Сейчас понедельник МСК — можно чуть вялее («понедельник тянет»), без нытья эссе.';
  }
  if (wd === 'Fri' && h >= 16 && h < 23) {
    return 'Сейчас пятница вечер МСК — лёгкий вайб «почти выходные», без объявления «у меня пятница» в каждом сообщении.';
  }
  if (wd === 'Sun' && h >= 10 && h < 20) {
    return 'Сейчас воскресенье МСК — домашний/ленивый тон уместен, без рабочего «с смены».';
  }
  if ((wd === 'Sat' || wd === 'Sun') && h >= 20) {
    return 'Выходной вечер МСК — чуть мягче и короче, без утренней бодрости.';
  }
  return null;
}

/** #5 почти дословное эхо его фразы */
function normalizeEcho(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripNearEcho(reply, userMessage) {
  const out = bare(reply);
  const u = bare(userMessage);
  if (!out || !u || u.length < 8 || out.length < 6) return reply;
  if (/[?]/.test(u) && out.length > u.length + 10) return reply; // ответила с запасом — ок
  const a = normalizeEcho(out);
  const b = normalizeEcho(u);
  if (!a || !b) return reply;
  if (a === b || (a.length >= 10 && (b.includes(a) || a.includes(b)) && Math.abs(a.length - b.length) <= 6)) {
    return pick(['хм ну да)', 'ага, поняла)', 'хех ок)', 'хех, ясно)']);
  }
  return reply;
}

function applyIdeas13Postfilters(reply, history, userMessage) {
  let out = String(reply || '');
  out = softenAnketaCliche(out);
  out = stripStaleHowAsk(out, userMessage, history);
  out = softenHollowPromise(out);
  out = stripNearEcho(out, userMessage);
  return out;
}

function buildIdeas13Hints(history, userMessage) {
  const parts = [];
  const wd = weekdayMicroHint();
  if (wd) parts.push(wd);

  const u = bare(userMessage);
  if (USER_STATUS_ANSWER_RE.test(u)) {
    parts.push(
      'Он только что ответил как у него дела/чем занят — НЕ спрашивай снова «как дела / чем занят». Кивни или зацепись за его слова.',
    );
  }

  const recentHow = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-3)
    .some((m) => HOW_ASK_OUT_RE.test(String(m.content || '')));
  if (recentHow) {
    parts.push('Ты недавно уже спрашивала «как дела/чем занят» — этот ход без такого вопроса.');
  }

  return parts.length ? parts.join('\n') : null;
}

module.exports = {
  softenAnketaCliche,
  stripStaleHowAsk,
  softenHollowPromise,
  weekdayMicroHint,
  stripNearEcho,
  applyIdeas13Postfilters,
  buildIdeas13Hints,
  ANKETA_CLICHE_RE,
  HOW_ASK_OUT_RE,
  HOLLOW_PROMISE_RE,
};
