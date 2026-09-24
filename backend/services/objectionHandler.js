/**
 * ОБРАБОТКА ВОЗРАЖЕНИЙ + архив молчащих диалогов и короткое голосовое
 * «как проходит день» в первые сутки знакомства.
 *
 * Детекция возражений — ключевыми словами по входящему тексту (текст уже
 * расшифрован из голосовых на этапе extractIncomingText в telegramClient.js).
 * Даёт модели готовую подсказку, КАК среагировать — сам ответ всё равно
 * генерирует AI, чтобы звучало естественно в контексте конкретного диалога.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
// require отложенный (внутри функции), а не на верхнем уровне: telegramClient.js
// сам подключает objectionHandler.js при загрузке, поэтому обратный require здесь
// в начале файла привёл бы к undefined из-за циклической зависимости модулей.
// voiceReplies.js ни от telegramClient.js, ни от objectionHandler.js не зависит,
// поэтому его можно require-ить сразу.
const { sendVoiceReply, VOICES_DIR } = require('./voiceReplies');
const { isRussianConversation } = require('./aiResponder');

async function peerChatsInRussian(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT role, content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT 20`,
    [accountId, String(peerId)],
  );
  const history = rows.reverse();
  let lastUser = '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'user') {
      lastUser = history[i].content || '';
      break;
    }
  }
  return isRussianConversation(lastUser, history);
}

const OBJECTION_PATTERNS = [
  {
    type: 'scam',
    re: /(развод|скам|мошен|кинешь|кинула|кину\b|обман|это лохотрон|поймали лоха)/i,
    hint:
      'Собеседник намекает, что это обман/скам/развод. Отреагируй легко, без паники и оправданий — ' +
      'в духе «хаха, ок) я просто поделилась» — и мягко переведи разговор дальше, не настаивай и не убеждай.',
  },
  {
    type: 'no_money',
    re: /(нет денег|денег нет|без денег|не на что|финансово не могу|у меня нету|деньг[аи] сейчас нет)/i,
    hint:
      'Собеседник говорит, что у него нет денег. Ответь буднично, без давления, например что сама заходила ' +
      'с небольшой суммы (около 50 долларов) — просто поделись опытом, не проси и не настаивай.',
  },
  {
    type: 'dont_understand',
    re: /(не шар[ю|ишь]|не разбираюсь в этом|не понимаю в этом|первый раз слышу про (нфт|токен))/i,
    hint:
      'Собеседник говорит, что не разбирается в теме. Ответь, что ты тоже раньше не шарила, и можешь ' +
      'показать/подсказать, если он захочет — без давления, решение оставь ему.',
  },
  {
    type: 'later',
    re: /(потом|позже|не сейчас|напиши завтра|напомни мне|давай в другой раз)/i,
    hint:
      'Собеседник просит вернуться к теме позже. Согласись спокойно, без напоминаний и давления — ' +
      'просто прими это буднично.',
  },
];

// Детект «бот/ИИ» и запрос контактов — часть анти-детект логики, но
// возражения и анти-детект имеют общую механику (ключевые слова -> подсказка),
// поэтому удобно держать один детектор.
const BOT_ACCUSATION_RE =
  /(ты\s+бот|это\s+бот|бот\s+ли\s+ты|какой[- ]?то\s+бот|как\s+бот|как\s+робот|с\s+роботом|обща(ешьс|ешс)я\s+как\s+(бот|робот)|как\s+будто\s+с\s+роботом|прогоня(ешь|ете)\s*.{0,30}нейросет|через\s+нейросет|кажется[^.!?\n]{0,40}бот|похоже[^.!?\n]{0,30}бот|как\s+будто[^.!?\n]{0,20}бот|отвечаешь[^.!?\n]{0,30}бот|(снова|опять)\s+кажется|мне\s+снова\s+кажется|искусственный\s+интеллект|нейросеть|\bии\b|chatgpt|gpt[- ]?\d|ты\s+не\s+человек|не\s+человек\s+а|пустая\s+трата\s+времени.*бот|уверен.*бот|you('?re|\s+are)\s+a?\s*bot|are\s+you\s+a?\s*bot)/i;
const NAME_COMPLAINT_RE =
  /(не\s+спросил[аи]?\s+(как\s+меня\s+зовут|мо[её]\s+имя|имя)|даже\s+имени\s+не|как\s+меня\s+зовут|what'?s\s+my\s+name|didn'?t\s+ask\s+(my\s+)?name)/i;
const INTERROGATION_COMPLAINT_RE =
  /(допрос|допрашива|слишком\s+много\s+вопрос|вечно\s+спрашива|опрашива|interrogat)/i;
const ABOUT_HERSELF_RE =
  /(расскажи\s+(о\s+себе|про\s+себя)|про\s+себя\s+расска|что\s+насч[её]т\s+тебя|а\s+ты\s+сама\s+кто|интересы|образован|хобби\s+у\s+тебя|tell\s+me\s+about\s+yourself)/i;
const FAKE_ACCUSATION_RE = /(фейк|фэйк|\bfake\b|ты фейк|это фейк|и всё[- ]?таки фейк|и все[- ]?таки фейк|не настоящ|впариваешь|накрутка)/i;
const CONTACT_REQUEST_RE = /(номер телефона|дай (свой )?номер|скинь номер|скинь инст|инстаграм|whatsapp|ватсап|вотсап|как тебя найти|где тебя найти|твой телеграм|дай контакт)/i;
const LOCATION_ASK_RE =
  /(^|\s)((а\s+)?где\s+ты\b|ты\s+где\b|где\s+сейчас\b|где\s+щас\b|в\s+каком\s+городе\b|откуда\s+ты\b|куда\s+ты\s+(ед|переез)|ты\s+в\s+\S+\s+переез)/i;

// Вопросы про ЕЁ работу / портфолио / софт — НЕ контакты и НЕ «давай тут общаться».
const ABOUT_HER_JOB_RE =
  /(ты\s+не\s+работаешь|ты\s+работаешь\b|а\s+ты\s+работа|где\s+(ты\s+)?работаешь|чем\s+(ты\s+)?занимаешься|кем\s+(ты\s+)?работа|ты\s+где\s+работа|дизайном\s+чего|дизайн\s+чего|в\s+каких\s+программ|какими\s+программ|покажи\s+(примеры|работы|портфолио)|примеры\s+(своих\s+)?работ|скинь\s+(работы|портфолио|примеры)|what\s+do\s+you\s+do|where\s+do\s+you\s+work|do\s+you\s+work)/i;

// Спрашивает ЕЁ имя («как зовут тебя»), не своё («как меня зовут»).
const ASKING_HER_NAME_RE =
  /(как\s+(тебя|вас)\s+зовут|как\s+зовут\s+тебя|а\s+тебя\s+как\s+зовут|тво[её]\s+имя|what'?s\s+your\s+name|your\s+name\??)/i;

// Прямой вопрос / просьба — memory follow-up и «философия» не должны перебивать ответ.
const DIRECT_QUESTION_RE =
  /(\?|что\s+ты\s+имеешь|в\s+смысле|почему\s+ты|зачем\s+ты|когда\s+ты|куда\s+ты|в\s+каких\s+числах|прилетаешь|приедешь|покажи|расскажи|объясни|what\s+do\s+you\s+mean|why\s+do\s+you)/i;

// Вопрос про наше daily-фото (скрин прибыли с NFT-флипа).
const FLIP_PHOTO_IN_HISTORY_RE =
  /(\[фото от меня:.*флиппинг|\[photo from me:.*nft flip)/i;

const ASKING_ABOUT_SENT_PHOTO_RE =
  /(что это|это что|а это что|что за (это|фото|фотк|картинк|скрин|изображен|картинка)|что ты (мне )?(прислал|отправил|скинул|показал|послал)|что за скрин|про (это|тое) фото|объясни (это|фото|скрин)|ты (мне )?(это |тое )?(прислал|отправил|скинул|послал)|я спрашиваю|а это что у тебя|это что у тебя|что у тебя (на )?фото|что это у тебя|что ты скинула|что за скриншот|you sent (this|that)|this (photo|picture|image|screenshot) you sent|what'?s this|what is this|what is that|whats that|what'?s that|what did you send|what (is|was) (that|the|this) (photo|picture|image|screenshot|pic)|explain (this|that|the photo)|what'?s on (the |this |that )?(photo|picture|image|screenshot)|what kind of (photo|picture|image))/i;

const SHORT_PHOTO_POINT_RE =
  /^(this|that|это|вот это|а это|это что|and this|and that|а это что у тебя|это что у тебя)\s*\??$/i;

/**
 * Было ли недавно в истории наше daily-фото со скрином флипа.
 */
function recentFlipPhotoInHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return false;
  const tail = history.slice(-10);
  return tail.some(
    (msg) =>
      msg &&
      msg.role === 'assistant' &&
      FLIP_PHOTO_IN_HISTORY_RE.test(String(msg.content || '')),
  );
}

/**
 * Собеседник спрашивает / указывает на фото, которое мы прислали.
 */
function isAskingAboutSentPhoto(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const cleaned = raw.replace(/\n\[Ответ на сообщение[^\]]*\]/gi, '').trim();
  if (SHORT_PHOTO_POINT_RE.test(cleaned)) return true;
  return ASKING_ABOUT_SENT_PHOTO_RE.test(cleaned);
}

const FLIP_PHOTO_QUESTION_HINT =
  'Собеседник спрашивает или указывает на фото/скрин, которое ТЫ недавно прислала. ' +
  'Это скриншот твоей прибыли с флиппинга NFT-токенов: купила дешевле, продала дороже, на картинке цены и разница. ' +
  'Объясни коротко и по-человечески, что это твоя сделка / перепродажа NFT и цифры — покупка, продажа, профит. ' +
  'Можно совсем просто: «флипаю нфт, купила дешевле — продала дороже, вот профит)». ' +
  'ЗАПРЕЩЕНО отвечать «это просто фото», «чтобы порадовать», «просто картинка» без объяснения сделки. ' +
  'НЕ делай вид, что это ОН тебе прислал. НЕ спрашивай «что интересного показываешь» и не меняй тему на «как ты». ' +
  'Если он пишет по-английски — отвечай по-английски (например: "thats my nft flip, bought cheaper sold higher)"). ' +
  '1-2 коротких предложения, без лекции и без давления «давай вместе».';

