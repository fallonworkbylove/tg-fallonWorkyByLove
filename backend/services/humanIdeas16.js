/**
 * humanIdeas16 (0io) — ещё человечности:
 * 1 пустые «ну ну / ммм / ааа»
 * 2 «научишь» → не мягкий пустой ок
 * 3 его «гуляю по городу» ≠ зов на встречу (не шаблон «не до встреч»)
 * 4 huh / латиница-растерянность → по-русски
 * 5 тон терапевта («я тебя понимаю», «это нормально чувствовать»)
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

/* ——— 1 пустые мягкие заполнители ——— */
const EMPTY_SOFT_RE =
  /^(?:ну\s*ну|нуну|ммм+|ааа+|эээ+|угу\s+угу|да\s+да\s+да)\s*[).!]*$/i;

const EMPTY_SOFT_ALTS = [
  'хм, а подробнее?)',
  'о как)',
  'слушай, не уловила)',
  'ну расскажи нормально)',
  'хах, и?',
];

function stripEmptySoftFillers(reply) {
  const { tag, body } = stripTags(reply);
  if (!EMPTY_SOFT_RE.test(body)) return reply;
  return tag + pick(EMPTY_SOFT_ALTS);
}

/* ——— 2 «научишь / покажи как» ——— */
const TEACH_ASK_RE =
  /(?:^|[^а-яё])(?:научишь|научите|научи(?![а-яё])|покажешь\s+как|покажи\s+как|объяснишь|обучишь)(?![а-яё])/i;
const TEACH_EMPTY_RE =
  /^(?:ну\s+ну|нуну|ладно|ок|окей|можно|давай|хорошо|ага|угу|ну\s+ок|мм+)\s*[).!]*$/i;

const TEACH_ALTS = [
  'хах я сама ещё учусь, не учитель)',
  'не, я так пальцами тыкаю — лучше гугли)',
  'ой я плохо объясняю, лучше сама попробую)',
  'могу накидать мысль, но без уроков)',
];

function fixTeachAsk(reply, userMessage) {
  const u = bareUser(userMessage);
  if (!TEACH_ASK_RE.test(u)) return reply;
  const { tag, body } = stripTags(reply);
  if (!TEACH_EMPTY_RE.test(body) && body.length > 28) return reply;
  if (/сама\s+ещё\s+уч|не\s+учитель|плохо\s+объясн|без\s+уроков/i.test(body)) {
    return reply;
  }
  return tag + pick(TEACH_ALTS);
}

/* ——— 3 его прогулка / город ≠ зов на свидание ——— */
const HIS_WALK_RE =
  /(?:^|[^а-яё])(?:гуляю|погуляю|пойду\s+погул|иду\s+гулять|гулял|по\s+городу\s+гул|на\s+прогулк)/i;
const MEET_INVITE_RE =
  /(?:давай\s+(?:встрет|погуля|сходим)|встретим(?:ся)?|увидимся|сходим\s+вместе|погуляем|ко\s+мне|в\s+гости|жду\s+тебя)/i;
const FALSE_MEET_REFUSE_RE =
  /не\s+до\s+встреч|пока\s+только\s+(?:тут|переписк)|с\s+переездом\s+пока|вся\s+в\s+коробк|не\s+до\s+прогул/i;

const WALK_REACT_ALTS = [
  'кайф, погода хоть норм?',
  'о, гуляй) что интересного попадается?',
  'хах хорошо) а куда обычно?',
  'ну кайф, хоть воздухом)',
];

function fixFalseMeetOnHisWalk(reply, userMessage) {
  const u = bareUser(userMessage);
  if (!HIS_WALK_RE.test(u)) return reply;
  if (MEET_INVITE_RE.test(u)) return reply;
  const { tag, body } = stripTags(reply);
  if (!FALSE_MEET_REFUSE_RE.test(body)) return reply;
  return tag + pick(WALK_REACT_ALTS);
}

/* ——— 4 huh / растерянность на латиницу ——— */
const HUH_REPLY_RE =
  /^(?:\s*(?:huh+|хм+|хех+|what\??|sorry\??|idk)\s*[😅😂🙈?]*)+$/i;
