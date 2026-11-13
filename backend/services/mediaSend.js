/**
 * Media orchestration: voice-forbidden peers, media request/promise helpers,
 * own-media daylight filter, trySendMedia / sendRequestedMediaOrDeflect.
 * tgSendMessage — через configureMediaSend (избегаем цикла с replyPipeline).
 */
const path = require('path');
const fs = require('fs');
const { Api } = require('telegram');
const db = require('../db');

const {
  getActiveClient,
  accountLabel,
  accountDisplayName,
} = require('./clientPool');
const {
  getHistory,
  saveMessage,
} = require('./history');
const { sleep } = require('./timing');
const { isFloodError } = require('./peers');
const {
  extractVideoFrameBuffers,
  MAX_INCOMING_VIDEO_BYTES,
} = require('./inbound');
const {
  describeOwnMedia,
  classifyOwnMediaLight,
  detectReplyLanguage,
} = require('./aiResponder');
const {
  getMediaItems,
  pickUnsentMedia,
  pickMediaByContext,
  claimsIndoorSetting,
  sendMediaItem,
  pickCaption,
  mediaTag,
  clearMediaCache,
  expandMediaContextTokens,
  tokenizeMediaContext,
  isSpecificMediaSceneRequest,
} = require('./mediaReplies');
const helpRequestNotifier = require('./helpRequestNotifier');

let hooks = {
  tgSendMessage: null,
};

function configureMediaSend(next) {
  hooks = { ...hooks, ...next };
}

async function tgSendMessage(client, peer, opts) {
  if (!hooks.tgSendMessage) {
    throw new Error('mediaSend: tgSendMessage not configured');
  }
  return hooks.tgSendMessage(client, peer, opts);
}

// Собеседник запретил голосовые в настройках приватности — больше не пробуем.
const voiceForbiddenPeers = new Set();

function isVoiceForbiddenError(err) {
  return /VOICE_MESSAGES_FORBIDDEN/.test(String(err?.errorMessage || err?.message || ''));
}

// ---------------------------------------------------------------------------
// МЕДИА (фото/видео/кружки из чата по ссылке)
// ---------------------------------------------------------------------------

// Токены, которые модель вставля��т в ответ, когда нужно прислать медиа.
const MEDIA_TOKEN_RE = /<<\s*(?:PHOTO|VIDEO|CIRCLE)\s*>>/gi;

/**
 * Вырезает из ответа модели медиа-токен и возвращает чистый текст и тип
 * запрошенного медиа ('photo' | 'video' | 'circle' | null).
 */
// Отказные / «контактные» фразы, которые НЕ должны идти вместе с реальной
// отправкой медиа. Модель иногда путает отказ в номере с просьбой кружка
// и пишет «давай пока тут общаться» + <<CIRCLE>> — выглядит как фейк.
const REFUSAL_RE =
  /(пока рано|попозже|не могу|не буду|не кину|не кидаю|потом|в другой раз|рано ещё|рано еще|не сейчас|стесняюсь|давай пока тут|тут общаться|мне так удобнее|не даю|обща(ться|емся) тут|без (кружк|фото|видео)|не записываю|не снимаю)/i;

/**
 * Текст противоречит отправке медиа (отказ / «давай только текстом»).
 * На смешанных ответах («я флиплю…» + «фото попозже») — true, если ХОТЯ БЫ
 * одна строка/предложение — отказ; чистый текст про работу без отказа — false.
 */
function isContradictoryMediaText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  // Весь ответ целиком — короткий отказ.
  const bare = t.replace(/<<Q:[\d,]+>>\s*/gi, '').trim();
  if (/^(не|неа|нет|no|nope)\b/i.test(bare) && bare.length < 80) return true;
  if (REFUSAL_RE.test(bare) && bare.length < 120) return true;
  // Длинный ответ: отказ только если он занимает заметную долю (не «потом» в другом смысле).
  const lines = bare.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const refusalLines = lines.filter((l) => REFUSAL_RE.test(l) || /^(не|неа|нет|no|nope)\b/i.test(l));
  if (refusalLines.length && refusalLines.length >= Math.ceil(lines.length / 2)) return true;
  return false;
}

/** Убирает отказные куски, оставляя нормальные ответы на другие вопросы. */
function stripContradictoryMediaParts(text) {
  const src = String(text || '');
  if (!src.trim()) return '';
  const kept = src
    .split('\n')
    .map((line) => {
      const tag = (line.match(/^\s*(?:<<Q:[\d,]+>>\s*)?/) || [''])[0];
      let body = line.slice(tag.length).trim();
      if (!body) return '';
      if (REFUSAL_RE.test(body) || /^(не|неа|нет|no|nope)\b/i.test(body)) return '';
      // Отказ во второй половине: «флиплю токены, фото попозже»
      body = body
        .split(/(?<=[.!)])\s+/)
        .filter((part) => !REFUSAL_RE.test(part) && !/^(не|неа|нет|no|nope)\b/i.test(part.trim()))
        .join(' ')
        .trim();
      return body ? tag + body : '';
    })
    .filter(Boolean);
  return kept.join('\n').trim();
}

// Явная просьба прислать медиа. Нужна, чтобы:
//  1) такая просьба имела приоритет над голосовыми заготовками (вариант Б);
//  2) отличать реальный запрос от простого вопроса про уже присланное медиа.
// Требуем И глагол-просьбу («скинь/пришли/покажи/запиши/можешь»), И объект
// («фото/видео/кружок/себя»), чтобы «куда едешь на кружочке?» НЕ считалось просьбой.
const MEDIA_REQUEST_VERB_RE =
  /(?:^|[^а-яёa-z])(?:скинь|скинешь|кинь|кинешь|пришли|пришлёшь|пришлешь|отправь|отправишь|отправляй|покажись|покажи|покажешь|запиши|запишешь|сфоткай|сфоткайся|сделай|делай|можешь|можно|давай|хочу\s+(?:увидеть|посмотреть|фото|фотк|селфи|круж|видео|видос)|дай\s+посмотреть|есть\s+фото|фото\s+есть|нет\s+фото|фото\s+нет|send|share|show|drop|give|got|wanna\s+see|want\s+(?:to\s+)?see|can\s+i\s+see|let\s+me\s+see|could\s+i\s+(?:see|get)|may\s+i\s+see|mind\s+sending)(?![а-яёa-z])/i;
const MEDIA_REQUEST_OBJ_RE =
  /(фото|фотк|фоточк|фоточ|селфи|видео|видосик|видос|кружок|кружочек|кружочк|себя|как ты выглядишь|как выглядишь|своё лицо|свое лицо|личико|форм[уые]|фигур[уые]|тело|в\s+полный\s+рост|pic(?:ture)?s?|photos?|selfie|selfies|video\s*notes?|yourself|your\s+(?:face|body|shape)|how\s+you\s+look|physique)/i;
const MEDIA_REQUEST_SHORT_RE =
  /(^|\n)\s*(а\s+|ну\s+|и\s+|ещё\s+|еще\s+|просто\s+|a\s+|just\s+|ur\s+|your\s+)?(фото|фотку|фотки|фоточку|фоточки|фотографию|селфи|видео|видос|видосик|кружок|кружочек|форму|фигуру|pic(?:ture)?s?|photos?|selfie|selfies)\s*\??\s*($|\n)/i;
// «Что по фоточкам?», «где фотки», «фотки будут?», «селфи жду», «нет фото?» — без жёсткого порядка слов.
const MEDIA_REQUEST_ASK_RE =
  /((что|как|ну)\s+(там\s+)?(по|с)\s+(фот|видео|видос|круж|селфи|форм)|(где|жду|ждём|ждем)\s+(же\s+|твои\s+|тво[её]\s+|ещё\s+|еще\s+)?(фот|видео|видос|круж|селфи|форм)|(фот|видео|видос|круж|селфи|форм)\w*\s+(жду|ждём|ждем|будут|будет|то\s+будут|то\s+будет|когда|есть\??|нет\??)|(нет|нету)\s+(у\s+тебя\s+)?(фот|селфи|круж|видео|форм)|(у\s+тебя\s+)?(есть|нету?)\s+(ещё\s+|еще\s+)?(фот|селфи|круж|видео|форм)|(фот|видео|видос|круж|селфи|форм)\w*.{0,40}(?:так\s+и\s+)?не\s+(?:присл|скин|кину|отправ)|(так\s+и\s+)?не\s+(?:присл|скин|кину|отправ)\w*.{0,24}(фот|видео|видос|круж|селфи|форм))/i;
// EN: "can I see a pic of you?", "send me a photo", "can I see you?", "pic?", "sent me"/"show me" (typo/short)
const MEDIA_REQUEST_EN_RE =
  /(?:can\s+i\s+see\s+you(?:\s+\w{1,12})?\s*[?.!]*$|can\s+i\s+see\s+(?:a\s+|your\s+|some\s+)?(?:pic(?:ture)?s?|photos?|selfie|you)|let\s+me\s+see\s+(?:a\s+|your\s+|some\s+)?(?:pic(?:ture)?s?|photos?|selfie|you)|(?:send|sent|share|show|drop|give)\s+(?:me\s+)?(?:a\s+|your\s+|some\s+)?(?:pic(?:ture)?s?|photos?|selfie)|(?:pic(?:ture)?|photo|selfie)\s+of\s+you|your\s+(?:pic(?:ture)?s?|photos?|selfie|body|shape)|(?:got|have)\s+(?:a\s+)?(?:pic(?:ture)?|photo|selfie)|wanna\s+see\s+(?:you|your\s+(?:pic|photo|face|body))|show\s+(?:me\s+)?yourself|how\s+do\s+you\s+look|^(?:send|sent|show)\s+me\s*[?.!]*$)/i;
