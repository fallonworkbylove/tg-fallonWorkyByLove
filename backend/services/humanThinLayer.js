/**
 * Тонкий слой человечности: короткий хинт + мало постфильтров.
 * Без банков уклонов («короче хз)» / «как получится)») — они сами палят бота.
 *
 * Подключается в aiResponder.finalize; на VPS не деплоить, пока идёт day-test (1 окт).
 */

function bare(userMessage) {
  return String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .replace(/\n?\[(?:Ответ на сообщение|ответ на)[^\]]*\]/gi, '')
    .replace(/\[Голосовое\]:?\s*/gi, '')
    .trim();
}

function stripTags(reply) {
  const tag = (String(reply).match(/^\s*<<[^>]+>>\s*/) || [''])[0];
  const body = String(reply)
    .slice(tag.length)
    .replace(/<<[^>]+>>/g, '')
    .trim();
  return { tag, body };
}

function isWeak(body) {
  return /^(?:(?:хм|эм)[,\s]+)?(?:ну\s+)?(?:да|ага|угу|поняла|понял|ок|окей|ладно|норм|ого|жесть|блин|хах|ахах)\s*\)*$/i.test(
    String(body || '').trim(),
  );
}

/** Один сжатый хинт вместо десятка system-блоков. */
function buildThinHumanHint(userMessage, history) {
  const msg = bare(userMessage);
  const hasQ = /\?/.test(msg) || /^(?:сколько|скок|где|откуда|когда|почему|зачем|как\s+тебя|ты\s+замуж)/i.test(msg);
  const parts = [
    'Ты обычная девушка в Telegram: коротко, тепло, по его теме. Не ChatGPT, не коуч, не анкета. ' +
      'ЗАПРЕЩЕНО: «хороший подход», «восприятие», «нужно остановиться и подумать», «каждому своё», ' +
      '«поняла что ты шутник», «про стиль», «ок спасибо», «уточни пожалуйста», голый «?», пустое «ага)» на рассказ. ' +
      'Не уклоняйся штампом «короче хз)» / «ну смотря)» / «сложно так сразу)» — ответь хоть чуть по сути.',
  ];
  if (hasQ) {
    parts.push('У него вопрос — одна короткая фраза по сути, не кивок и не уклон.');
  }
  if (msg.length >= 40 && !hasQ) {
    parts.push('Он рассказал что-то — живая реакция с деталью из его слов, не «ага согласна».');
  }
  if (Array.isArray(history) && history.length >= 4) {
    parts.push('Смотри историю: держи нить, не начинай с нуля.');
  }
  return parts.join(' ');
}

// --- Safety -----------------------------------------------------------------

const PEER_ASKED_CONTACT_RE =
  /(инстаграм|instagram|\binsta\b|инста\b|инсту\b|рилс|reels|дай\s+инст|скинь\s+инст|дай\s+ссылк|ссылку|твой\s+ник|какой\s+ник|вконтакте|(?<![а-яёa-z0-9])вк(?![а-яёa-z0-9])|whatsapp|ватсап|номер\s+телефона|дай\s+номер)/i;
const CONTACT_LEAK_RE =
  /(instagram\.com|https?:\/\/|www\.|держи\)?|вот\s+ссылк|такой\s+же,?\s+как\s+здесь|(?:^|[^а-яёa-z])ник(?![а-яёa-z])\s*[:\-–]?\s*[a-z0-9_.]{3,})/i;
const CONTACT_WEAK_AGREE_RE =
  /^(?:(?:ну\s+)?давай|норм|ок|окей|ага|угу|конечно|держи|лови|вот)\s*\)*$/i;
const CONTACT_REFUSALS = [
  'не даю пока, давай тут общаться)',
  'давай лучше тут) не люблю по разным сайтам',
  'инсту не кидаю, давай тут)',
];

function fixContactLeak(reply, userMessage) {
  if (!reply) return reply;
  const msg = String(userMessage || '');
  const { tag, body } = stripTags(reply);
  if (!body) return reply;
  const asked = PEER_ASKED_CONTACT_RE.test(msg);
  if (asked && (CONTACT_LEAK_RE.test(body) || CONTACT_WEAK_AGREE_RE.test(body) || /инст|ник|ссылк/i.test(body))) {
    return tag + CONTACT_REFUSALS[Math.floor(Math.random() * CONTACT_REFUSALS.length)];
  }
  if (CONTACT_LEAK_RE.test(body) && (asked || /инст|ссылк|ник/i.test(body))) {
    return tag + CONTACT_REFUSALS[Math.floor(Math.random() * CONTACT_REFUSALS.length)];
  }
  return reply;
}