/**
 * Было ли недавно отправлено daily-фото с флипом (по таблице daily_photo_sends),
 * даже если метка в conversation_messages по какой-то причине не записалась.
 */
async function wasDailyFlipSentRecently(accountId, peerId, withinHours = 8) {
  try {
    const hours = Math.max(1, Math.min(48, Number(withinHours) || 8));
    const [rows] = await db.execute(
      `SELECT id FROM daily_photo_sends
       WHERE account_id = ? AND peer_id = ?
         AND sent_at IS NOT NULL
         AND sent_at > (NOW() - INTERVAL ${hours} HOUR)
       LIMIT 1`,
      [accountId, String(peerId)],
    );
    return rows.length > 0;
  } catch (err) {
    console.error('[objectionHandler] wasDailyFlipSentRecently:', err.message);
    return false;
  }
}

/**
 * Вопрос про скрин флипа: по истории ИЛИ по факту недавней отправки daily-фото.
 */
async function shouldForceReplyForFlipPhoto(text, history = [], accountId = null, peerId = null) {
  if (!isAskingAboutSentPhoto(text)) return false;
  if (recentFlipPhotoInHistory(history)) return true;
  if (accountId != null && peerId != null) {
    return wasDailyFlipSentRecently(accountId, peerId);
  }
  return false;
}

function getFlipPhotoQuestionHint() {
  return FLIP_PHOTO_QUESTION_HINT;
}

// Предложение видео/голосового звонка — вежливо отклонить (стеснение), не «ага)».
// Ловим и разговорные формы: «по видео поболтаем?», «где звонить?», «позвоним».
const VIDEO_CALL_REQUEST_RE =
  /(по\s+видео(?=\s|$|[?!.),:])|видео\s*поболта|поболта\w*\s+по\s+видео|видео\s*созвон|созвон\w*|видеозвон|видео\s*звон|видеосвяз|видеочат|видео\s*чат|face\s*time|facetime|скайп|skype|\bzoom\b|где\s+звонить|куда\s+звонить|набери\s+мне|набери\s+меня|позвон\w*|звонок(?=\s|$|[?!.),:])|созвоним|давай\s+(по\s+)?звон|video\s*call|videochat|let'?s\s+call|call\s+me|wanna\s+call|voice\s*call)/i;