const TRANSLIT_OR_LATIN_USER_RE =
  /(?:^|[^а-яё])(?:[a-z]{3,}(?:\s+[a-z]{2,}){0,6}|[b-df-hj-np-tv-z]{4,}[aeiouy]?[a-z]*)/i;

const HUH_ALTS = [
  'не поняла) напиши по-русски)',
  'хм, не въехала — нормально напиши)',
  'ахах что?) словами)',
  'слушай, не разобрала)',
];

function stripHuhConfusion(reply, userMessage) {
  const { tag, body } = stripTags(reply);
  const bare = body.replace(/[\s😅😂🙈🙂😊😉]+/g, ' ').trim();
  if (!HUH_REPLY_RE.test(bare) && !/^(?:huh+|what\??)\s*[😅?]*$/i.test(bare)) {
    return reply;
  }
  const u = bareUser(userMessage);
  if (u && !TRANSLIT_OR_LATIN_USER_RE.test(u) && /[а-яё]{3,}/i.test(u)) {
    // обычный русский — просто пустая растерянность
    return tag + pick(['хм, не уловила)', 'а подробнее?)', 'что именно?)']);
  }
  return tag + pick(HUH_ALTS);
}

/* ——— 5 тон терапевта ——— */
const THERAPIST_RE =
  /(?:я\s+тебя\s+понимаю|понимаю\s+твои\s+чувства|это\s+нормально(?:\s+что|\s+чувств)|спасибо(?:\s+тебе)?\s+что\s+(?:открыл|поделил|рассказал)|важно\s+(?:говорить|делитьсять)\s+о\s+чувствах|ты\s+имеешь\s+право\s+чувствовать)/i;

const THERAPIST_ALTS = [
  'ну бывает)',
  'хм, слышу тебя)',
  'жаль) а дальше как?',
  'ой жесть)',
];

function stripTherapistTone(reply) {
  const { tag, body } = stripTags(reply);
  if (!THERAPIST_RE.test(body)) return reply;
  if (body.length < 90 && THERAPIST_RE.test(body)) {
    return tag + pick(THERAPIST_ALTS);
  }
  const cleaned = body
    .replace(THERAPIST_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, '')
    .trim();
  if (!cleaned || cleaned.length < 6) return tag + pick(THERAPIST_ALTS);
  return tag + ( /[)….!?]$/.test(cleaned) ? cleaned : `${cleaned})`);
}

function applyIdeas16Postfilters(reply, history, userMessage) {
  if (!reply) return reply;
  let out = reply;
  // Сначала узкие кейсы, пустой «ну ну» — в конце.
  out = fixTeachAsk(out, userMessage);
  out = fixFalseMeetOnHisWalk(out, userMessage);
  out = stripHuhConfusion(out, userMessage);
  out = stripTherapistTone(out);
  out = stripEmptySoftFillers(out);
  return out;
}

function buildIdeas16Hints(userMessage) {
  const u = bareUser(userMessage);
  const parts = [];
  if (TEACH_ASK_RE.test(u)) {
    parts.push(
      'Он просит «научи / покажи как» — не голое «ок/ладно». Скажи что сама ещё учишься / плохо объясняешь, без урока.',
    );
  }
  if (HIS_WALK_RE.test(u) && !MEET_INVITE_RE.test(u)) {
    parts.push(
      'Он просто про свою прогулку/город — это НЕ зов на встречу. Не пиши «не до встреч / только переписка». Живая реакция на его гуляние.',
    );
  }
  if (TRANSLIT_OR_LATIN_USER_RE.test(u) && !/[а-яё]{4,}/i.test(u)) {
    parts.push('Он написал латиницей/транслитом — попроси по-русски, без huh и эмодзи-спама.');
  }
  parts.push(
    'Не пиши пустое «ну ну)» и тон психолога («я тебя понимаю», «это нормально чувствовать»).',
  );
  return parts.join('\n');
}

module.exports = {
  applyIdeas16Postfilters,
  buildIdeas16Hints,
  stripEmptySoftFillers,
  fixTeachAsk,
  fixFalseMeetOnHisWalk,
  stripHuhConfusion,
  stripTherapistTone,
};