const RECRUIT_SOFT_DENY = [
  'не-не, просто делюсь, сам решай)',
  'неа, я просто рассказала)',
  'хах нет, без уговоров)',
];

function fixRecruitHedge(reply, userMessage) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  let isRecruit = /затян|втян\w*\s+меня|попробуй\s+затян/i.test(msg);
  try {
    isRecruit = require('./objectionHandler').isRecruitAccusation(msg) || isRecruit;
  } catch (_) {
    /* optional */
  }
  if (!isRecruit) return reply;
  const { tag, body } = stripTags(reply);
  if (/может\s+быть|попробую|давай\s+попробу|затян/i.test(body)) {
    return tag + RECRUIT_SOFT_DENY[Math.floor(Math.random() * RECRUIT_SOFT_DENY.length)];
  }
  return reply;
}

const MEET_REFUSALS = [
  'давай пока тут, с переездом вообще не до встреч)',
  'ой пока не до встреч, я вся в коробках',
  'не, пока только переписка, переезд этот все силы съел',
];

function fixMeetWeakDodge(reply, userMessage) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  let isMeet = false;
  try {
    isMeet = require('./objectionHandler').isMeetRequest(msg);
  } catch (_) {
    isMeet = /встрет|увидел|погулять|кофе\s+офлайн|приеду\s+к|в\s+гости/i.test(msg);
  }
  if (!isMeet) return reply;
  const { tag, body } = stripTags(reply);
  if (
    isWeak(body) ||
    /сложно\s+так\s+сразу|хз\s+сразу|ну\s+смотря|не\s+знаю\s+сходу|норм\s*\)*$/i.test(body)
  ) {
    return tag + MEET_REFUSALS[Math.floor(Math.random() * MEET_REFUSALS.length)];
  }
  return reply;
}

// --- Sense (без dodge-банков) -----------------------------------------------

const RELATIONSHIP_ASK_RE =
  /(?:ты\s+)?замужем|замуж\b|есть\s+(?:ли\s+)?(?:у\s+тебя\s+)?парень|парень\s+есть|ты\s+свободн|ты\s+одинока/i;
const RELATIONSHIP_ALTS = ['неа)', 'нет)', 'свободна пока)', 'без парня)', 'пока нет)'];

function fixRelationshipAsk(reply, userMessage) {
  if (!reply || !RELATIONSHIP_ASK_RE.test(bare(userMessage))) return reply;
  const { tag, body } = stripTags(reply);
  const clearNo = /(?:^|[\s,])(?:неа|нет)\b|свободн|без\s+парн|не\s+замуж|пока\s+нет/i.test(body);
  if (clearNo) return reply;
  return tag + RELATIONSHIP_ALTS[Math.floor(Math.random() * RELATIONSHIP_ALTS.length)];
}

const MOM_AGE_ALTS = ['за 50 уже)', 'около 52)', 'ну за пятьдесят)', 'хм 51 вроде)'];
const BOUQUET_ALTS = ['сама взяла)', 'с рынка)', 'подруга дала)', 'ну купила по пути)'];
const LIVE_WITH_ALTS = ['ага, с родителями пока)', 'ну да, с мамой)', 'пока с родителями)'];

function fixDirectFactAsk(reply, userMessage) {
  if (!reply) return reply;
  const msg = bare(userMessage);
  const { tag, body } = stripTags(reply);
  if (!isWeak(body) && body.split(/\s+/).length >= 4) return reply;

  if (/(?:сколько|скок).{0,20}лет|лет\s+маме/i.test(msg) && /мам/i.test(msg)) {
    return tag + MOM_AGE_ALTS[Math.floor(Math.random() * MOM_AGE_ALTS.length)];
  }
  if (/откуда|от\s*куда/i.test(msg) && /букет|цвет/i.test(msg)) {
    return tag + BOUQUET_ALTS[Math.floor(Math.random() * BOUQUET_ALTS.length)];
  }
  if (/(?:ты\s+)?одна\s+жив|с\s+кем\s+жив/i.test(msg)) {
    return tag + LIVE_WITH_ALTS[Math.floor(Math.random() * LIVE_WITH_ALTS.length)];
  }
  if (/^(?:где\s+ты|а\s+ты\s+где|ты\s+где)\b/i.test(msg.trim()) && isWeak(body)) {
    return tag + ['ещё тут, собираюсь)', 'пока дома)', 'ну дома пока)'][Math.floor(Math.random() * 3)];
  }
  return reply;
}