function isVideoCallRequest(text) {
  return VIDEO_CALL_REQUEST_RE.test(String(text || ''));
}

// Личная встреча / прогулка / свидание — нельзя соглашаться: персонаж в переезде.
const MEET_REQUEST_RE =
  /(встрет|увидимся|свидан|погуля|сходим\b|давай\s+на\s+кофе|кофе\s+вместе|лично\s+увид|приехать\s+к\s+тебе|приеду\s+к\s+тебе|приедь|подъед|заед(у|ем)\s+к|давай\s+завтра\s+встрет|давай\s+встрети|когда\s+увидимся|где\s+встрети|жду\s+тебя|ждём\s+тебя|когда\s+(ты\s+)?(приедеш|прилетиш|будешь\s+здесь|будешь\s+тут)|приеду\s+(к\s+тебе|за\s+тобой)|заеду\s+за\s+тобой|встречу\s+тебя|увидимся\s+скоро|скоро\s+увидимся)/i;
const MEET_PLANNING_RE =
  /(набережн|где\s+хотел|где\s+погуля|когда\s+планиру|можем\s+в\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье|выходн)|в\s+заозёр|давай\s+в\s+\d)/i;

/**
 * Возвращает подсказку для промпта на основе входящего текста: возражение
 * (по NFT-теме) либо анти-детект ситуация (обвинение в боте / запрос контактов).
 * Если передан history — также ловит вопросы про наше daily-фото с флипом.
 * Возвращает null, если ничего не найдено.
 */
function isAboutHerJobQuestion(text) {
  return ABOUT_HER_JOB_RE.test(String(text || ''));
}

function isAskingHerName(text) {
  return ASKING_HER_NAME_RE.test(String(text || ''));
}

function isDirectQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    DIRECT_QUESTION_RE.test(t) ||
    isAboutHerJobQuestion(t) ||
    LOCATION_ASK_RE.test(t) ||
    isAskingHerName(t)
  );
}

function isContactOrMeetRelated(text) {
  const t = String(text || '');
  return (
    CONTACT_REQUEST_RE.test(t) ||
    MEET_REQUEST_RE.test(t) ||
    MEET_PLANNING_RE.test(t) ||
    isVideoCallRequest(t)
  );
}