// Обещание прислать медиа «потом» — без реальной отправки выглядит как бот-стилка.
// Обещание медиа — только с объектом или явным «потом/поищу/найду» + фото/видео/кружок.
const MEDIA_PROMISE_RE =
  /((?:щас|сейчас|ща|щя)[,\s]+(?:подожди[,\s]+)?(?:найду|поищу|скину|кину|отправлю|выберу|сфоткаюсь|запишу)\s+(?:тебе\s+)?(?:фот|фото|круж|видео|видос|селфи)|поищу\s+(?:нормальн|хорош|фот|получше)|(?:скину|кину|отправлю)\s+(?:позже|потом|попозже)\s+(?:фот|фото|круж|видео|селфи)?|(?:скину|кину|отправлю).{0,28}(?:позже|потом|попозже)|(?:скину|кину|отправлю)\s+(?:тебе\s+)?(?:фот|фото|кружок|видео|видос|селфи)|(?:фот|фото|круж|видео|видос|селфи|pic|photo)\w*.{0,24}(?:попозже|потом|позже|later)|(?:попозже|потом|позже|later).{0,24}(?:фот|фото|круж|видео|селфи|скину|кину|pic|photo)|напомни\s+потом\s+(?:про\s+)?(?:фот|фото|круж)|потом[,\s]+(?:скину|кину|отправлю|сфотка)|(?:sec|one\s+sec|hold\s+on)[^.?\n]{0,40}(?:find|send|pic|photo)|(?:ill|i'?ll)\s+(?:find|send|pick)\s+(?:one|a\s+pic|a\s+photo|it))/i;

/** «что-то милое на утро отправлю» / «щас скину что-то милое» — без слова «фото». */
const CUTE_MEDIA_PROMISE_RE =
  /(?:что-то\s+)?мил(?:ое|ую|ый|ая).{0,48}(?:скину|кину|отправлю|пришлю|найду|поищу)|(?:скину|кину|отправлю|пришлю|найду|поищу).{0,48}(?:что-то\s+)?мил(?:ое|ую|ый|ая)|на\s+утро\s+(?:что-то\s+)?(?:мил\w+\s+)?(?:скину|кину|отправлю|пришлю)|(?:скину|кину|отправлю|пришлю).{0,24}на\s+утро|(?:утром|с\s+утра)\s+(?:скину|кину|отправлю|пришлю)|(?:щас|сейчас|ща|щя)\s+(?:скину|кину|отправлю|пришлю)\s+(?:что-то\s+)?мил/i;

/** Он напоминает про обещанное («ну я жду», «а где милое», «где фото», «нету»). */
const MEDIA_PROMISE_NUDGE_RE =
  /(?:^|\s)(?:ну\s+)?(?:я\s+)?жду(?:\s|$)|а\s+где\s+(?:что-то\s+)?мил|где\s+(?:же\s+)?(?:что-то\s+)?мил|будет\s+(?:что-то\s+)?мил|ну\s+что\s+там|а\s+если\s+не\s+скин|так\s+и\s+не\s+(?:скин|присл)|забыла\s+(?:про\s+)?(?:фот|мил)|ты\s+обещала|обещала\s+(?:же|скин)|(?:^|\s)(?:а\s+)?где\s+(?:же\s+)?(?:фото|фотк|билет|картинк|селфи)|(?:фото|фотк|билет).{0,16}где|не\s+прикреп|не\s+пришл|зачем\s+.{0,28}текст|шутишь\s*\?|where(?:'?s|\s+is)\s+(?:the\s+)?(?:pic|photo|cute|ticket)|still\s+waiting|you\s+promised/i;

/** Голый филлер вместо обещанного файла. */
const BARE_MEDIA_FILLER_RE =
  /^(?:ничего\s+особенного|да\s+по\s+делам|та\s+так(?:\s*,?\s*по\s+своим)?|да\s+нич[её]\s+такого|просто\s+смотрит?\s+сериал)\s*\)?$/i;

function isMediaPromiseText(content) {
  const t = String(content || '');
  return MEDIA_PROMISE_RE.test(t) || CUTE_MEDIA_PROMISE_RE.test(t);
}

/** Сообщение-правка опечатки («*поищу» / «поищу*») — не шлём и не считаем репликой. */
function isTypoFixMessage(content) {
  const t = String(content || '').trim();
  if (!t || !/[*]/.test(t)) return false;
  return /^\*?[а-яёa-z]{2,30}\*?$/i.test(t);
}

/**
 * Из входящего кружка/фото/видео модель видит длинное описание кадров.
 * Там часто «можно увидеть» + слово «кружок» в теге — это НЕ просьба скинуть своё.
 * Для детекта просьбы берём только речь/подпись собеседника.
 *
 * Также вырезаем цитаты ответа («[ответ на «…»]», «[Ответ на сообщение
 * собеседника: "…"]»). Иначе чужая фраза из цитаты читалась как просьба:
 * собеседник отвечал «👍» на «давай лучше тут общаться», а в цитате было
 * слово «видео» — и бот считала это просьбой прислать видео.
 */
function userTextForMediaIntent(text) {
  const raw = String(text || '')
    .replace(/\[(?:ответ на|уточнение к|Ответ на сообщение собеседника:)[^\]]*\]:?/gi, ' ')
    .replace(/\[уточнение к[^\]]*\]/gi, ' ')
    .replace(/\[\s*\]/g, ' ')
    .trim();
  if (!/\[(?:кружок|фото|видео)\s+от\s+собеседника\]/i.test(raw)) return raw;
  const bits = [];
  for (const m of raw.matchAll(/на видео сказано:\s*[«"]([^»"]+)[»"]/gi)) {
    if (m[1]) bits.push(m[1]);
  }
  for (const m of raw.matchAll(/Подпись:\s*"([^"]*)"/gi)) {
    if (m[1] && !/^кадр\s+из\s+(кружок|фото|видео)/i.test(m[1].trim())) bits.push(m[1]);
  }
  return bits.join(' ').trim();
}

function lastAssistantPromisedMedia(history) {
  const rows = Array.isArray(history) ? history : [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0 && seen < 14; i -= 1) {
    if (rows[i].role !== 'assistant') continue;
    const content = String(rows[i].content || '');
    if (isTypoFixMessage(content)) continue;
    if (/\[медиа:#\d+\]/.test(content)) return false;
    seen += 1;
    if (isMediaPromiseText(content) || MEDIA_STALL_RE.test(content)) return true;
  }
  return false;
}

function userNudgesPromisedMedia(text) {
  const t = userTextForMediaIntent(text);
  if (!t) return false;
  return MEDIA_PROMISE_NUDGE_RE.test(t);
}

/**
 * Он ответил цитатой на сообщение, но в самой цитате есть слова про медиа
 * («ответ на «держи, соскучилась»"»). Это НЕ просьба прислать ещё.
 */
function userAskedViaQuoteOnly(text, history) {
  const raw = String(text || '');
  const hasQuote = /\[(?:ответ на|уточнение к|Ответ на сообщение собеседника:)/i.test(raw);
  if (!hasQuote) return false;
  const body = raw
    .replace(/\[(?:ответ на|уточнение к|Ответ на сообщение собеседника:)[^\]]*\]:?/gi, ' ')
    .trim();
  if (body.split(/\s+/).filter(Boolean).length > 3) return false;
  return true;
}

// Отмазки-затяжки: «всё ещё ищу», «не могу найти», «щас сделаю новую». Держим
// отдельно от MEDIA_PROMISE_RE — вне разговора про фото эти фразы безобидны,
// поэтому срабатывают только когда человек реально ждёт медиа.
const MEDIA_STALL_RE =
  /(вс[её]\s+ещ[её]\s+ищу|пока\s+ищу|просто\s+ищу|^ищу(?![а-яёa-z0-9])|ищу\s+(фот|виде|круж|норм|подход|получше)|не\s+могу\s+(?:найти|выбрать|отыскать)\s+(?:норм|подход|хорош|фот|виде|круж|получше|ничего|ни\s*одн)|(щас|сейчас|ща|щя)\s+(попробую|сделаю|гляну|посмотрю|поищу)|попробую\s+ещ[её]\s+раз|сделаю\s+нов|(?:^|[.!\s,)])\s*(?:чуть\s+)?(?:попозже|потом|позже)(?![а-яёa-z0-9])|давай\s+(?:чуть\s+)?(?:попозже|потом)|still\s+looking|can'?t\s+find|cant\s+find|let\s+me\s+try\s+again|(?:maybe\s+)?later(?![a-z0-9])|in\s+a\s+(?:bit|sec|minute))/i;

/** Сколько обещаний подряд терпим, прежде чем перестать кормить «завтраками». */
const MEDIA_PROMISE_MAX = 2;

// Явный ОТКАЗ прислать медиа («не могу такое скинуть», «не буду отправлять»).
// Если модель так ответила — это не «обещание», форсировать отправку нельзя:
// иначе файл уходит против её же слов, а постобработка калечит текст
// («не могу такое скинуть» → «не могу такое ть»).
const MEDIA_REFUSAL_RE =
  /(не\s+(?:могу|буду|хочу|стану)\s+(?:такое|это|тебе|сейчас)|не\s+(?:могу|буду|хочу)\s+\S{0,12}\s*(?:скин|кину|отправ|присл|показ|запис)|без\s+фот|не\s+(?:по\s+)?фотк|не\s+в\s+настроении\s+(?:кидать|скидывать|фоткаться))/i;

/**
 * Сколько раз подряд бот пообещала медиа и ничего не прислала.
 * Отсчёт идёт с конца истории и обрывается на реально отправленном медиа.
 */
function unfulfilledMediaPromiseCount(history) {
  const rows = Array.isArray(history) ? history : [];
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== 'assistant') continue;
    const content = String(row.content || '');
    if (/\[медиа:#\d+\]/.test(content)) break;
    if (isTypoFixMessage(content)) continue;
    if (isMediaPromiseText(content) || MEDIA_STALL_RE.test(content)) count += 1;
  }
  return count;
}

// Обещание вместе с объектом («щас сделаю кружок)», «сейчас запишу видео»),
// чтобы после вырезания не оставалось висячего «ага, кружок)».
const MEDIA_PROMISE_WITH_OBJECT_RE =
  /(?:ага\s*)?(?:щас|сейчас|ща|щя|ok|okay|one\s+sec)[,\s]+(?:сделаю|запишу|сниму|скину|кину|отправлю|поищу|найду|выберу)\s+(?:тебе\s+)?(?:кружок|кружочек|видео|видосик|видос|фото|фотку|фоточку|селфи|video\s*note|photo|pic|selfie)\w*[)!.]*/gi;

/** «щас поищу и скину» / «щас найду и кину» — целиком, без объекта. */
const MEDIA_PROMISE_FIND_AND_SEND_RE =
  /(?:ага\s*)?(?:щас|сейчас|ща|щя|ok|okay|one\s+sec)[,\s]+(?:подожди[,\s]+)?(?:найду|поищу|выберу)(?:\s+и\s+(?:скину|кину|отправлю))?(?:\s+(?:тебе\s+)?(?:фот\w*|фото|круж\w*|видео|видос|селфи|мил\w+))?[\s)!.,]*/gi;