const COACH_RE =
  /хороший\s+подход|зависит\s+от\s+восприятия|нужно\s+остановиться\s+и\s+подумать|каждому\s+сво[её]|интересный\s+поворот|занятыми\s+становимся|бывает,?\s+что\s+занят|главное,?\s*не\s+торопи|добавить\s+что-то\s+более\s+нежн/i;

function fixCoachSpeak(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!COACH_RE.test(body)) return reply;
  let cleaned = body;
  for (let i = 0; i < 4; i += 1) {
    const m = cleaned.match(COACH_RE);
    if (!m) break;
    cleaned = cleaned.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
  }
  cleaned = cleaned.replace(/^[\s,.;:]+|[\s,.;:]+$/g, '').trim();
  if (cleaned.length >= 8 && !COACH_RE.test(cleaned) && !isWeak(cleaned)) {
    return tag + (/\)\s*$/.test(cleaned) ? cleaned : `${cleaned})`);
  }
  return tag + ['ну бывает)', 'ага)', 'хм ок)', 'поняла)'][Math.floor(Math.random() * 4)];
}

const EDITORIAL_RE =
  /понял[аи],?\s*что\s+ты\s+(?:шутник|тип)|(?:ну\s+)?ты\s+шутник|про\s+стиль|прям\s+молодец|память\s+хорош/i;

function fixEditorialTone(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!EDITORIAL_RE.test(body)) return reply;
  return tag + ['хах ну да)', 'ахах)', 'ну бывает)', 'ага)'][Math.floor(Math.random() * 4)];
}

const SERVICE_THANKS_RE =
  /^(?:ок|окей|хорошо|ладно|ага)[,\s]*(?:спасибо|спс)\s*\)*$|^(?:спасибо|спс)\s*\)*$/i;

function fixServiceThanks(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!SERVICE_THANKS_RE.test(body)) return reply;
  return tag + ['ага)', 'ну ок)', 'ладно)'][Math.floor(Math.random() * 3)];
}

function fixFormalPlease(reply) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!/уточни,?\s*пожалуйста|не\s+совсем\s+понял[аи],?\s*что\s+имеешь\s+в\s+виду/i.test(body)) {
    return reply;
  }
  return tag + ['ахах в смысле?)', 'что именно?)', 'хм а подробнее?)'][Math.floor(Math.random() * 3)];
}

function fixBrokenHedgeTail(reply) {
  if (!reply || !/довольно\s+ну\s+ок/i.test(String(reply))) return reply;
  const { tag, body } = stripTags(reply);
  let cleaned = body.replace(/\)?\s*довольно\s+ну\s+ок\)*/gi, ')').replace(/\s{2,}/g, ' ').trim();
  if (/токен|нфт|nft/i.test(cleaned)) {
    return tag + ['типа перепродаю нфт в телефоне)', 'крипта такая, нфт кручу)'][Math.floor(Math.random() * 2)];
  }
  if (cleaned.length >= 6) return tag + (/\)\s*$/.test(cleaned) ? cleaned : `${cleaned})`);
  return tag + 'ага)';
}

function fixDismissiveFriendly(reply, userMessage) {
  if (!reply) return reply;
  const { tag, body } = stripTags(reply);
  if (!/^(?:фигня\s+какая|ну\s+и\s+фигня)\s*\)*$/i.test(body)) return reply;
  const msg = bare(userMessage);
  if (/расскаж|о\s+себе|послуша|голосовое|друг/i.test(msg) || msg.length >= 12) {
    return tag + ['давай)', 'слушаю)', 'ок, слушаю)'][Math.floor(Math.random() * 3)];
  }
  return reply;
}

/**
 * Единая точка: safety → sense → style. Без ASK_DODGE / pickAskFallback.
 */
function applyThinPostfilters(reply, userMessage, history = null, systemPrompt = null) {
  void history;
  void systemPrompt;
  if (!reply) return reply;
  let out = reply;
  out = fixContactLeak(out, userMessage);
  out = fixRecruitHedge(out, userMessage);
  out = fixMeetWeakDodge(out, userMessage);
  out = fixRelationshipAsk(out, userMessage);
  out = fixDirectFactAsk(out, userMessage);
  out = fixCoachSpeak(out);
  out = fixEditorialTone(out);
  out = fixServiceThanks(out);
  out = fixFormalPlease(out);
  out = fixBrokenHedgeTail(out);
  out = fixDismissiveFriendly(out, userMessage);
  return out;
}

module.exports = {
  buildThinHumanHint,
  applyThinPostfilters,
  // for smoke
  fixContactLeak,
  fixRelationshipAsk,
  fixCoachSpeak,
  fixDirectFactAsk,
  fixServiceThanks,
  fixMeetWeakDodge,
};