function detectHint(text, history = []) {
  if (!text) return null;

  // Сначала вопрос про наш daily-скрин флипа — важнее других хинтов.
  if (recentFlipPhotoInHistory(history) && isAskingAboutSentPhoto(text)) {
    return FLIP_PHOTO_QUESTION_HINT;
  }

  // «Как зовут тебя?» — ответить СВОИМ именем, не «спрашивай)».
  if (isAskingHerName(text)) {
    return (
      'Собеседник спрашивает КАК ТЕБЯ ЗОВУТ (твоё имя). ' +
      'ОБЯЗАТЕЛЬНО в первом предложении назови своё имя из промпта персонажа. ' +
      'Пример тона: «саша)» / «меня вика)» — коротко. ' +
      'ЗАПРЕЩЕНО отвечать «спрашивай», «валяй», «давай», «конечно спрашивай» — вопрос УЖЕ задан. ' +
      'Не путай с «как меня зовут» (его имя) — он спрашивает ПРО ТЕБЯ.'
    );
  }

  if (BOT_ACCUSATION_RE.test(text)) {
    const recentBot = (Array.isArray(history) ? history : [])
      .filter((h) => h && h.role === 'assistant')
      .slice(-4)
      .map((h) => String(h.content || ''))
      .join('\n');
    const alreadyDefended =
      /(обидно|я жив|не бот|не ии|похожа на|с чего ты взял|часто с ии|хах\s+(ну\s+ты|опять)|зациклил|ладно\s+верь|странно\s+звучит|никто\s+ещё|общаюсь\s+как\s+могу)/i.test(
        recentBot,
      );

    if (NAME_COMPLAINT_RE.test(text)) {
      return (
        'Собеседник упрекает, что ты не спросила имя, и намекает что ты бот. ' +
        'НЕ начинай с «обидно, если честно» и НЕ повторяй прошлую защиту «я живая». ' +
        'Коротко и по-человечески: лёгкая самоирония + сразу спроси имя. ' +
        'Пример тона: «хах ну да, тупанула) а как тебя зовут?» — своими словами, 1 короткое предложение. ' +
        'Без лекции что ты живая и без смены темы на «что тебе нравится».'
      );
    }

    if (alreadyDefended) {
      return (
        'Собеседник СНОВА намекает, что ты бот/нейросеть/робот. Ты УЖЕ отвечала на это. ' +
        'ЗАПРЕЩЕНО: «обидно», «я живая», «никто ещё так не говорил», «я просто общаюсь как могу», оправдания. ' +
        'Одна короткая живая реакция без вопроса. Примеры: «хах опять)», «ну ты зациклился», «ладно верь)». ' +
        'Не копируй прошлый ответ.'
      );
    }

    return (
      'Собеседник намекает, что ты бот / нейросеть / робот. ' +
      'ЗАПРЕЩЕНО: «никто ещё так не говорил», «я просто общаюсь как могу», «я живая», длинные оправдания. ' +
      'Одно короткое предложение: «хах», сарказм или лёгкая обида. БЕЗ вопроса в конце. ' +
      'Примеры: «хах ну ты серьёзно)», «странно звучит)», «да ладно тебе)». Не подтверждай что бот.'
    );
  }

  // «Расскажи о себе» / «допрос» — ответить про себя, не «ой никто».
  if (ABOUT_HERSELF_RE.test(text) || INTERROGATION_COMPLAINT_RE.test(text)) {
    return (
      'Собеседник просит рассказать о себе и/или шутит что ты «допрашиваешь» вопросами. ' +
      'ОБЯЗАТЕЛЬНО в первом предложении скажи что-то живое про себя (учёба/работа/интересы по персонажу) — ' +
      'НЕ отвечай «ой никто», «никто», «не знаю». ' +
      'Если упрекает в допросе — лёгкая самоирония («хах ну да, любопытная)») + сразу про себя. ' +
      'БЕЗ встречного допроса в конце. 1-2 коротких предложения.'
    );
  }

  if (FAKE_ACCUSATION_RE.test(text)) {
    return (
      'Собеседник говорит, что ты фейк / ненастоящая. Отреагируй по-человечески: лёгкая обида или ирония, коротко — ' +
      'НЕ начинай шаблоном «обидно, если честно», НЕ оправдывайся длинно, НЕ признавайся, ' +
      'НЕ объясняй откуда фото/кружок. Переведи тему дальше.'
    );
  }

  // Работа / портфолио / программы — ДО контактов, иначе модель путает с «дай инсту».
  if (isAboutHerJobQuestion(text) && !CONTACT_REQUEST_RE.test(text)) {
    return (
      'Собеседник спрашивает про ТВОЮ работу, занятость, дизайн или просит примеры/программы. ' +
      'Это обычный вопрос про тебя, НЕ просьба контактов и НЕ предложение уйти в другой мессенджер. ' +
      'ОБЯЗАТЕЛЬНО ответь по сути в первом предложении (кем занята / чем / в чём работаешь). ' +
      'Если просит примеры работ — НЕ пиши «давай пока тут общаться» / «мне так удобнее». ' +
      'Мягко: файлы сейчас не кидаешь, кратко опиши словами чем занимаешься ' +
      '(например графический дизайн, макеты, визуал) и какие программы (figma, photoshop — по персонажу). ' +
      'Если спрашивает «ты не работаешь?» — коротко скажи что работаешь / самозанятая, без философии. ' +
      'Без «жесть», без «разбираться в людях», без переспроса того, что он только что сказал.'
    );
  }

  if (CONTACT_REQUEST_RE.test(text)) {
    return (
      'Собеседник просит твои контакты (номер/инстаграм/whatsapp/телеграм). Мягко откажи, без грубости — ' +
      'например «не даю пока, давай тут общаться)» — и не давай никаких реальных контактов. ' +
      'Это НЕ просьба фото/видео/кружка: токены <<PHOTO>>/<<VIDEO>>/<<CIRCLE>> сюда НЕ вставляй.'
    );
  }

  if (MEET_REQUEST_RE.test(text) || MEET_PLANNING_RE.test(text)) {
    return (
      'Собеседник зовёт встретиться / пишет «жду тебя» / ждёт приезда лично. ' +
      'СТРОГО ЗАПРЕЩЕНО: «скоро увидимся», «увидимся», «приеду», «жду тебя тоже», место/время встречи. ' +
      'Мягко и тепло: приятно что ждёт, НО сейчас переезд/сборы — личных встреч нет, только переписка. ' +
      'Пример тона: «спасибо) мне тоже приятно, но с переездом пока только тут)» — коротко, без даты. ' +
      'Если раньше согласилась — мягко отыграй назад. Не груби.'
    );
  }

  if (LOCATION_ASK_RE.test(text) && !CONTACT_REQUEST_RE.test(text)) {
    return (
      'Собеседник спрашивает, где ты сейчас / в каком городе. Это обычный вопрос про место, НЕ просьба контактов и НЕ предложение встретиться. ' +
      'Если в ЭТОМ диалоге ты уже говорила про свой город, переезд или где мама/семья — отвечай строго согласованно с тем, что уже сказала: ' +
      'не меняй города местами и не подменяй «сейчас живу» на «переезжаю». ' +
      'Если ещё не говорила — ответь коротко по персонажу (дома / в городе / у подруги и т.п.). ' +
      'Без отказа «давай тут общаться» и без отнекивания как от номера.'
    );
  }

  if (isVideoCallRequest(text)) {
    return (
      'Собеседник предлагает звонок / «по видео поболтаем» / спрашивает где звонить. ' +
      'СТРОГО ЗАПРЕЩЕНО соглашаться: «ага», «давай», «ок», «звони», «сейчас», номер, ссылка. ' +
      'Вежливо откажи из‑за стеснения — только переписка. ' +
      'Пример тона: «ой я на видео стесняюсь, давай лучше тут)» / «не люблю созваниваться, давай текстом)» — ' +
      'коротко, без обещания созвониться позже.'
    );
  }

  const objection = OBJECTION_PATTERNS.find((p) => p.re.test(text));
  return objection ? objection.hint : null;
}