/** «щас скину что-то милое» / «на утро отправлю». */
const CUTE_MEDIA_PROMISE_STRIP_RE =
  /(?:ага\s*)?(?:щас|сейчас|ща|щя)?[,\s]*(?:что-то\s+)?мил(?:ое|ую|ый|ая)[^.!?\n]{0,40}(?:скину|кину|отправлю|пришлю|найду|поищу)|(?:щас|сейчас|ща|щя)[,\s]+(?:скину|кину|отправлю|пришлю)\s+(?:что-то\s+)?мил\w*[)!.]*|(?:на\s+утро|утром)[^.!?\n]{0,24}(?:скину|кину|отправлю|пришлю)|(?:скину|кину|отправлю|пришлю)[^.!?\n]{0,24}(?:на\s+утро|утром|мил\w*)/gi;

/** Обрубок после частичного стрипа: «и скину», «подожди немного)», «скину». */
const MEDIA_PROMISE_REMNANT_RE =
  /^(?:(?:ну|ага|угу|ок|окей)\s+)?(?:и\s+)?(?:скину|кину|отправлю|поищу|найду|выберу|подожди(?:\s+(?:немного|чуть|секунду|сек))?)(?:\s+(?:тебе|немного|чуть|секунду|сек|фот\w*|фото|круж\w*|видео|селфи))?[\s)!.]*$/i;

/** Убирает из ответа само обещание, оставляя остальной текст. */
function stripMediaPromise(outText) {
  let cleaned = String(outText || '')
    .replace(CUTE_MEDIA_PROMISE_STRIP_RE, ' ')
    .replace(MEDIA_PROMISE_FIND_AND_SEND_RE, ' ')
    .replace(MEDIA_PROMISE_WITH_OBJECT_RE, ' ')
    .replace(MEDIA_PROMISE_RE, ' ')
    .replace(MEDIA_STALL_RE, ' ')
    // Хвост «… и скину)» / «… скину)» после частичного вырезания.
    .replace(
      /(?:^|[\s,.;:]+)(?:и\s+)?(?:скину|кину|отправлю|поищу|найду)(?:\s+(?:тебе\s+)?(?:фот\w*|фото|круж\w*|видео|селфи|мил\w+))?[\s)!.]*$/gi,
      ' ',
    )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, '')
    .trim();
  if (cleaned.length < 4) return '';
  if (MEDIA_PROMISE_REMNANT_RE.test(cleaned)) return '';
  if (isMediaPromiseText(cleaned) || MEDIA_STALL_RE.test(cleaned)) return '';
  return cleaned;
}

/** Короткое «давай/жду» после нашего «щас найду» — ждёт медиа. Не любой короткий вопрос. */
const MEDIA_PROMISE_ACK_RE =
  /^(?:(?:ну|да|ок|окей|ага|угу|ладно|хорошо|давай|го|(?:ну\s+)?(?:я\s+)?жду|ждём|ждем|кидай|скидывай|можно|любые?|любой|вайб|вай|yes|yeah|ok|okay|sure|go|send|pls|please)\b[\s)!.]*)+$/i;
const CONTENT_QUESTION_RE =
  /(?:почему|зачем|отчего|когда|куда|откуда|сколько|какой|какая|какие|что\s+за|а\s+почему|why|when|where|how\s+come)/i;

function lastAssistantClaimedMediaSend(history) {
  const rows = Array.isArray(history) ? history : [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0 && seen < 4; i -= 1) {
    if (rows[i]?.role !== 'assistant') continue;
    const c = String(rows[i].content || '');
    if (/\[медиа:#\d+\]/.test(c)) return false;
    seen += 1;
    if (
      /(?:^|[\s,])(?:держи|лови|нашла|вот\s*,?\s*держи|как\s+тебе\s*\??|это\s+я\)|лови\))/i.test(
        c,
      ) ||
      isMediaPromiseText(c)
    ) {
      return true;
    }
  }
  return false;
}

function isHardMediaRequest(text, history = null) {
  if (!text) return false;
  const t = userTextForMediaIntent(text);
  if (!t) return false;
  if (MEDIA_REQUEST_VERB_RE.test(t) && MEDIA_REQUEST_OBJ_RE.test(t)) return true;
  if (MEDIA_REQUEST_SHORT_RE.test(t)) return true;
  if (MEDIA_REQUEST_ASK_RE.test(t)) return true;
  if (MEDIA_REQUEST_EN_RE.test(t)) return true;
  if (/(есть|скинь|покажись|покажи|пришли|кинь).{0,48}(фото|фотк|видео|круж|себя|селфи|форм|фигур|тело)/i.test(t)) return true;
  // «Где фото? / Где билет?» — всегда просьба файла (даже если бот «отправила» текстом).
  if (
    /(?:^|\s)(?:а\s+)?где\s+(?:же\s+)?(?:фото|фотк|билет|селфи|кружок)|(?:фото|фотк|билет).{0,16}где|не\s+прикреп|зачем\s+.{0,28}текст/i.test(
      t,
    )
  ) {
    return true;
  }
  // Бот пообещала / сделала вид что скинула — ждёт nudge или короткое «давай/жду».
  if (
    history &&
    (lastAssistantPromisedMedia(history) ||
      unfulfilledMediaPromiseCount(history) > 0 ||
      lastAssistantClaimedMediaSend(history))
  ) {
    if (userNudgesPromisedMedia(t)) return true;
    const bare = t.trim();
    // «а где милое?» — nudge, не «почему Донецк».
    if (CONTENT_QUESTION_RE.test(bare) && !/мил|фот|фото|билет|pic|cute/i.test(bare)) {
      return false;
    }
    if (bare.split(/\s+/).length <= 8 && MEDIA_PROMISE_ACK_RE.test(bare)) return true;
  }
  return false;
}

function isExplicitMediaRequest(text, history = null) {
  if (isHardMediaRequest(text, history)) return true;
  // Тема внешности («ты высокая?», «какие волосы?») — тоже повод кинуть фото по смыслу.
  return isTopicPhotoRequest(text);
}

function recentUserAskedMedia(text, history) {
  const recentUser = (history || [])
    .filter((h) => h && h.role === 'user')
    .slice(-3)
    .map((h) => userTextForMediaIntent(h.content || ''));
  return [userTextForMediaIntent(text), ...recentUser].some((s) => MEDIA_REQUEST_OBJ_RE.test(String(s || '')));
}

/**
 * «щас найду, подожди» без реального медиа в этом же ходе.
 * Если медиа-чат есть — не уводим с темы, а возвращаем флаг «надо слать».
 * Если медиа-чата нет — мягкий уход (как раньше).
 */
