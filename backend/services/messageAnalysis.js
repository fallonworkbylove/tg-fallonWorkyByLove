/**
 * Глобальное «чтение» реплики как у живой девушки в личке.
 * Один короткий блок рядом с сообщением — без каталога точечных запретов.
 */
'use strict';

function bare(text) {
  return String(text || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .replace(/\n?\[(?:Ответ на сообщение|ответ на|уточнение к|геоконтекст)[^\]]*\]:?\s*/gi, '')
    .replace(/\[Голосовое\]:?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastRoleText(history, role) {
  const h = Array.isArray(history) ? history : [];
  for (let i = h.length - 1; i >= 0; i -= 1) {
    if (h[i] && h[i].role === role) {
      return String(h[i].content || '')
        .replace(/<<[^>]+>>/g, '')
        .replace(/^\[медиа:[^\]]+\]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return '';
}

function extractQuotedMeta(userMessage) {
  const raw = String(userMessage || '');
  const m = raw.match(
    /\[(?:уточнение к твоей фразе|ответ на(?:\s+его\s+сообщение)?|Ответ на сообщение[^\]]*):\s*[«"]([^»"]{1,200})[»"]/i,
  );
  return m ? m[1].trim() : '';
}

function detectEmotion(msg) {
  if (/(?:ебнут|псих|дур[ае]|идиотк|туп(?:ая|о)|пизд|сука|урод|дебилк|крыс)/i.test(msg)) {
    return 'angry';
  }
  if (/(?:скуча|приятно\s+с\s+тобой|ты\s+милая|нравишься|соскучил|рад\w*\s+тебя)/i.test(msg)) {
    return 'warm';
  }
  if (/(?:устал|завал|паш[еу]|вымотал|запар|жестк(?:ий|ая)\s+день)/i.test(msg)) {
    return 'tired';
  }
  if (/(?:ахах|хаха|лол|кек|прикол|шутк)/i.test(msg)) return 'playful';
  if (/(?:грустн|плохо|тяжело|одиноко)/i.test(msg)) return 'sad';
  return 'neutral';
}

function detectSpeechAct(msg) {
  if (
    /^(?:при+в+е+т+(?:ик)?|прив|приветствую|хай|хей|здарова|здаров|здравствуй(?:те)?|доброе\s+утро|добрый\s+день|добрый\s+вечер|hi|hello|hey)\s*[).!]{0,3}$/i.test(
      msg,
    )
  ) {
    return 'greeting';
  }
  if (/(?:созвон|позвон|голосом|по видео|видеосвязь)/i.test(msg)) return 'call_ask';
  if (/(?:ебнут|псих|дур[ае]|идиотк|туп(?:ая|о)|пизд|сука|урод|дебилк)/i.test(msg)) {
    return 'insult';
  }
  // 0t3: разоблачение / трение / медиа-долг — до общего «question».
  if (
    /(?:ты\s+бот|это\s+бот|как\s+бот|как\s+робот|нейросеть|промпт|chatgpt|gpt[- ]?\d|ты\s+ии|\bии\b|you(?:'re|\s+are)\s+a?\s*bot)/i.test(
      msg,
    )
  ) {
    return 'bot_test';
  }
  if (
    /(?:морози|морозить|динамиш|игнор(?:ишь)?|не\s+дождал|вр[её]шь|обещала|где\s+(?:фото|фотк|круж|селфи|видео)|когда\s+(?:скинешь|пришл|фото))/i.test(
      msg,
    )
  ) {
    return 'friction';
  }
  if (
    /(?:скинь|запиши|пришли|хочу|можешь|дай).{0,48}(?:круж|видео|видос|фот|селфи)|(?:кружок|видеосообщение|селфи|фотку).{0,24}(?:скинь|запиши|пришли|можешь)/i.test(
      msg,
    )
  ) {
    return 'media_ask';
  }
  if (/^(?:а+|угу|ага|мм|хм|ок|окей|ясно|лол|ну\s+да)\s*\)?\.?$/i.test(msg)) {
    return 'short_ack';
  }
  if (
    /\?/.test(msg) ||
    /^(?:сколько|где|куда|когда|почему|зачем|как|чем|что|кто|откуда|из\s+какого)\b/i.test(msg)
  ) {
    return 'question';
  }
  if (/(?:скуча|приятно\s+с\s+тобой|ты\s+милая|нравишься)/i.test(msg)) return 'warm';
  if (/(?:устал|завал|паш[еу])/i.test(msg)) return 'tired';
  if (msg.length <= 28 && msg.split(/\s+/).length <= 4) return 'followup';
  return 'statement';
}

function detectTopics(msg) {
  const topics = [];
  if (
    /(?:где\s+(?:ты\s+)?жив|ты\s+откуда|из\s+какого\s+города|в\s+каком\s+городе|а\s+где\s+ты|откуда\s+ты)/i.test(
      msg,
    )
  ) {
    topics.push('location');
  }
  if (/(?:сколько\s+(?:тебе\s+)?лет|тебе\s+сколько|какой\s+возраст|скок\s+лет)/i.test(msg)) {
    topics.push('age');
  }
  if (
    /(?:чем\s+(?:ты\s+)?занима|где\s+работ|ты\s+работ|трейд|trading|крипт|nft|флип|онлайн\s+работ|кем\s+работ)/i.test(
      msg,
    )
  ) {
    topics.push('job');
  }
  if (/(?:хобби|увлекаешь|что\s+любишь\s+делать|чем\s+увлека)/i.test(msg)) {
    topics.push('hobby');
  }
  if (/(?:работа|родня|знаком(?:ые|ых))/i.test(msg) && /(?:у\s+тебя|есть|тут|там)/i.test(msg)) {
    topics.push('roots');
  }
  if (/(?:помнишь|вспомни|как\s+звали|я\s+(?:же\s+)?говорил)/i.test(msg)) {
    topics.push('recall');
  }
  if (/(?:фото|фотк|селфи|кружок|видео|смотри|держи)/i.test(msg)) topics.push('media');
  if (/(?:встреча|увидимся|погуля|созвон)/i.test(msg)) topics.push('meetup');
  if (/(?:блог|сторис|инст|тикток|веду\s+(?:блог|канал))/i.test(msg)) topics.push('blog');
  if (/(?:как\s+тебя\s+зов|тебя\s+как\s+зовут|тво[её]\s+имя)/i.test(msg)) topics.push('name');
  if (/(?:что\s+думаешь|как\s+считаешь|тво[её]\s+мнение)/i.test(msg)) topics.push('opinion');
  if (/(?:как\s+(?:твои\s+)?дела|как\s+день|что\s+делаешь|чем\s+занят)/i.test(msg)) {
    topics.push('how_are_you');
  }
  if (/(?:погод|на\s+улице)/i.test(msg)) topics.push('weather');
  if (/(?:план(?:ы|ов)?|выходн)/i.test(msg)) topics.push('plans');
  return topics;
}

function extractFocusWords(msg) {
  const stop = new Set([
    'это', 'вот', 'как', 'что', 'чем', 'где', 'кто', 'про', 'для', 'или', 'если',
    'меня', 'тебя', 'тебе', 'мне', 'мой', 'моя', 'мои', 'твой', 'твоя', 'просто',
    'очень', 'только', 'сейчас', 'щас', 'типа', 'вообще', 'короче', 'ладно',
    'ага', 'угу', 'ну', 'да', 'нет', 'неа', 'ок', 'окей', 'есть', 'было', 'будет',
    'привет', 'хай', 'hello', 'hey',
  ]);
  const words = String(msg || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w));
  const uniq = [];
  for (const w of words) {
    if (!uniq.includes(w)) uniq.push(w);
    if (uniq.length >= 4) break;
  }
  return uniq;
}

function resolveReferent(userMessage, history, speechAct) {
  const metaQuote = extractQuotedMeta(userMessage);
  if (metaQuote) return { kind: 'meta_quote', text: metaQuote.slice(0, 120) };
  const lastAssistant = lastRoleText(history, 'assistant').slice(0, 120);
  const msg = bare(userMessage);
  const shortClarify =
    msg.length <= 28 &&
    /^(а\s+)?(чем|чего|почему|зачем|как|какой|какая|какие|какое|где|куда|откуда|когда|кто|что|ну\s+и|типа|в\s+смысле|это)\b|\?$/i.test(
      msg,
    );
  if ((speechAct === 'followup' || speechAct === 'short_ack' || shortClarify) && lastAssistant) {
    return { kind: 'her_last', text: lastAssistant };
  }
  if (speechAct === 'question' && msg.length <= 40 && lastAssistant) {
    return { kind: 'her_last', text: lastAssistant };
  }
  return { kind: 'none', text: '' };
}

function pickHerMood(speechAct, emotion) {
  if (speechAct === 'insult' || emotion === 'angry') return 'calm_boundary';
  if (speechAct === 'bot_test') return 'calm_human';
  if (speechAct === 'friction') return 'accountable_warm';
  if (speechAct === 'media_ask') return 'honest_timing';
  if (speechAct === 'tired' || emotion === 'tired') return 'caring';
  if (speechAct === 'warm' || emotion === 'warm') return 'warm_reciprocal';
  if (speechAct === 'greeting') return 'warm_hello';
  if (speechAct === 'call_ask') return 'soft_text_prefer';
  if (emotion === 'playful') return 'playful';
  if (emotion === 'sad') return 'soft_care';
  if (speechAct === 'question') return 'clear_answer';
  if (speechAct === 'short_ack') return 'open_curious';
  return 'warm_curious';
}

/** Как это ощущается, когда читаешь как девушка. */
function detectVibe(speechAct, emotion, topics, msg) {
  if (speechAct === 'insult' || emotion === 'angry') return 'напряг — грубит';
  if (speechAct === 'bot_test') return 'проверяет, живая ли ты — без оправданий';
  if (speechAct === 'friction') return 'обижен / давит: ждал ответа или медиа';
  if (speechAct === 'media_ask') return 'просит кружок/фото — честный срок';
  if (speechAct === 'tired' || emotion === 'tired') return 'жалко его, устал';
  if (emotion === 'sad') return 'тихо и тяжеловато';
  if (speechAct === 'warm' || emotion === 'warm') return 'тепло, приятно';
  if (emotion === 'playful') return 'лёгкий, шутит';
  if (speechAct === 'greeting') return 'просто зашёл поздороваться';
  if (speechAct === 'call_ask' || topics.includes('meetup')) return 'давит на созвон/встречу';
  if (topics.includes('location') || topics.includes('age') || topics.includes('name')) {
    return 'узнаёт тебя — нормальный интерес';
  }
  if (topics.includes('job') || topics.includes('roots')) return 'пыряет про жизнь/работу';
  if (speechAct === 'question') return 'ждёт нормальный ответ, не отписку';
  if (speechAct === 'short_ack') return 'коротко кивнул — диалог не закрывать';
  if (speechAct === 'followup') return 'уточняет то, что ты только что сказала';
  if (msg.length > 80) return 'написал по делу — надо среагировать на суть';
  return 'обычный живой чат';
}

/** Подтекст: чего он на самом деле хочет от тебя социально. */
function detectSubtext(speechAct, emotion, topics, msg, referent) {
  if (speechAct === 'greeting') return 'контакт: услышать привет в ответ';
  if (speechAct === 'insult') return 'сбить / проверить реакцию — не зеркаль';
  if (speechAct === 'bot_test') return 'убедиться что ты человек — коротко по-живому, без «я не бот»';
  if (speechAct === 'friction') return 'чтобы ты признала задержку и дала план, не «уточни/лол»';
  if (speechAct === 'media_ask') return 'кружок/фото или честный «чуть позже» без слива';
  if (speechAct === 'tired' || emotion === 'tired' || emotion === 'sad') {
    return 'поддержку одной фразой, не лекцию';
  }
  if (speechAct === 'warm' || emotion === 'warm') return 'взаимность: «мне тоже»';
  if (speechAct === 'call_ask') return 'сближение голосом — мягко оставь в тексте';
  if (topics.includes('meetup')) return 'свести к встрече — мягко через город/срок';
  if (topics.includes('location')) return 'конкретный город/где ты';
  if (topics.includes('age')) return 'цифру возраста или мягкий уход';
  if (topics.includes('job')) return 'чем занята по-честному коротко';
  if (topics.includes('name')) return 'имя';
  if (topics.includes('roots')) return 'есть ли жизнь на месте (работа/люди)';
  if (topics.includes('how_are_you')) return 'мелочь дня (кофе/дома/сериал), не переезд и не отчёт';
  if (topics.includes('opinion')) return 'твоё короткое мнение — можно не согласиться';
  if (topics.includes('media')) return 'реакцию на фото/видео';
  if (topics.includes('recall')) return 'чтобы ты вспомнила факт';
  if (referent && referent.text) return `уточнение к «${referent.text.slice(0, 60)}»`;
  if (speechAct === 'question') return 'прямой ответ на вопрос';
  if (speechAct === 'short_ack') return 'чтобы ты продолжила нить';
  if (msg.length > 50) return 'чтобы ты услышала, что он рассказал';
  return 'просто продолжить разговор по его словам';
}

/**
 * Как звучать живо именно сейчас (не правила-запреты, а ритм речи).
 */
function detectTalkAlive(speechAct, emotion, vibe) {
  if (speechAct === 'insult' || emotion === 'angry') {
    return 'спокойно и коротко, без оправданий — мягкая граница, не ледяная';
  }
  if (speechAct === 'bot_test') {
    return 'живо и коротко («хах ну ты чего)»), без лекции что ты человек';
  }
  if (speechAct === 'friction') {
    return 'честно и тепло: признай задержку, без «уточни/лол/терпеливый»';
  }
  if (speechAct === 'media_ask') {
    return 'по-человечески: срок или мягкий отказ с альтернативой текстом';
  }
  if (speechAct === 'tired' || emotion === 'tired' || emotion === 'sad') {
    return 'заботливо и нежно: одна тёплая фраза, как близкой';
  }
  if (speechAct === 'warm' || emotion === 'warm') {
    return 'любвеобильно и взаимно: тепло в словах («мне тоже приятно)» / «с тобой хорошо)»)';
  }
  if (emotion === 'playful') {
    return 'с улыбкой и лёгким флиртом: можно «ахах», тепло';
  }
  if (speechAct === 'greeting') {
    return 'тёплый живой привет — без анкеты и без штампа «рада что» каждый раз';
  }
  if (speechAct === 'question') {
    return 'по сути тепло и по-человечески, потом можно мягкий вопрос ему';
  }
  if (speechAct === 'short_ack' || speechAct === 'followup') {
    return 'коротко и тепло продолжить нить, как будто тебе с ним приятно';
  }
  if (/узнаёт|пыряет|интерес/i.test(vibe)) {
    return 'честно и тепло, с лёгкой симпатией — без канцелярита';
  }
  return 'как с телефона: коротко, любвеобильно, цепляйся к его словам, лёгкая нежность ок';
}

/** Инстинктивный ход — как ответила бы живая. */
function detectHerMove(speechAct, emotion, topics, vibe, subtext, focus, referent) {
  if (speechAct === 'greeting') {
    return 'тёплый привет (+ «как ты?» ок), будто рада его видеть — не «а дальше»';
  }
  if (speechAct === 'insult') {
    return 'спокойно осадить («ну ты чего)» / «эй)»), коротко, без холода навсегда';
  }
  if (speechAct === 'bot_test') {
    return 'коротко по-живому («хах)» / «эй)»), сменить угол — не оправдываться';
  }
  if (speechAct === 'friction') {
    return 'признать + план («ой затянула, чуть позже…») — без шутки в лицо';
  }
  if (speechAct === 'media_ask') {
    return 'срок («чуть позже кину)») или честно «сейчас неудобно, текстом ок?)»';
  }
  if (speechAct === 'tired' || emotion === 'tired') {
    return 'нежная забота («ой жесть, отдыхай)» / «держись)»), без нравоучений';
  }
  if (speechAct === 'warm' || emotion === 'warm') {
    return 'любвеобильно взаимно («мне тоже приятно)» / «с тобой хорошо)» / «ну ты милый)»)';
  }
  if (speechAct === 'call_ask') {
    return 'мягко «давай пока тут текстом)»';
  }
  if (topics.includes('location')) {
    return 'назвать город/место из карточки — не «кофе пью»';
  }
  if (topics.includes('age')) {
    return 'возраст из карточки или «а тебе?)»';
  }
  if (topics.includes('job')) {
    return 'коротко онлайн/чем занята по легенде';
  }
  if (topics.includes('name')) return 'сказать имя из карточки';
  if (topics.includes('opinion')) {
    return 'своё короткое мнение — можно не согласиться мягко';
  }
  if (referent && referent.text && (speechAct === 'followup' || speechAct === 'question')) {
    return `ответить про «${referent.text.slice(0, 55)}», не прыгать в новое`;
  }
  if (topics.includes('how_are_you')) {
    return 'мелочь дня тепло («кофе)» / «дома туплю)»), не про переезд';
  }
  if (speechAct === 'question') {
    return 'сначала суть ответа одной фразой, можно один тёплый вопрос ему';
  }
  if (speechAct === 'short_ack') {
    return 'тепло продолжить нить или спросить про него — не «ну ладно)»';
  }
  if (focus.length) {
    return `среагировать на ${focus.slice(0, 2).map((w) => `«${w}»`).join(' / ')}`;
  }
  return `по вайбу «${vibe}»: ${subtext}`;
}

function interpretMeaning(msg, speechAct, topics, emotion, referent) {
  const sub = detectSubtext(speechAct, emotion, topics, msg, referent);
  if (speechAct === 'greeting') return 'просто здоровается';
  if (speechAct === 'insult') return `грубит: «${msg.slice(0, 50)}»`;
  if (speechAct === 'bot_test') return `проверяет на бота: «${msg.slice(0, 60)}»`;
  if (speechAct === 'friction') return `давит/ждёт: «${msg.slice(0, 70)}»`;
  if (speechAct === 'media_ask') return `просит медиа: «${msg.slice(0, 70)}»`;
  if (speechAct === 'tired' || emotion === 'tired') return `усталый: «${msg.slice(0, 60)}»`;
  if (speechAct === 'warm' || emotion === 'warm') return `тепло: «${msg.slice(0, 60)}»`;
  if (referent && referent.text && (speechAct === 'followup' || (speechAct === 'question' && msg.length <= 40))) {
    return `уточняет «${msg}» к твоей «${referent.text.slice(0, 50)}»`;
  }
  if (speechAct === 'question') return `спрашивает: «${msg.slice(0, 80)}»`;
  if (topics.length) return sub;
  if (msg.length > 40) return `делится: «${msg.slice(0, 90)}»`;
  return `пишет: «${msg.slice(0, 70)}»`;
}

function detectExpect(speechAct, emotion, topics) {
  if (speechAct === 'greeting') return 'greeting_back';
  if (speechAct === 'insult' || emotion === 'angry') return 'calm_boundary';
  if (speechAct === 'bot_test') return 'human_short';
  if (speechAct === 'friction') return 'own_up_plan';
  if (speechAct === 'media_ask') return 'media_timing';
  if (speechAct === 'tired' || emotion === 'tired' || emotion === 'sad') return 'care';
  if (speechAct === 'warm' || emotion === 'warm') return 'warm_ack';
  if (speechAct === 'call_ask' || topics.includes('meetup')) return 'soft_defer';
  if (emotion === 'playful') return 'light_laugh';
  if (speechAct === 'question' || topics.length) return 'direct_answer';
  if (speechAct === 'short_ack') return 'continue_thread';
  if (speechAct === 'followup') return 'answer_about_referent';
  return 'natural_continue';
}

/**
 * Короткий долг/факт из хвоста истории — чтобы не забывать нить.
 */
function detectThreadDebt(history, userMessage) {
  const h = Array.isArray(history) ? history : [];
  const recent = h.slice(-18);
  const asst = recent
    .filter((x) => x && x.role === 'assistant')
    .map((x) => String(x.content || ''));
  const users = recent
    .filter((x) => x && x.role === 'user')
    .map((x) => String(x.content || ''));
  const blobA = asst.join('\n');
  const blobU = `${users.join('\n')}\n${String(userMessage || '')}`;
  const debts = [];
  const facts = [];

  const promisedMedia =
    /(?:кину|скину|пришлю|запишу|позже|скоро).{0,48}(?:фото|фотк|круж|селфи|видео)|(?:фото|круж|селфи).{0,24}(?:позже|скоро|кину)/i.test(
      blobA,
    );
  const sentMedia = /\[медиа:|<<PHOTO|<<CIRCLE|<<VIDEO|\{кружок:/i.test(blobA);
  if (promisedMedia && !sentMedia) debts.push('ты обещала фото/кружок — он может ждать');
  if (/(?:морози|не\s+дождал|где\s+(?:фото|фотк|круж)|когда\s+скинешь)/i.test(blobU)) {
    debts.push('он уже напомнил про медиа/ожидание');
  }
  if (/(?:на\s+работе\s+был|я\s+на\s+работе|на\s+смене|только\s+с\s+работы)/i.test(blobU)) {
    facts.push('он после работы / на работе');
  }
  const city = blobU.match(
    /(?:я\s+(?:из|в)\s+|живу\s+в\s+|из\s+)([А-ЯЁA-Z][а-яёa-z-]{2,20})/,
  );
  if (city) facts.push(`его город/место: ${city[1]}`);
  const name = blobU.match(/(?:меня\s+зовут|я\s+)\s*([А-ЯЁ][а-яё]{2,14})(?:\s|$|[),.])/);
  if (name && !/^(Я|Он|Нет|Да|Как)$/i.test(name[1])) facts.push(`его имя: ${name[1]}`);

  return {
    debts: debts.slice(0, 2),
    facts: facts.slice(0, 2),
  };
}

function analyzeIncoming(userMessage, history) {
  const msg = bare(userMessage);
  const speechAct = detectSpeechAct(msg);
  const emotion = detectEmotion(msg);
  const topics = detectTopics(msg);
  const herMood = pickHerMood(speechAct, emotion);
  const lastAssistant = lastRoleText(history, 'assistant').slice(0, 160);
  const referent = resolveReferent(userMessage, history, speechAct);
  const focus = extractFocusWords(msg);
  const vibe = detectVibe(speechAct, emotion, topics, msg);
  const subtext = detectSubtext(speechAct, emotion, topics, msg, referent);
  const herMove = detectHerMove(speechAct, emotion, topics, vibe, subtext, focus, referent);
  const talkAlive = detectTalkAlive(speechAct, emotion, vibe);
  const meaning = interpretMeaning(msg, speechAct, topics, emotion, referent);
  const expect = detectExpect(speechAct, emotion, topics);
  const thread = detectThreadDebt(history, userMessage);

  return {
    speechAct,
    emotion,
    topics,
    herMood,
    lastAssistant,
    msg,
    referent,
    expect,
    focus,
    meaning,
    vibe,
    subtext,
    herMove,
    talkAlive,
    debts: thread.debts,
    facts: thread.facts,
  };
}

/**
 * Единственный смысловой блок у текущего сообщения.
 * Мозг девушки: понять → как звучать → ход. Без каталога запретов.
 */
function buildAnalysisHint(userMessage, history) {
  const a = analyzeIncoming(userMessage, history);
  if (!a.msg) return null;

  const lines = [
    'Твой мозг сейчас (не пиши это в чат) — читай его как живая девушка в личке:',
    `Вайб: ${a.vibe}.`,
    `Он: ${a.meaning}.`,
    `Хочет: ${a.subtext}.`,
    `Как говорить: ${a.talkAlive}.`,
    `Ход: ${a.herMove}.`,
  ];
  if (a.debts && a.debts.length) {
    lines.push(`Долг: ${a.debts.join('; ')}.`);
  }
  if (a.facts && a.facts.length) {
    lines.push(`Факт о нём: ${a.facts.join('; ')}.`);
  }
  if (a.referent && a.referent.text && a.referent.kind !== 'none') {
    lines.push(`К чему: «${a.referent.text.slice(0, 70)}».`);
  }
  if (a.focus.length) {
    lines.push(`Слова: ${a.focus.slice(0, 3).map((w) => `«${w}»`).join(', ')}.`);
  }
  lines.push(
    'Пиши с телефона: 1 короткая фраза по ходу, женский род, «)» ок. ' +
      'Иногда своё мнение — не всегда соглашайся. Тепло важнее сухости. Не мимо темы.',
  );
  return lines.join(' ');
}

/** Ранний mood — вайб + любвеобильный тон. */
function buildMoodOverride(userMessage, history) {
  const a = analyzeIncoming(userMessage, history);
  return (
    `Вайб: ${a.vibe}. Живо и любвеобильно: ${a.talkAlive}. ` +
    'Лёгкая нежность к нему ок. Не проговаривай анализ.'
  );
}

/** @deprecated больше не пихать в softHint — анализ один раз у user turn */
function buildSoftHintFragment() {
  return null;
}

function buildSenseMust(analysis) {
  return [`ход: ${analysis.herMove}`, `смысл: ${analysis.meaning}`];
}

function buildMustAndForbid(analysis) {
  return {
    must: buildSenseMust(analysis),
    forbid: ['мимо смысла', 'голое ага/поняла вместо ответа'],
  };
}

function moodDirective(herMood) {
  return `настроение: ${herMood}`;
}

function expectDirective(expect) {
  return String(expect || '');
}

module.exports = {
  bare,
  analyzeIncoming,
  buildAnalysisHint,
  buildMoodOverride,
  buildSoftHintFragment,
  buildMustAndForbid,
  buildSenseMust,
  interpretMeaning,
  resolveReferent,
  detectExpect,
  detectSpeechAct,
  detectTopics,
  detectEmotion,
  detectVibe,
  detectSubtext,
  detectHerMove,
  detectTalkAlive,
  detectThreadDebt,
  pickHerMood,
  extractFocusWords,
  moodDirective,
  expectDirective,
};