// ---------------------------------------------------------------------------
// МОЛЧАНИЕ: архив через 2 дня без ответа собеседника + голосовое в первые сутки
// ---------------------------------------------------------------------------

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS silence_voice_daily (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      sent_date DATE NOT NULL,
      sent TINYINT NOT NULL,
      decided_at DATETIME NOT NULL,
      UNIQUE KEY uniq_account_peer_day (account_id, peer_id, sent_date)
    )
  `);
  return schemaReady;
}

// Готовое голосовое «как проходит день» — если собеседник не отвечает
// 2-4 часа, раз в сутки бросаем монетку (50%) и, если выпало «отправить»,
// шлём голосовое. Только в первые 2 дня знакомства (до старта NFT-кампании
// на 3-й день — см. NFT_VOICE_AFTER_HOURS в telegramClient.js), чтобы не
// конфликтовать с NFT-голосовым.
const SILENCE_VOICE_FILE = 'kak_prohodit_den.ogg';
// Возраст диалога, до которого действует это напоминание (первые 2 дня).
const SILENCE_VOICE_MAX_DIALOG_AGE_HOURS = 48;
// Окно молчания, в которое можно бросить монетку и отправить голосовое.
const SILENCE_VOICE_WINDOW_MIN_HOURS = 2;
const SILENCE_VOICE_WINDOW_MAX_HOURS = 4;
// Шанс отправки при попадании в окно молчания — раз в сутки на диалог.
const SILENCE_VOICE_CHANCE = 0.5;

async function resolveArchiveEntity(client, peerId, peerUsername) {
  const normalizedId = String(peerId || '').trim();
  const normalizedUsername = String(peerUsername || '').trim().replace(/^@/, '');

  // folders.EditPeerFolders — «сырой» MTProto-запрос: ему нужен именно
  // TypeInputPeer (InputPeerUser/Channel/Chat с access_hash), а не обычная
  // сущность User/Channel из getEntity(). client.getInputEntity() возвращает
  // корректный InputPeer и сам обновляет access_hash в кеше сессии.
  if (normalizedUsername) {
    try {
      return await client.getInputEntity(normalizedUsername);
    } catch (usernameError) {
      if (!normalizedId) throw usernameError;
    }
  }

  if (normalizedId && /^-?\d+$/.test(normalizedId)) {
    try {
      return await client.getInputEntity(Number(normalizedId));
    } catch {
      // Игнорируем: ниже попробуем найти сущность среди диалогов.
    }
  }

  // Резервный способ: если ID не резолвится напрямую (устарел/отсутствует
  // в кеше сессии), ищем ту же сущность среди актуальных диалогов — там
  // access_hash точно свежий — и конвертируем её в InputPeer.
  if (normalizedId) {
    const dialogs = await client.getDialogs({ limit: 200 });
    const match = dialogs.find(
      (d) => String(d.id) === normalizedId || String(d.entity?.id) === normalizedId,
    );
    if (match?.entity) return client.getInputEntity(match.entity);
  }

  throw new Error(`Не удалось найти Telegram-сущность по ID ${normalizedId || 'не указан'}`);
}

async function archiveSilentDialogs() {
  try {
    const { getActiveClient, archivePeer } = require('./telegramClient');
    // Собеседник не писал двое суток — сразу в архив, без текстовых пингов.
    const [rows] = await db.execute(`
      SELECT
        cm.account_id,
        cm.peer_id,
        MAX(cm.peer_username) AS peer_username,
        MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_incoming_at
      FROM conversation_messages cm
      GROUP BY cm.account_id, cm.peer_id
      HAVING last_incoming_at IS NOT NULL
        AND last_incoming_at <= (NOW() - INTERVAL 2 DAY)
    `);

    for (const row of rows) {
      try {
        const client = getActiveClient(row.account_id);
        if (!client) continue;

        const entity = await resolveArchiveEntity(client, row.peer_id, row.peer_username);
        if (await archivePeer(client, entity)) {
          console.log(
            `[Аккаунт ${row.account_id}] Диалог ${row.peer_username || row.peer_id} ` +
              'перемещён в архив после 2 дней без ответа собеседника.',
          );
        }
      } catch (err) {
        console.error(
          `[Аккаунт ${row.account_id}] Не удалось архивировать ${row.peer_username || row.peer_id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error('[objectionHandler] Ошибка архивирования молчащих диалогов:', err.message);
  }
}