function resolveMediaPromise(outText, mediaType, text, history, hasMediaLink) {
  if (!outText) return { outText, forceMedia: false };
  // Вещи/коробки — раньше любого force: кадров нет, селфи не подставляем.
  if (isPackedThingsPhotoAsk(text, history) || isPackedThingsPhotoAsk(outText, history)) {
    return {
      outText: pickPackedThingsExcuse(),
      forceMedia: false,
      packedThings: true,
    };
  }
  // Медиа уже уходит в этом ходе (модель вставила токен): обещание
  // «щас найду/запишу/сделаю» лишнее — оно обещает СВЕЖУЮ съёмку, а уходит
  // готовый файл. Оставляем только живую реакцию, иначе собеседник ждёт «сейчас»
  // и ловит рассинхрон («это же не сейчас»).
  if (mediaType) {
    // Файл реально уходит — не оставляем «и скину» / «подожди немного)».
    // И не оставляем отказ («не кину / без фоток») вместе с файлом.
    let cleaned = stripMediaPromise(outText);
    if (
      MEDIA_REFUSAL_RE.test(cleaned) ||
      /не\s+кину|не\s+кидаю|без\s+фот|стыдно|расскажу\s+текстом|давай\s+без\s+фото/i.test(
        cleaned,
      )
    ) {
      cleaned = ['ща)', 'держи)', 'лови)', 'ну лови)'][Math.floor(Math.random() * 4)];
    }
    return { outText: cleaned, forceMedia: false };
  }

  const userWantsMedia =
    recentUserAskedMedia(text, history) || isExplicitMediaRequest(text, history);
  // Ответ цитатой на «держи, соскучилась» — не просьба прислать ещё файл.
  if (userAskedViaQuoteOnly(text, history)) {
    return { outText: stripMediaPromise(outText), forceMedia: false };
  }
  const promised = isMediaPromiseText(outText);
  const stalling = userWantsMedia && MEDIA_STALL_RE.test(outText);
  if (!promised && !stalling) return { outText, forceMedia: false };
  // Жёсткий отказ («не могу такое скинуть») — не форсим файл.
  // Мягкая оттяжка («попозже») уже в promised/stalling — не глотаем её тут.
  if (MEDIA_REFUSAL_RE.test(outText) && !promised && !stalling) {
    return { outText, forceMedia: false };
  }

  const stripped = stripMediaPromise(outText);
  const debt = unfulfilledMediaPromiseCount(history) > 0;
  // Повторное «щас скину милое» при уже висящем долге — шлём файл, не кормим завтраками.
  const renewingDebt = promised && debt;

  // Модель сама вписала «щас найду фотку» без просьбы и без долга — не форсим.
  if (!userWantsMedia && !renewingDebt) {
    return { outText: stripped || pickMediaFailDeflect(text), forceMedia: false };
  }
  // Обещали уже несколько раз подряд, а медиа в истории так и не появилось —
  // значит отправка не доходит. Хватит кормить «завтраками»: уходим с темы.
  if (unfulfilledMediaPromiseCount(history) >= MEDIA_PROMISE_MAX && !userWantsMedia) {
    return { outText: pickMediaFailDeflect(text), forceMedia: false, exhausted: true };
  }
  // Обещала после просьбы / при долге и медиа есть — пусть шлёт.
  if (hasMediaLink) return { outText: stripped, forceMedia: true, preferPhoto: true };
  return { outText: pickMediaFailDeflect(text), forceMedia: false };
}

function fixUnfulfilledMediaPromise(outText, mediaType, text, history) {
  const r = resolveMediaPromise(outText, mediaType, text, history, false);
  return r.outText;
}

function detectRequestedMediaType(text) {
  const t = userTextForMediaIntent(text);
  if (/кружок|кружочек|video\s*note|circle\s*video/i.test(t)) return 'circle';
  if (/(?:^|[^а-яёa-z])(?:видео|видос|videos?)(?![а-яёa-z])/i.test(t) && !/video\s*note/i.test(t)) {
    return 'video';
  }
  return 'photo';
}

const MEDIA_FAIL_DEFLECTS = [
  'ой что-то с фотками затык, давай лучше расскажи как день)',
  'неа, давай про тебя) чем сейчас занят?',
  'давай без фоток, расскажи лучше что у тебя нового)',
  'сейчас не кину, лучше напиши что интересного было)',
];
const MEDIA_FAIL_DEFLECTS_EN = [
  'ugh pics acting up, tell me about your day instead)',
  'cant pull one up rn, whats new with you)',
  'skip the pics for now — what are you up to?',
];
const MEDIA_FAIL_DEFLECTS_SCENE = [
  'хм таких фоток нет под рукой)',
  'неа, такого кадра нет, давай текстом)',
  'ой нет подходящего, лучше расскажи что у тебя)',
];

/** Фото вещей/коробок/сборов в медиа-чате нет — только отмазка, не селфи. */
const PACKED_THINGS_TOPIC_RE =
  /(?:вещ[иеяй]|коробк|сбор(?:ы|ов|ать)?|упаков|собрал[аи]?|уместит|потих[ао]ньку\s+вещ)/i;
const PACKED_THINGS_WANT_RE =
  /(?:фото|фотк|скин|пришл|отправ|сфотк|покаж|кинь|кинуть|есть\s+(?:ли\s+)?фото|сколько\s+вещ)/i;
const PACKED_THINGS_EXCUSES = [
  'ой бардак такой, стыдно кидать)',
  'хах вещей в кадре нет — сама ещё в куче)',
  'неа, не фоткала сборы, там срач)',
  'ну давай без фото коробок, расскажу текстом)',
  'стыдно такое кидать, лучше словами)',
];

function pickPackedThingsExcuse() {
  return PACKED_THINGS_EXCUSES[Math.floor(Math.random() * PACKED_THINGS_EXCUSES.length)];
}

/**
 * Просьба кадра вещей/коробок/«сколько собрала» — в пуле таких фото нет.
 * history: короткий «покажешь?» после разговора про сборы тоже ловим.
 */
function isPackedThingsPhotoAsk(text, history = null) {
  const t = userTextForMediaIntent(text);
  if (!t) return false;
  if (PACKED_THINGS_TOPIC_RE.test(t) && PACKED_THINGS_WANT_RE.test(t)) return true;
  if (/сколько\s+вещ/i.test(t)) return true;
  const bare = t.trim();
  const shortNudge =
    /^(?:ну\s+)?(?:покажешь|скинь|кинь|давай|фотку|фото)\s*[?)!.]*$/i.test(bare) ||
    /^(?:так\s+)?сейчас\s+просто\s+сфоткай/i.test(bare);
  if (!shortNudge) return false;
  const recent = (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((h) => String(h?.content || ''))
    .join(' ');
  return PACKED_THINGS_TOPIC_RE.test(`${recent} ${t}`);
}

function pickMediaFailDeflect(userText = '') {
  const t = String(userText || '');
  if (/билет|ticket|скрин|прибыл|профит/i.test(t)) {
    return [
      'хм билета под рукой нет, давай текстом)',
      'ой такого кадра нет, лучше расскажи что у тебя)',
      'неа, билет сейчас не найду — чем сам занят?',
    ][Math.floor(Math.random() * 3)];
  }
  if (PACKED_THINGS_TOPIC_RE.test(t) || /сколько\s+вещ/i.test(t)) {
    return pickPackedThingsExcuse();
  }
  if (
    /юбк|платье|машин|в\s+зале|спортзал|на\s+улиц|у\s+зеркал/i.test(
      t,
    )
  ) {
    return MEDIA_FAIL_DEFLECTS_SCENE[
      Math.floor(Math.random() * MEDIA_FAIL_DEFLECTS_SCENE.length)
    ];
  }
  const en = /\b(pic|photo|selfie|see you|send|show)\b/i.test(t);
  const bank = en ? MEDIA_FAIL_DEFLECTS_EN : MEDIA_FAIL_DEFLECTS;
  return bank[Math.floor(Math.random() * bank.length)];
}

// Было ли ПОСЛЕДНЕЕ сообщение бота отправкой медиа (метка [медиа:#id]).
// Используем, чтобы не слать второе медиа в ответ на уточняющий вопрос
// про предыдущее («а куда едешь на кружочке?»).
function lastAssistantWasMedia(history) {
  if (!Array.isArray(history)) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      return /\[медиа:#\d+\]/.test(String(history[i].content || ''));
    }
  }
  return false;
}

// Сомнение собеседника, что медиа снято не сейчас («это не сейчас же?»,
// «это тоже старое?»). После такой реплики нельзя слать ещё один готовый файл —
// это подтверждает, что все фото из архива, и превращается в петлю.
const PEER_MEDIA_NOT_FRESH_RE =
  /(это\s+не\s+(сейчас|свеж|сегодня)|не\s+сейчас\s+же|тоже\s+не\s+(сейчас|свеж|сегодня)|(это|тоже)\s+(старое|старая|старый|из\s+прошл|давно|не\s+свеж|не\s+сегодня)|(старое|старая|старый)\s+(фото|фотк|селфи|кадр|снимок)|ты\s+(это\s+)?(давно|раньше)\s+(снял|записал|сделал)|это\s+же\s+давно|not\s+(now|recent|fresh)|is\s+this\s+(old|recent)|(old|recent)\s+(photo|pic|picture)|was\s+this\s+taken\s+(now|recently))/i;

/** Жаловался ли он недавно, что присланное медиа не свежее (последние 2 реплики). */
function peerComplainedMediaNotFresh(userText, history) {
  if (PEER_MEDIA_NOT_FRESH_RE.test(String(userText || ''))) return true;
  const rows = Array.isArray(history) ? history : [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0 && seen < 4; i -= 1) {
    if (rows[i]?.role !== 'user') continue;
    seen += 1;
    if (PEER_MEDIA_NOT_FRESH_RE.test(String(rows[i].content || ''))) return true;
  }
  return false;
}

// Отказ бота от видео/кружка («я стесняюсь видео», «давай лучше тут общаться»).
const MEDIA_SELF_REFUSAL_RE =
  /((я\s+)?(стесняюсь|не\s+буду|не\s+хочу|не\s+могу)\s+[^.!?\n]{0,20}(видео|видос|кружок|кружочек|камер|запис)|давай\s+лучше\s+(тут|текстом)|лучше\s+(тут|текстом)\s+общаться)/i;

/** Отказывалась ли бот от видео/кружка в последних репликах (до последнего медиа). */
function botRecentlyRefusedVideo(history) {
  const rows = Array.isArray(history) ? history : [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0 && seen < 6; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== 'assistant') continue;
    const content = String(row.content || '');
    if (/\[медиа:#\d+\]/.test(content)) break;
    seen += 1;
    if (MEDIA_SELF_REFUSAL_RE.test(content)) return true;
  }
  return false;
}

// «Ты реальная?», «докажи что ты не бот», «хочется общаться с реальным человеком».
// Внимание: \w в JS не матчит кириллицу — только [а-яё].
const PEER_VERIFY_HUMAN_RE =
  /(реальн[а-яё]*\s+(ты|ли|человек|человека|или)|ты\s+реальн|докаж[а-яё]*\s+(что\s+)?(ты\s+)?(реальн|человек|не\s+бот)|ты\s+(бот|не\s+человек)|реальн[а-яё]*\s+человек|точно\s+(жив[а-яё]*|человек|реальн)|настоящ[а-яё]*\s+(ты|человек)|prove\s+(you|that)\s+(are\s+)?(real|human)|are\s+you\s+(a\s+)?(bot|real|human)|(real|actual)\s+human)/i;

function peerAsksToProveHuman(text) {
  return PEER_VERIFY_HUMAN_RE.test(userTextForMediaIntent(text));
}

/**
 * Модель иногда копирует служебную метку истории
 * `[медиа:#222] {кружок: …}` или выдумывает `[отправила фото билета]` /
 * `[фото билета]` вместо <<PHOTO>> — это нельзя слать текстом в чат.
 * Вырезаем метку; тип медиа и живой хвост («ну а у тебя как?») сохраняем.
 */
function stripLeakedMediaHistoryTag(reply) {
  let text = String(reply || '');
  const typeMap = { фото: 'photo', видео: 'video', кружок: 'circle', медиа: 'photo' };
  let leakedType = null;

  // Служебные теги вырезаем ЦЕЛИКОМ — описание внутри {кружок: …} в чат не пускаем.
  text = text.replace(
    /\[медиа:#\d+\]\s*\{(фото|видео|кружок|медиа)\s*:\s*[^}]*\}/gi,
    (_, kind) => {
      leakedType = typeMap[String(kind).toLowerCase()] || leakedType;
      return '';
    },
  );
  text = text.replace(/\[медиа:#\d+\]\s*/gi, () => {
    if (!leakedType) leakedType = 'circle';
    return '';
  });
  text = text.replace(/\{(фото|видео|кружок|медиа)\s*:\s*[^}]*\}/gi, (_, kind) => {
    leakedType = typeMap[String(kind).toLowerCase()] || leakedType;
    return '';
  });

  // Метка для модели из истории: «[ты отправила фото: …]» / «[ты отправила медиа]».
  // Модель копирует её в ответ — без стрипа уходит текстом в Telegram (баг 29.10).
  text = text.replace(
    /\[\s*ты\s+отправил[аеи]?\s+(фото|видео|кружок|медиа)\s*(?::\s*[^\]]{0,240})?\]/gi,
    (_, kind) => {
      const k = String(kind || '').toLowerCase();
      if (/круж/.test(k)) leakedType = leakedType || 'circle';
      else if (/видео/.test(k)) leakedType = leakedType || 'video';
      else leakedType = leakedType || 'photo';
      return '';
    },
  );
  // Старый формат истории: «(раньше ушло медиа — это не писать в чат)» — копировали дословно.
  text = text.replace(
    /\(?\s*раньше\s+ушло\s+(медиа|фото|видео|кружок)(?:\s*:\s*[^)—\-]{0,200})?\s*[—\-–]?\s*(?:это\s+)?не\s+писать\s+в\s+чат\s*\)?/gi,
    (_, kind) => {
      const k = String(kind || '').toLowerCase();
      if (/круж/.test(k)) leakedType = leakedType || 'circle';
      else if (/видео/.test(k)) leakedType = leakedType || 'video';
      else leakedType = leakedType || 'photo';
      return '';
    },
  );
  text = text.replace(
    /\(?\s*раньше\s+ушло\s+(медиа|фото|видео|кружок)[^)\n]{0,80}\)?/gi,
    (_, kind) => {
      const k = String(kind || '').toLowerCase();
      if (/круж/.test(k)) leakedType = leakedType || 'circle';
      else if (/видео/.test(k)) leakedType = leakedType || 'video';
      else leakedType = leakedType || 'photo';
      return '';
    },
  );
  // Новый формат истории без скобок: «ты уже отправила кружок: …»
  text = text.replace(
    /(?:^|\n)\s*ты\s+уже\s+отправил[аеи]?\s+(фото|видео|кружок|медиа)\s*(?::\s*[^\n]{0,160})?/gi,
    (_, kind) => {
      const k = String(kind || '').toLowerCase();
      if (/круж/.test(k)) leakedType = leakedType || 'circle';
      else if (/видео/.test(k)) leakedType = leakedType || 'video';
      else leakedType = leakedType || 'photo';
      return '\n';
    },
  );
  text = text.replace(
    /\[\s*(?:you\s+)?(?:sent|shared)\s+(?:a\s+)?(photo|video|circle|media)\s*(?::\s*[^\]]{0,240})?\]/gi,
    (_, kind) => {
      const k = String(kind || '').toLowerCase();
      if (/circle/.test(k)) leakedType = leakedType || 'circle';
      else if (/video/.test(k)) leakedType = leakedType || 'video';
      else leakedType = leakedType || 'photo';
      return '';
    },
  );

  // Псевдо-действия: «[отправила фото билета]», «[фото билета]», «[кинула кружок]».
  // Также незакрытые «[отправила фото: Селфи» без «]».
  text = text.replace(
    /\[\s*(?:отправил[аеи]?|послал[аеи]?|скинул[аеи]?|кинул[аеи]?|прислал[аеи]?|показал[аеи]?|send(?:ing|s)?|sent|shared?)\s+([^\]]{0,80})\]/gi,
    (_, body) => {
      const b = String(body || '').toLowerCase();
      if (/круж/.test(b)) leakedType = leakedType || 'circle';
      else if (/видео|видос|video/.test(b)) leakedType = leakedType || 'video';
      else leakedType = leakedType || 'photo';
      return '';
    },
  );
  text = text.replace(
    /\[\s*(?:отправил[аеи]?|послал[аеи]?|скинул[аеи]?|кинул[аеи]?|прислал[аеи]?)\s+(?:фото|фотк\w*|селфи|видео|кружок|pic|photo)[^\n\[]{0,80}/gi,
    () => {
      leakedType = leakedType || 'photo';
      return '';
    },
  );
  text = text.replace(
    /\[\s*(фото|фотк\w*|селфи|видео|видос\w*|кружок|кружочек|pic|photo|selfie|video)([^\]]{0,60})\]?/gi,
    (_, kind) => {
      const k = String(kind || '').toLowerCase();
      if (/круж/.test(k)) leakedType = leakedType || 'circle';
      else if (/видео|видос|video/.test(k)) leakedType = leakedType || 'video';
      else leakedType = leakedType || 'photo';
      return '';
    },
  );

  text = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text, leakedType };
}