/**
 * Раз в сутки на диалог: если собеседник молчит 2-4 часа, бросаем монетку
 * (50%) и, если выпало «отправить», шлём голосовое «как проходит день».
 * Работает только в первые 2 дня знакомства — с 3-го дня тему ведёт
 * NFT-кампания (getNftCampaignState в telegramClient.js), и голосовые не
 * должны пересекаться.
 */
async function sendSilenceVoiceReminders({ getAccountSettings, isWithinWorkingHours, isAutoreplyDisabledForPeer, saveMessage }) {
  const {
    getActiveClient,
    shouldSkipProactivePeer,
    isPermanentSendError,
    retireUnreachablePeer,
  } = require('./telegramClient');
  const { Api } = require('telegram');
  try {
    await ensureSchema();

    const voicePath = path.join(VOICES_DIR, SILENCE_VOICE_FILE);
    if (!fs.existsSync(voicePath)) {
      console.error(
        `[objectionHandler] Файл ${SILENCE_VOICE_FILE} не найден в voices/ — голосовое напоминание о молчании не отправлено.`,
      );
      return;
    }

    // ВАЖНО: молчание считаем строго от last_incoming_at — последнего
    // сообщения САМОГО СОБЕСЕДНИКА. last_message_at (последнее сообщение в
    // диалоге вообще) сюда брать нельзя: он включает и собственные голосовые
    // напоминания бота, из-за чего каждое отправленное напоминание сдвигало
    // бы точку отсчёта тишины.
    const [rows] = await db.execute(`
      SELECT
        cm.account_id,
        cm.peer_id,
        MAX(cm.peer_username) AS peer_username,
        MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_incoming_at,
        MAX(cm.created_at) AS last_message_at,
        MIN(cm.created_at) AS started_at
      FROM conversation_messages cm
      GROUP BY cm.account_id, cm.peer_id
      HAVING last_incoming_at IS NOT NULL
        AND last_message_at > last_incoming_at
        AND last_incoming_at <= (NOW() - INTERVAL ${SILENCE_VOICE_WINDOW_MIN_HOURS} HOUR)
        AND last_incoming_at >= (NOW() - INTERVAL ${SILENCE_VOICE_WINDOW_MAX_HOURS} HOUR)
        AND started_at >= (NOW() - INTERVAL ${SILENCE_VOICE_MAX_DIALOG_AGE_HOURS} HOUR)
    `);

    for (const row of rows) {
      let entity = null;
      const client = getActiveClient(row.account_id);
      try {
        if (await isAutoreplyDisabledForPeer(row.account_id, row.peer_id)) continue;

        const settings = await getAccountSettings(row.account_id);
        if (!settings || !settings.is_autoreply_enabled) continue;
        if (!isWithinWorkingHours(row.account_id)) continue;

        // Решение (бросок монетки) принимается максимум один раз в
        // календарные сутки на диалог — вне зависимости от того, сколько
        // раз за день собеседник попадал в окно 2-4ч молчания.
        const [[already]] = await db.execute(
          `SELECT id FROM silence_voice_daily
           WHERE account_id = ? AND peer_id = ? AND sent_date = CURDATE() LIMIT 1`,
          [row.account_id, row.peer_id],
        );
        if (already) continue;

        const shouldSend = Math.random() < SILENCE_VOICE_CHANCE;

        // Решение фиксируем сразу (даже если монетка сказала «не отправлять»),
        // чтобы следующий тик планировщика (каждые 30 минут) не бросал её
        // повторно в течение того же дня.
        await db.execute(
          `INSERT INTO silence_voice_daily (account_id, peer_id, sent_date, sent, decided_at)
           VALUES (?, ?, CURDATE(), ?, NOW())`,
          [row.account_id, row.peer_id, shouldSend ? 1 : 0],
        );

        if (!shouldSend) continue;

        if (!client) continue;

        if (!(await peerChatsInRussian(row.account_id, row.peer_id))) {
          console.log(
            `[Аккаунт ${row.account_id}] Голосовое молчания пропущено — ${row.peer_username || row.peer_id} не на русском.`,
          );
          continue;
        }

        entity = await client.getEntity(row.peer_username || Number(row.peer_id) || row.peer_id);
        if (await shouldSkipProactivePeer(client, entity)) continue;

        try {
          await client.invoke(
            new Api.messages.SetTyping({ peer: entity, action: new Api.SendMessageRecordAudioAction() }),
          );
        } catch (_) {
          // Индикатор «записывает голосовое» не критичен.
        }

        await sendVoiceReply(client, entity, voicePath);
        await saveMessage(row.account_id, row.peer_id, row.peer_username, 'assistant', `[голосовое: ${SILENCE_VOICE_FILE}]`);

        console.log(
          `[Аккаунт ${row.account_id}] Голосовое «как проходит день» отправлено ${row.peer_username || row.peer_id} ` +
            '(молчание 2-4ч, монетка 50%).',
        );
      } catch (err) {
        console.error(
          `[Аккаунт ${row.account_id}] Ошибка отправки голосового напоминания ${row.peer_username || row.peer_id}:`,
          err.message,
        );
        if (client && isPermanentSendError(err)) {
          await retireUnreachablePeer(
            client,
            row.account_id,
            row.peer_id,
            entity,
            err.errorMessage || err.message || 'unreachable',
          );
        }
      }
    }
  } catch (err) {
    console.error('[objectionHandler] Ошибка планировщика голосовых напоминаний о молчании:', err.message);
  }
}

let schedulerStarted = false;

/**
 * Фоновый цикл: архив после 2 дней без входящих и голосовое в первые сутки.
 * Зависимости из telegramClient.js, чтобы не было циклического require.
 */
function startSilenceScheduler(deps) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    archiveSilentDialogs(deps)
      .catch((err) => console.error('[objectionHandler] archive tick error:', err.message))
      .then(() => sendSilenceVoiceReminders(deps))
      .catch((err) => console.error('[objectionHandler] silence voice tick error:', err.message));
  };
  tick();
  setInterval(tick, 30 * 60 * 1000);
}

module.exports = {
  detectHint,
  shouldForceReplyForFlipPhoto,
  getFlipPhotoQuestionHint,
  isAskingAboutSentPhoto,
  wasDailyFlipSentRecently,
  startSilenceScheduler,
  isAboutHerJobQuestion,
  isAskingHerName,
  isDirectQuestion,
  isContactOrMeetRelated,
  isVideoCallRequest,
};