function extractMediaRequest(reply) {
  const first = String(reply || '').match(/<<\s*(PHOTO|VIDEO|CIRCLE)\s*>>/i);
  const map = { PHOTO: 'photo', VIDEO: 'video', CIRCLE: 'circle' };
  const fromToken = first ? map[first[1].toUpperCase()] : null;
  const stripped = stripLeakedMediaHistoryTag(
    String(reply || '')
      .replace(MEDIA_TOKEN_RE, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
  let text = stripped.text;
  // fromLeak: модель написала «[фото билета]» / «[отправила фото]» вместо токена —
  // текст чистим, но файл ОБЯЗАН уйти (иначе в чат утекает псевдо-действие).
  const fromLeak = !fromToken && !!stripped.leakedType;
  const mediaType = fromToken || stripped.leakedType || null;

  // Подстраховка: если модель всё же прислала отказ ВМЕСТЕ с медиа-токеном
  // (например «не, давай пока тут общаться)» + <<CIRCLE>>), убираем
  // противоречивый текст — раз медиа реально уходит, отказ выглядит как фейк.
  if (mediaType && isContradictoryMediaText(text)) {
    text = stripContradictoryMediaParts(text);
  }

  return { text, mediaType, fromLeak };
}

/**
 * Возвращает множество id медиа, которые уже отправлялись этом�� собеседнику
 * (для дедупа — не шлём одно и то же дважды).
 */
async function getSentMediaSet(accountId, peerId) {
  const [rows] = await db.execute(
  `SELECT content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND content LIKE '[медиа:#%'`,
    [accountId, peerId],
  );
  const set = new Set();
  for (const r of rows) {
    const m = String(r.content).match(/\[медиа:#(\d+)\]/);
    if (m) set.add(Number(m[1]));
  }
  return set;
}

/** Когда можно самой кинуть кружок по смыслу (не по прямой просьбе). */
const CONTEXTUAL_CIRCLE_MIN_HISTORY = 8;
const CONTEXTUAL_CIRCLE_COOLDOWN_HOURS = 3;
/** Даже по просьбе — не больше стольких своих кружков за окно (защита от серии «на каждый его кружок»). */
const CIRCLE_RATE_MAX = 2;
const CIRCLE_RATE_WINDOW_MIN = 90;
/** Сколько минут после своего «я стесняюсь видео» не кидать видео/кружок даже по просьбе. */
const MEDIA_STUBBORN_REFUSAL_QUIET_MIN = 90;

/**
 * Бот только что отказалась от видео/кружка («я стесняюсь видео»), но собеседник
 * дожимает. Если послушать его буквально и прислать кружок — сразу видно, что
 * отказ был фейковый, а бот «не умеет» то, от чего только что отказалась.
 * Держим тишину по видео в пределах часа-двух.
 */
async function mediaRefusalQuietNow(accountId, peerId) {
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
         AND (content LIKE '%стесняюсь%' OR content LIKE '%давай лучше тут общаться%'
              OR content LIKE '%я лучше текстом%' OR content LIKE '%лучше писать%')
         AND created_at > (NOW() - INTERVAL ${Number(MEDIA_STUBBORN_REFUSAL_QUIET_MIN)} MINUTE)`,
      [accountId, String(peerId)],
    );
    return Number(row?.n || 0) > 0;
  } catch (_) {
    return false;
  }
}

async function canSendContextualCircle(accountId, peerId, history) {
  const len = Array.isArray(history) ? history.length : 0;
  if (len < CONTEXTUAL_CIRCLE_MIN_HISTORY) return false;
  if (lastAssistantWasMedia(history)) return false;
  // Он только что прислал свой кружок — не зеркалим автоматически.
  const lastUser = [...(history || [])].reverse().find((h) => h?.role === 'user');
  if (lastUser && /\[кружок\s+от\s+собеседника\]/i.test(String(lastUser.content || ''))) return false;
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
         AND content LIKE '[медиа:#%'
         AND created_at > (NOW() - INTERVAL ${Number(CONTEXTUAL_CIRCLE_COOLDOWN_HOURS)} HOUR)`,
      [accountId, String(peerId)],
    );
    if (Number(row?.n || 0) > 0) return false;
  } catch (_) {
    return false;
  }
  return true;
}

async function circleRateLimited(accountId, peerId) {
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
         AND content LIKE '[медиа:#%'
         AND content LIKE '%{кружок:%'
         AND created_at > (NOW() - INTERVAL ${Number(CIRCLE_RATE_WINDOW_MIN)} MINUTE)`,
      [accountId, String(peerId)],
    );
    return Number(row?.n || 0) >= CIRCLE_RATE_MAX;
  } catch (_) {
    return false;
  }
}

/** Описания кадров медиа-чата: { [msgId]: 'сижу дома...' } */
function mediaDescriptionsForLink(link) {
  const cache = loadOwnMediaDesc();
  const prefix = `${link}#`;
  const out = {};
  for (const [key, val] of Object.entries(cache)) {
    if (!key.startsWith(prefix) || key.includes('|light')) continue;
    const id = key.slice(prefix.length);
    if (/^\d+$/.test(id) && typeof val === 'string' && val.trim()) out[id] = val;
  }
  return out;
}

function buildMediaContextText(userText, history) {
  // Последнее сообщение собеседника важнее истории — иначе тема тонет.
  const lastUser = String(userText || '');
  const recentUser = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'user')
    .slice(-4)
    .map((h) => String(h.content || ''))
    .join(' ');
  const recentBot = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-2)
    .map((h) => String(h.content || '').replace(/\[медиа:#\d+\][^\n]*/gi, ''))
    .join(' ');
  const raw = `${lastUser} ${lastUser} ${recentUser} ${recentBot}`.slice(0, 1200);
  // Явно дописываем маркеры темы (высокая→рост/ноги/зал), чтобы скорер видел их.
  const expanded = expandMediaContextTokens(tokenizeMediaContext(raw));
  return `${raw} ${expanded.join(' ')}`.slice(0, 1600);
}

/**
 * Вопрос про внешность/тему, на который уместно ответить фото по смыслу
 * («ты высокая?», «какие волосы?», «ты в зале?»), даже без «скинь фотку».
 */
const TOPIC_PHOTO_RE =
  /(?:^|[\s,.!?])(?:ты\s+)?(?:высокая|высокий|низкая|низкий|маленькая|худая|пышная|спортивн\w*|накаченн\w*|загорел\w*)(?![а-яёa-z])|(?:какой|какая|какие|сколько)\s+(?:у\s+тебя\s+)?рост(?![а-яёa-z])|в\s+полный\s+рост|(?:какие|какой\s+цвет|какого\s+цвета)\s+(?:у\s+тебя\s+)?(?:волос|глаз)|(?:ты\s+)?(?:в\s+зале|из\s+зала|после\s+зала|из\s+качалки)|(?:занимаешься|занимаешся)\s+спорт|(?:какие|какая)\s+(?:у\s+тебя\s+)?(?:форм|фигур)|(?:что\s+на\s+тебе|как\s+одета|во\s+что\s+одета)|(?:ты\s+)?(?:брюнетк|блондинк|шатенк|рыж(?:ая|енькая)?)(?![а-яёa-z])|(?:есть\s+(?:ли\s+)?(?:у\s+тебя\s+)?)?(?:тату|пирсинг)(?![а-яёa-z])|(?:как\s+ты\s+выглядишь|как\s+выглядишь)|are\s+you\s+tall|how\s+tall\s+are\s+you|what\s+color\s+(?:are\s+)?your\s+(?:eyes|hair)|do\s+you\s+(?:go\s+to\s+)?(?:the\s+)?gym|you\s+workout/i;

function isTopicPhotoRequest(text) {
  const t = userTextForMediaIntent(text);
  if (!t) return false;
  // Не длинное эссе — короткие вопросы/реплики про внешность.
  if (t.length > 180) return false;
  return TOPIC_PHOTO_RE.test(t);
}

// Описания своих медиа из медиа-чата: ключ `${link}#${msgId}`, считаются один раз.
const OWN_MEDIA_DESC_PATH = path.join(__dirname, '..', 'media', 'own_media_desc.json');
const OWN_MEDIA_LABEL = { photo: 'фото', video: 'видео', circle: 'кружок' };
const OWN_MEDIA_LABEL_GEN = { photo: 'фото', video: 'видео', circle: 'кружка' };
let ownMediaDescCache = null;

function loadOwnMediaDesc() {
  if (ownMediaDescCache) return ownMediaDescCache;
  try {
    ownMediaDescCache = JSON.parse(fs.readFileSync(OWN_MEDIA_DESC_PATH, 'utf8')) || {};
  } catch (_) {
    ownMediaDescCache = {};
  }
  return ownMediaDescCache;
}

function saveOwnMediaDesc(cache) {
  try {
    fs.writeFileSync(OWN_MEDIA_DESC_PATH, JSON.stringify(cache, null, 1));
  } catch (e) {
    console.error('Не удалось сохранить описания своих медиа:', e.message);
  }
}

async function loadOwnMediaFrames(client, item, mediaType) {
  if (!item.msg) return [];
  let frames = [];
  // Whisper на беззвучных кружках галлюцинирует («спасибо за просмотр») — звук не берём.
  const buf = await client.downloadMedia(item.msg, {});
  if (mediaType === 'photo') {
    if (buf && buf.length) frames = [buf];
  } else if (buf && buf.length && buf.length <= MAX_INCOMING_VIDEO_BYTES) {
    frames = await extractVideoFrameBuffers(buf, 2);
  }
  if (!frames.length && mediaType !== 'photo') {
    try {
      const thumb = await client.downloadMedia(item.msg, { thumb: 0 });
      if (thumb && thumb.length) frames = [thumb];
    } catch (_) {}
  }
  return frames;
}

async function getOwnMediaDescription(client, item, mediaType, link) {
  const key = `${link}#${item.id}`;
  const cache = loadOwnMediaDesc();
  if (cache[key]) return cache[key];
  const frames = await loadOwnMediaFrames(client, item, mediaType);
  const desc = await describeOwnMedia(frames, OWN_MEDIA_LABEL_GEN[mediaType] || 'видео');
  if (desc) {
    cache[key] = desc;
    saveOwnMediaDesc(cache);
  }
  return desc;
}

// ---------------------------------------------------------------------------
// Свет на своих медиа: ночью не шлём кружок/фото, снятые при дневном свете
// (человек сразу видит «у тебя что-то светло там» в полночь).
// ---------------------------------------------------------------------------

// Восход / закат по МСК для средней полосы, по месяцам (янв..дек).
const SUNRISE_MSK = [9, 8, 7, 6, 5, 4, 4, 5, 6, 7, 8, 9];
const SUNSET_MSK = [16, 17, 18, 19, 20, 21, 21, 20, 19, 17, 16, 16];
const ownMediaLightInFlight = new Map();
const ownMediaLightWarmup = new Set();

function isDarkOutsideNow(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 3600 * 1000);
  const month = msk.getUTCMonth();
  const hour = msk.getUTCHours() + msk.getUTCMinutes() / 60;
  return hour < SUNRISE_MSK[month] || hour >= SUNSET_MSK[month] + 1;
}

function cachedOwnMediaLight(item, link) {
  return loadOwnMediaDesc()[`${link}#${item.id}|light`] || null;
}

async function getOwnMediaLight(client, item, mediaType, link) {
  const key = `${link}#${item.id}|light`;
  const known = loadOwnMediaDesc()[key];
  if (known) return known;
  if (ownMediaLightInFlight.has(key)) return ownMediaLightInFlight.get(key);
  const job = (async () => {
    const frames = await loadOwnMediaFrames(client, item, mediaType);
    const light = await classifyOwnMediaLight(frames);
    if (light) {
      const cache = loadOwnMediaDesc();
      cache[key] = light;
      saveOwnMediaDesc(cache);
    }
    return light;
  })().finally(() => ownMediaLightInFlight.delete(key));
  ownMediaLightInFlight.set(key, job);
  return job;
}

// Лимит OpenAI общий с ответами: фоновая разметка идёт медленно и уступает при 429.
const OWN_MEDIA_LIGHT_WARMUP_STEP_MS = 15000;
const OWN_MEDIA_LIGHT_RATE_PAUSE_MS = 5 * 60 * 1000;
let ownMediaLightPausedUntil = 0;

/** Фоном размечает свет у всех медиа чата, чтобы ночью было из чего выбрать без задержки. */
function warmOwnMediaLight(client, accountId, link, items) {
  if (Date.now() < ownMediaLightPausedUntil) return;
  if (ownMediaLightWarmup.has(link)) return;
  const todo = items.filter((i) => !cachedOwnMediaLight(i, link));
  if (!todo.length) return;
  ownMediaLightWarmup.add(link);
  (async () => {
    for (const item of todo) {
      if (!getActiveClient(accountId) || Date.now() < ownMediaLightPausedUntil) break;
      if (cachedOwnMediaLight(item, link)) continue;
      try {
        await getOwnMediaLight(client, item, item.type, link);
      } catch (err) {
        if (err?.status === 429) {
          ownMediaLightPausedUntil = Date.now() + OWN_MEDIA_LIGHT_RATE_PAUSE_MS;
          console.error('[медиа] Лимит OpenAI — разметку света ставлю на паузу 5 мин.');
          break;
        }
        if (isFloodError(err)) break;
      }
      await sleep(OWN_MEDIA_LIGHT_WARMUP_STEP_MS);
    }
  })().finally(() => ownMediaLightWarmup.delete(link));
}

/** Ночью — не шлём то, что ТОЧНО снято днём на улице. Неразмеченное можно. */
async function filterMediaForDaylight(client, items, mediaType, link, sentIds) {
  // #8 слот суток: утро/день — без явной ночи; вечер/ночь — без явного дня.
  let banned = isDarkOutsideNow() ? 'day' : 'dark';
  let prefer = banned === 'day' ? 'dark' : 'day';
  try {
    const { mediaSlotPolicy, sortMediaBySlotPrefer } = require('./opsQuality');
    const pol = mediaSlotPolicy();
    banned = pol.banned;
    prefer = pol.prefer;
    filterMediaForDaylight._sortPrefer = (list) =>
      sortMediaBySlotPrefer(list, link, cachedOwnMediaLight, prefer);
  } catch (_) {
    filterMediaForDaylight._sortPrefer = (list) => list;
  }
  const ofType = items.filter((i) => i.type === mediaType);
  // Остальное (помещение / неразмеченное) подходит в любое время суток.
  let ok = ofType.filter((i) => cachedOwnMediaLight(i, link) !== banned);
  ok = filterMediaForDaylight._sortPrefer(ok);
  if (ok.some((i) => !sentIds.has(i.id))) return ok;
  // Все неразмеченные уже уходили этому человеку, а «не дневных» не осталось —
  // пробуем класифицировать до 2 неизвестных (вдруг там помещение).
  const unknown = ofType
    .filter((i) => !cachedOwnMediaLight(i, link) && !sentIds.has(i.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, 2);
  for (const item of unknown) {
    const light = await Promise.race([
      getOwnMediaLight(client, item, mediaType, link).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 20000)),
    ]);
    if (light && light !== banned) ok.push(item);
  }
  if (ok.some((i) => !sentIds.has(i.id))) return ok;

  // Кружки строго по свету (иначе в обед уходят ночные). Фото/видео —
  // если пул после фильтра пуст, а в ТГК ещё есть неотправленные, шлём любой:
  // иначе алерт «отправка не удалась» при живой привязке медиа-чата.
  const hasUnsent = ofType.some((i) => !sentIds.has(i.id));
  if (hasUnsent && mediaType !== 'circle') {
    console.log(
      `[медиа] Дневной фильтр (${banned}) опустошил пул «${mediaType}» — беру любой неотправленный из ТГК.`,
    );
    return ofType;
  }
  return ok;
}

const OWN_MEDIA_LIGHT_NOTE = { day: 'снято днём, при дневном свете', dark: 'снято вечером, темно', indoor: 'в помещении' };

async function ownMediaHistoryTag(client, item, mediaType, link) {
  let desc = '';
  try {
    desc = await Promise.race([
      getOwnMediaDescription(client, item, mediaType, link),
      new Promise((resolve) => setTimeout(() => resolve(''), 30000)),
    ]);
  } catch (e) {
    console.error('Не удалось описать своё медиа:', e.message);
  }
  const light = OWN_MEDIA_LIGHT_NOTE[cachedOwnMediaLight(item, link)];
  if (desc && light) desc = `${desc} (${light})`;
  return desc ? `${mediaTag(item.id)} {${OWN_MEDIA_LABEL[mediaType] || 'медиа'}: ${desc}}` : mediaTag(item.id);
}

/**
 * Выбирает и отправляет случайное неотправленное медиа нужного типа из
 * медиа-чата аккаунта. Возвращает { ok, reason? }.
 */
async function trySendMedia(
  client,
  sender,
  accountId,
  peerId,
  senderName,
  mediaType,
  link,
  contextText = '',
) {
  try {
    // Жёстко: фото вещей/коробок нет в пуле — не подменять селфи.
    if (isPackedThingsPhotoAsk(contextText)) {
      console.log(
        `[${accountLabel(accountId)}] skip reason=packed_things_unavailable peer=${senderName}`,
      );
      return { ok: false, reason: 'packed_things_unavailable' };
    }
    if (mediaType === 'circle' && (await circleRateLimited(accountId, peerId))) {
      console.log(
        `[${accountLabel(accountId)}] Лимит кружков (${CIRCLE_RATE_MAX} / ${CIRCLE_RATE_WINDOW_MIN} мин) для ${senderName} — не шлю.`,
      );
      return { ok: false, reason: 'circle_rate' };
    }
    const sentIds = await getSentMediaSet(accountId, peerId);
    let record = await getMediaItems(client, accountId, link);
    warmOwnMediaLight(client, accountId, link, record.items);
    const filtered = await filterMediaForDaylight(client, record.items, mediaType, link, sentIds);
    const descriptions = mediaDescriptionsForLink(link);
    // Кружки одному человеку не повторяем никогда (пока в истории есть [медиа:#id]).
    const allowRepeat = mediaType !== 'circle';
    const specificScene = isSpecificMediaSceneRequest(contextText);
    const indoorClaim = claimsIndoorSetting(contextText);
    let item = pickMediaByContext(filtered, mediaType, sentIds, descriptions, contextText, {
      allowRepeat,
      requireMatch: !!specificScene || !!indoorClaim,
    });
    // Общая просьба «кинь фото» — можно рандом; сцена / «дома в пижаме» —
    // только при совпадении, иначе deflect (не outdoor поверх пижамы).
    if (!item && !specificScene && !indoorClaim) {
      item = pickUnsentMedia(filtered, mediaType, sentIds, descriptions, { allowRepeat });
    }
    if (!item) {
      const ofTypeAll = (record.items || []).filter((i) => i.type === mediaType);
      const noFreshCircle =
        mediaType === 'circle' && ofTypeAll.length && ofTypeAll.every((i) => sentIds.has(i.id));
      const emptyPool = !ofTypeAll.length;
      const daylightEmpty =
        !emptyPool &&
        !noFreshCircle &&
        !filtered.some((i) => !sentIds.has(i.id));
      console.log(
        `[${accountLabel(accountId)}] Нет подходящего медиа типа "${mediaType}" для ${senderName}` +
          (noFreshCircle
            ? ' (все кружки этому человеку уже уходили — повтор запрещён).'
            : emptyPool
              ? ' (в медиа-чате нет файлов этого типа).'
              : daylightEmpty
                ? isDarkOutsideNow()
                  ? ' (на улице темно, дневные не шлю; fallback тоже пуст).'
                  : ' (на улице светло, ночные не шлю; fallback тоже пуст).'
                : '.'),
      );
      return { ok: false, reason: noFreshCircle ? 'circle_exhausted' : emptyPool ? 'empty_pool' : daylightEmpty ? 'daylight' : 'no_match' };
    }

    try {
      const hist = await getHistory(accountId, peerId).catch(() => []);
      const capLang = detectReplyLanguage(contextText, hist);
      const descForCap = descriptions[String(item.id)] || descriptions[item.id] || '';
      const caption =
        mediaType === 'circle'
          ? ''
          : pickCaption(mediaType, capLang === 'ru' ? 'ru' : 'en', { description: descForCap });
      await sendMediaItem(client, sender, item, caption);
    } catch (e) {
      // Устаревшая ссылка на файл — сбрасываем кэш и пробуем ещё раз.
      if (String(e.message || '').includes('FILE_REFERENCE')) {
        clearMediaCache(accountId, link);
        record = await getMediaItems(client, accountId, link);
        item = record.items.find((i) => i.id === item.id) || item;
        const hist = await getHistory(accountId, peerId).catch(() => []);
        const capLang = detectReplyLanguage(contextText, hist);
      const descForCap = descriptions[String(item.id)] || descriptions[item.id] || '';
      const caption =
        mediaType === 'circle'
          ? ''
          : pickCaption(mediaType, capLang === 'ru' ? 'ru' : 'en', { description: descForCap });
      await sendMediaItem(client, sender, item, caption);
      } else {
        throw e;
      }
    }

    const historyTag = await ownMediaHistoryTag(client, item, mediaType, link);
    await saveMessage(accountId, peerId, senderName, 'assistant', historyTag);
    const matched = descriptions[String(item.id)] || descriptions[item.id] || '';
    console.log(
      `[${accountLabel(accountId)}] Отправлено медиа (${mediaType}) #${item.id} для ${senderName}` +
        (matched ? ` [по смыслу: ${matched.slice(0, 60)}]` : '') +
        `: ${historyTag}`,
    );
    return { ok: true };
  } catch (err) {
    const em = `${err?.errorMessage || ''} ${err?.message || ''}`;
    if (/INVITE_HASH_EXPIRED|INVITE_HASH_INVALID/i.test(em)) {
      try {
        const mr = require('./mediaReplies');
        clearMediaCache(accountId, link);
        const hash = mr.parseInviteHash?.(link);
        if (hash) mr.markInviteDead(hash);
      } catch (_) {
        clearMediaCache(accountId, link);
      }
      console.error(
        `[${accountLabel(accountId)}] Медиа-ссылка протухла (invite) — нужна новая в карточке аккаунта.`,
      );
      return { ok: false, reason: 'invite_dead' };
    }
    console.error(
      `[${accountLabel(accountId)}] Ошибка отправки медиа (${mediaType}): ${err.message}`,
    );
    return { ok: false, reason: 'send_error' };
  }
}

/**
 * Явная просьба фото/кружка/видео, а файл в этом ходе не ушёл —
 * пинг владельцу + делегатам номера (не чаще раза в ~45 мин на диалог).
 */
async function maybeNotifyMediaMissed({
  accountId,
  peerId,
  senderName,
  settings,
  explicitMediaRequest,
  mediaLink,
  mediaSentThisTurn,
  mediaType,
  text,
  failReason = null,
}) {
  if (!explicitMediaRequest || mediaSentThisTurn) return;
  const kind = mediaType || detectRequestedMediaType(text);
  let reason = 'deflect';
  if (!mediaLink) reason = 'no_media_chat';
  else if (failReason) reason = failReason;
  else if (mediaType) reason = 'send_failed';
  else reason = 'suppressed';
  try {
    await helpRequestNotifier.notifyMediaMissed({
      accountId,
      accountPhone: settings?.phone,
      accountName: accountDisplayName(accountId),
      peerId,
      peerUsername: senderName,
      mediaKind: kind,
      reason,
      userText: text,
    });
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] mediaMiss notify:`,
      err.message,
    );
  }
}

/**
 * Шлёт медиа всем, кто явно попросил. Если не вышло — мягко уводит с темы
 * (без «щас найду» / «потом скину»).
 */
async function sendRequestedMediaOrDeflect(
  client,
  sender,
  accountId,
  peerId,
  senderName,
  mediaType,
  mediaLink,
  contextText = '',
  { allowDeflect = true } = {},
) {
  if (!mediaType || !mediaLink) return { ok: false, reason: 'no_media_chat' };
  try {
    await client.invoke(
      new Api.messages.SetTyping({
        peer: sender,
        action:
          mediaType === 'photo'
            ? new Api.SendMessageUploadPhotoAction({ progress: 0 })
            : new Api.SendMessageUploadVideoAction({ progress: 0 }),
      }),
    );
  } catch (_) {
    // индикатор не критичен
  }
  await sleep(1200 + Math.random() * 1200);
  const sendResult = await trySendMedia(
    client,
    sender,
    accountId,
    peerId,
    senderName,
    mediaType,
    mediaLink,
    contextText,
  );
  const sent = sendResult === true || sendResult?.ok === true;
  const failReason =
    (sendResult && typeof sendResult === 'object' && sendResult.reason) || 'send_failed';
  if (sent) {
    try {
      const { pushActivity } = require('./opsActivityLog');
      const kindRu =
        mediaType === 'circle'
          ? 'кружок'
          : mediaType === 'video'
            ? 'видео'
            : 'фото';
      const peerLabel = senderName
        ? `@${String(senderName).replace(/^@/, '')} (id ${peerId})`
        : `id ${peerId}`;
      const accLabel = accountDisplayName(accountId) || accountLabel(accountId);
      pushActivity({
        kind: 'media_sent',
        title: `Просил ${kindRu} — ИИ отправила`,
        body:
          `Аккаунт: ${accLabel}\n` +
          `Собеседник: ${peerLabel}\n` +
          `Тип: ${kindRu}`,
        accountId,
        accountLabel: accLabel,
        peerId,
        peerLabel,
        meta: { mediaType },
      }).catch(() => {});
    } catch (_) {}
    return { ok: true };
  }
  // Вещи/коробки — всегда текстовая отмазка (в пуле нет таких кадров).
  if (failReason === 'packed_things_unavailable' || isPackedThingsPhotoAsk(contextText)) {
    const deflect = pickPackedThingsExcuse();
    try {
      await tgSendMessage(client, sender, { message: deflect });
      await saveMessage(accountId, peerId, senderName, 'assistant', deflect);
      console.log(
        `[${accountLabel(accountId)}] Вещи/коробки — отмазка для ${senderName}: "${deflect}"`,
      );
    } catch (e) {
      console.error(`[${accountLabel(accountId)}] packed deflect:`, e.message);
    }
    return { ok: false, reason: 'packed_things_unavailable', deflected: true };
  }
  if (!allowDeflect) return { ok: false, reason: failReason };
  // Лимит / все кружки уже уходили этому человеку — не ври «затык с фотками».
  if (mediaType === 'circle') {
    if (await circleRateLimited(accountId, peerId)) {
      return { ok: false, reason: failReason || 'circle_rate' };
    }
    try {
      const sentIds = await getSentMediaSet(accountId, peerId);
      const record = await getMediaItems(client, accountId, mediaLink);
      const allCircles = (record.items || []).filter((i) => i.type === 'circle');
      if (allCircles.length && allCircles.every((i) => sentIds.has(i.id))) {
        return { ok: false, reason: 'circle_exhausted' };
      }
    } catch (_) {
      /* fall through to soft deflect */
    }
  }

  const deflect = pickMediaFailDeflect(contextText);
  try {
    await tgSendMessage(client, sender, { message: deflect });
    await saveMessage(accountId, peerId, senderName, 'assistant', deflect);
    console.log(
      `[${accountLabel(accountId)}] Медиа не ушло ${senderName} — мягкий уход с темы: "${deflect}"`,
    );
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Не удалось отправить уход с темы после медиа:`,
      err.message,
    );
  }
  return { ok: false, reason: failReason };
}

module.exports = {
  configureMediaSend,
  voiceForbiddenPeers,
  isVoiceForbiddenError,
  isTypoFixMessage,
  isContradictoryMediaText,
  stripContradictoryMediaParts,
  userTextForMediaIntent,
  lastAssistantPromisedMedia,
  userAskedViaQuoteOnly,
  unfulfilledMediaPromiseCount,
  stripMediaPromise,
  isMediaPromiseText,
  userNudgesPromisedMedia,
  isHardMediaRequest,
  isExplicitMediaRequest,
  recentUserAskedMedia,
  resolveMediaPromise,
  fixUnfulfilledMediaPromise,
  detectRequestedMediaType,
  pickMediaFailDeflect,
  isPackedThingsPhotoAsk,
  pickPackedThingsExcuse,
  BARE_MEDIA_FILLER_RE,
  lastAssistantWasMedia,
  peerComplainedMediaNotFresh,
  botRecentlyRefusedVideo,
  peerAsksToProveHuman,
  stripLeakedMediaHistoryTag,
  extractMediaRequest,
  getSentMediaSet,
  mediaRefusalQuietNow,
  canSendContextualCircle,
  circleRateLimited,
  mediaDescriptionsForLink,
  buildMediaContextText,
  isTopicPhotoRequest,
  trySendMedia,
  maybeNotifyMediaMissed,
  sendRequestedMediaOrDeflect,
};
