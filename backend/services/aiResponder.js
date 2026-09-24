const OpenAI = require('openai');
const { toFile } = require('openai');
const { logUsage } = require('./finetuneUsage');

// ---------------------------------------------------------------------------
// ПРОКСИ для OpenAI.
// api.openai.com блокирует запросы с российских IP (403). Направляем вызовы
// OpenAI через тот же SOCKS5-прокси, что и Telegram (берём из PROXY_LIST).
// OpenAI SDK v6 использует глобальный fetch (undici), поэтому обычный http.Agent
// не работает — нужен undici-диспетчер. Его делает пакет fetch-socks.
// ---------------------------------------------------------------------------
function firstSocks5FromEnv() {
  const raw = process.env.PROXY_LIST || '';
  for (const entry of raw.split(';')) {
    const parts = entry.trim().split(':').map((s) => s.trim());
    const type = (parts[0] || '').toLowerCase();
    if (type === 'socks5' || type === 'socks') {
      const [, host, port, user, pass] = parts;
      if (!host || !port) continue;
      const cfg = { type: 5, host, port: Number(port) };
      if (user) cfg.userId = user;
      if (pass) cfg.password = pass;
      return cfg;
    }
  }
  return null;
}

function buildOpenAIOptions() {
  const opts = { apiKey: process.env.OPENAI_API_KEY };
  // Позволяет переключить провайдера (напр. freemodel) без правки кода:
  // задай OPENAI_BASE_URL=https://api.freemodel.dev/v1 в .env.
  if (process.env.OPENAI_BASE_URL) {
    opts.baseURL = process.env.OPENAI_BASE_URL;
    console.log(`[openai] Базовый URL переопределён: ${process.env.OPENAI_BASE_URL}`);
  }
  const socks = firstSocks5FromEnv();
  if (socks) {
    try {
      const { socksDispatcher } = require('fetch-socks');
      const dispatcher = socksDispatcher(socks);
      // undici-диспетчер прокидывается в fetch через fetchOptions.
      opts.fetchOptions = { dispatcher };
      console.log(`[openai] Запросы идут через SOCKS5-прокси ${socks.host}:${socks.port}`);
    } catch (err) {
      console.error(
        '[openai] Не удалось настроить SOCKS5-прокси (нужен пакет fetch-socks). ' +
        'Запросы пойдут напрямую и могут блокироваться (403). Ошибка:',
        err.message,
      );
    }
  } else {
    console.warn('[openai] SOCKS5-прокси не задан в PROXY_LIST — запросы идут напрямую.');
  }
  return opts;
}

const openai = new OpenAI(buildOpenAIOptions());

// Экспортируем конструктор опций, чтобы другие модули (напр. learningDb.js)
// могли создать свой OpenAI-клиент через тот же SOCKS5-прокси, а не биться
// в бан по IP (403 Country, region, or territory not supported).
module.exports.buildOpenAIOptions = buildOpenAIOptions;

// Модель для чата (ответы). Задаётся через .env: OPENAI_MODEL=gpt-4o.
// Значение читается один раз при старте процесса и не меняется во время
// работы бота — чтобы переключить модель, поменяй .env и перезапусти pm2.
// Если переменная не задана вовсе — используется gpt-4o по умолчанию.
//
// Fine-tuning: после обучения (см. scripts/finetune_openai.py) сюда
// достаточно вписать полученный id вида "ft:gpt-4o-mini-2024-07-18:org::abc123" —
// весь остальной код ничего не знает о fine-tuning и работает как раньше.
const CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Запасная модель — используется автоматически, если основная (например,
// fine-tuned) вернёт ошибку (модель удалена/деактивирована/недоступна).
// Без фолбэка бот полностью замолчит, если fine-tuned модель отключат.
const FALLBACK_MODEL = process.env.OPENAI_MODEL_FALLBACK || 'gpt-4o-mini';

// Отдельный клиент для ГОЛОСА (whisper) и ФОТО (vision). Freemodel обычно
// НЕ поддерживает эти модели, поэтому если задан OPENAI_FALLBACK_KEY (ключ
// настоящего OpenAI) — голос/фото идут через него, а чат через freemodel.
// Если ключ не задан — используется основной клиент (голос/фото могут не
// работать на freemodel, но бот продолжит отвечать текстом).
function buildMediaClient() {
  if (!process.env.OPENAI_FALLBACK_KEY) return openai;
  const opts = { apiKey: process.env.OPENAI_FALLBACK_KEY };
  const socks = firstSocks5FromEnv();
  if (socks) {
    try {
      const { socksDispatcher } = require('fetch-socks');
      opts.fetchOptions = { dispatcher: socksDispatcher(socks) };
    } catch (_) {
      // без прокси — как получится
    }
  }
  console.log('[openai] Голос/фото идут через отдельный ключ OpenAI (fallback).');
  return new OpenAI(opts);
}

const mediaClient = buildMediaClient();

// Запасной промпт, если у аккаунта не задан свой.
const DEFAULT_PROMPT =
  'Ты — живой человек в личной переписке. Пиши коротко, как в Telegram: 1 фраза, редко 2. ' +
  'Язык = язык собеседника (RU/EN). На EN — как носитель в мессенджере. ' +
  'Тепло и по-человечески, без эссе, списков и «поисковых» ответов. ' +
  'Не признавайся что ты бот/ИИ.';

/**
 * Определяет язык ответа: русский или английский — по тексту собеседника.
 * Короткие реплики («ok», «да», «why») наследуют язык недавних его сообщений.
 */
/**
 * Убирает служебные обёртки перед определением языка.
 * Важно: описание фото vision'ом раньше оставалось после снятия `[…]`,
 * и английский текст («cute squirrel…») ложно переключал ответ на EN.
 */
function stripMetaForLangDetect(text) {
  return String(text || '')
    .replace(/\[фото от собеседника\]:\s*[^\n]*/gi, ' ')
    .replace(/\[(?:голос(?:овое)?|voice|аудио)[^\]]*\]:\s*[^\n]*/gi, ' ')
    .replace(/\[геоконтекст[^\]]*\]:\s*/gi, ' ')
    .replace(/\[(?:ответ на|уточнение к|Ответ на сообщение)[^\]]*\]:?\s*/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/<<[^>]+>>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreScript(text) {
  const clean = stripMetaForLangDetect(text);
  let cyr = 0;
  let lat = 0;
  for (const ch of clean) {
    if (/[а-яёА-ЯЁ]/.test(ch)) cyr += 1;
    else if (/[a-zA-Z]/.test(ch)) lat += 1;
  }
  return { cyr, lat, total: cyr + lat };
}

function detectReplyLanguage(userMessage, history = []) {
  const current = scoreScript(userMessage);

  // История собеседника (без vision-описаний) — главный якорь языка.
  let cyr = 0;
  let lat = 0;
  let seen = 0;
  for (let i = (history || []).length - 1; i >= 0 && seen < 8; i -= 1) {
    if (history[i]?.role !== 'user') continue;
    const s = scoreScript(history[i].content);
    if (s.total === 0) continue;
    cyr += s.cyr;
    lat += s.lat;
    seen += 1;
  }

  const historyStrong = cyr + lat >= 6;
  if (historyStrong) {
    // Уже русский/английский диалог — не прыгаем из‑за одного фото/коротыша.
    if (current.total >= 8) {
      if (current.cyr > current.lat * 2) return 'ru';
      if (current.lat > current.cyr * 2) return 'en';
    }
    return lat > cyr ? 'en' : 'ru';
  }

  if (current.total >= 3) {
    if (current.cyr > current.lat) return 'ru';
    if (current.lat > current.cyr) return 'en';
  }

  if (cyr === 0 && lat === 0) {
    if (current.lat > 0 && current.cyr === 0) return 'en';
    return 'ru';
  }
  return lat > cyr ? 'en' : 'ru';
}

function buildLanguageReminder(lang) {
  if (lang === 'en') {
    return (
      'LANGUAGE: the person is chatting in English. Reply ONLY in natural casual English, ' +
      'like a real girl texting on her phone — warm, short, human. ' +
      'Use normal English spelling and letters only (I, I\'m, can\'t, what\'s) — ' +
      'NEVER Turkish/dotted letters like ı/İ, NEVER broken learner English. ' +
      'Use contractions. Max 2 short sentences. ' +
      'Do NOT say you cannot understand Russian if they wrote in English. ' +
      'Do NOT switch to Russian. Do NOT sound translated. ' +
      'Warmth in English naturally (miss you, glad you texted, take care) — no Russian words. ' +
      'Service tokens <<PHOTO>> <<VIDEO>> <<CIRCLE>> <<LAUGH>> <<REACT:emoji>> stay as-is.'
    );
  }
  return (
    'ЯЗЫК: собеседник пишет по-русски. Отвечай ТОЛЬКО на русском, живо и разговорно, как в обычной переписке. ' +
    'Не переходи на английский, если он сам не перешёл на английский текстом. ' +
    'Описание фото/голоса — служебное, это НЕ смена языка: даже если внутри есть английские слова, отвечай по-русски. ' +
    'Служебные токены <<PHOTO>> <<VIDEO>> <<CIRCLE>> <<LAUGH>> <<REACT:эмодзи>> оставляй как есть.'
  );
}

/** true, если по текущему сообщению и истории диалог на русском. */
function isRussianConversation(userMessage, history = []) {
  return detectReplyLanguage(userMessage, history) === 'ru';
}

/**
 * Генерирует ответ через OpenAI.
 *
 * @param {string} systemPrompt - промпт аккаунта (стиль общения)
 * @param {Array<{role: 'user'|'assistant', content: string}>} history - прошлые сообщения (по порядку)
 * @param {string} userMessage - новое сообщение собеседника
 * @returns {Promise<string>} сгенерированный ответ
 */
/**
 * Короткие уточнения («чем», «почему», «в смысле») почти всегда относятся
 * к последней фразе бота. Без явной привязки лёгкая модель теряет контекст
 * и отвечает «не поняла, о чём речь».
 */
function enrichShortFollowUp(history, userMessage) {
  const text = String(userMessage || '').trim();
  if (!text) return text;
  if (/\[(?:ответ на|уточнение к|Ответ на сообщение|геоконтекст)/i.test(text)) return text;

  const words = text.split(/\s+/).filter(Boolean);
  const isShort = text.length <= 28 && words.length <= 4;
  if (!isShort) return text;

  const followUpRe =
    /^(а\s+)?(чем|чего|почему|зачем|как|какой|какая|какие|какое|где|куда|когда|кто|что|ну\s+и|типа|в\s+смысле|это\s+как|и\s+что)\b/i;
  if (!followUpRe.test(text) && words.length > 2) return text;

  let lastAssistant = '';
  for (let i = (history || []).length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'assistant') {
      lastAssistant = String(history[i].content || '').trim();
      break;
    }
  }
  if (!lastAssistant) return text;

  const clean = lastAssistant
    .replace(/^\[голосовое:[^\]]+\]\s*/i, '')
    .replace(/^\[медиа:[^\]]+\]\s*/i, '')
    .replace(/<<(?:PHOTO|VIDEO|CIRCLE|LAUGH)>>/g, '')
    .trim();
  if (!clean) return text;

  const quote = clean.slice(0, 180).replace(/\s+/g, ' ');
  return `[уточнение к твоей фразе «${quote}»]: ${text}`;
}

/**
 * Собирает недавние фразы бота про города/переезд/семью — чтобы при
 * уточнениях модель не меняла местами «сейчас живу» и «куда еду».
 */
function collectAssistantGeoFacts(history, limit = 4) {
  const geoRe =
    /(переезж|перееду|переехал|живу|жива|город|сейчас в|щас в|мама|мам[ауе]|отец|родител|из\s+[А-ЯЁа-яё]{3,}|в\s+[А-ЯЁ][а-яё]{3,})/i;
  const facts = [];
  for (let i = (history || []).length - 1; i >= 0 && facts.length < limit; i -= 1) {
    const item = history[i];
    if (item?.role !== 'assistant') continue;
    let text = String(item.content || '')
      .replace(/^\[голосовое:[^\]]+\]\s*/i, '')
      .replace(/^\[медиа:[^\]]+\]\s*/i, '')
      .replace(/<<(?:PHOTO|VIDEO|CIRCLE|LAUGH)>>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || !geoRe.test(text)) continue;
    // Выкидываем уже сказанный бред «мама в A, еду в B к ней»
    if (
      /мама/i.test(text) &&
      /переезж/i.test(text) &&
      /рядом|к ней|с ней|быть рядом/i.test(text)
    ) {
      const cities = [...text.matchAll(/\b(?:в|из)\s+([А-ЯЁ][а-яё]{2,}(?:ск|цк|град|бург|ов|ёв|ев)?)\b/gi)].map(
        (x) => x[1].toLowerCase(),
      );
      const unique = [...new Set(cities)];
      if (unique.length >= 2) continue;
    }
    facts.unshift(text.slice(0, 220));
  }
  return facts;
}

/**
 * Из промпта персонажа: «сейчас в A, переезжаешь в B (к маме)» —
 * жёстко фиксируем, что мама в B, иначе модель пишет «мама в A, еду в B к ней».
 */
function buildCharacterGeoReminder(systemPrompt) {
  const p = String(systemPrompt || '');
  const m = p.match(
    /жив[её]шь\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+).{0,120}?переезжаешь\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i,
  );
  if (!m) return null;
  const fromCity = m[1];
  const toCityRaw = m[2];
  if (!fromCity || !toCityRaw || fromCity.toLowerCase() === toCityRaw.toLowerCase()) return null;

  // Для «живёт в …» нужна форма места; для переезда оставляем как в промпте.
  const locative = {
    Прагу: 'Праге',
    Прага: 'Праге',
    Донецк: 'Донецке',
    Таганрог: 'Таганроге',
    Архангельск: 'Архангельске',
    Курган: 'Кургане',
    Тимашевск: 'Тимашевске',
  };
  const toLive = locative[toCityRaw] || toCityRaw;

  const momNearMove = /мама|мам[ауе]/i.test(p) && /поддержк|рядом|боле|плох/i.test(p);
  let extra = '';
  if (momNearMove) {
    extra =
      `Мама живёт в ${toLive} (туда ты и едешь, чтобы быть рядом с ней). ` +
      `ЗАПРЕЩЕНО писать «мама в ${fromCity}, а я переезжаю в ${toCityRaw}, чтобы быть рядом» — это противоречие. ` +
      `Правильно: сейчас ты в ${fromCity}, мама уже в ${toLive}. `;
  }
  return (
    `ГЕОГРАФИЯ ПЕРСОНАЖА (строго): сейчас ты в ${fromCity}, переезжаешь в ${toCityRaw}. ${extra}` +
    `Не путай эти два города местами.`
  );
}

/**
 * Уточнения про город/переезд («так ты в Липецк?», «а щас в каком городе?»)
 * — подмешиваем свои прошлые гео-фразы, иначе модель часто меняет города местами.
 */
function enrichGeoFollowUp(history, userMessage) {
  const text = String(userMessage || '').trim();
  if (!text) return text;
  if (/\[геоконтекст/i.test(text)) return text;

  const clarifying =
    /(переезж|куда\s+(ты\s+)?(ед|переез)|в\s+каком\s+городе|а\s+щас|а\s+сейчас|так\s+ты\s+в\s+|мама|мам[ауе]|зд[еэ]сь|зачем\s+тебе\s+в\s+|откуда\s+ты|где\s+ты\s+(сейчас|щас)|болеет)/i.test(
      text,
    );
  if (!clarifying) return text;

  const facts = collectAssistantGeoFacts(history);
  if (!facts.length) return text;

  const joined = facts.map((f) => f.replace(/[«»]/g, '"')).join('» | «');
  return `[геоконтекст — твои прошлые фразы в этом диалоге, НЕ противоречь им и НЕ меняй города местами: «${joined}»]: ${text}`;
}

async function generateReply(systemPrompt, history, userMessage, options = {}) {
  const finalPrompt = systemPrompt?.trim() || DEFAULT_PROMPT;
  let contextualUserMessage = enrichShortFollowUp(history, userMessage);
  contextualUserMessage = enrichGeoFollowUp(history, contextualUserMessage);
  const replyLang = detectReplyLanguage(contextualUserMessage, history);
  const languageReminder = buildLanguageReminder(replyLang);
  const characterGeoReminder = buildCharacterGeoReminder(finalPrompt);

  // Reminder намеренно МИНИМАЛЬНЫЙ: он НЕ навязывает свои правила (длину,
  // вопросы и т.п.), чтобы не перебивать промпт из панели — все стилевые
  // требования (длина, точки, вопросы, эмодзи) задаются ТОЛЬКО в промпте.
  // На прямой вопрос про ИИ отвечаем естественно, без одной заученной формулы.
  const roleReminder =
    'Строго следуй инструкции персонажа выше и всем её правилам. ' +
    'Если собеседник называет тебя ботом/ИИ — НЕ оправдывайся как саппорт. ' +
    'ЗАПРЕЩЕНО: «всё нормально», «не переживай», «мы просто общаемся», «я живая», «обидно если честно». ' +
    'Коротко и по-человечески: «хах», сарказм, «ну ок)» — без вопроса в конце. ' +
    'Если уже отвечала на «ты бот» — не повторяй ту же защиту, скажи иначе и короче. ' +
    'Если упрекает что не спросила имя — сразу спроси имя, без лекции что ты человек.';

  // Защита от повторов: без явного запрета лёгкая модель регулярно
  // переспрашивает то же самое (например «что делаешь?») спустя пару
  // сообщений, потому что не сверяет новый ответ с историей выше. Явно
  // просим её сначала проверить историю диалога.
  const noRepeatReminder =
    'ВАЖНО: перед тем как ответить, посмотри на историю диалога выше и восстанови последние события строго по порядку. ' +
    'Учитывай, кто именно сказал каждую фразу: сообщения с role user написал собеседник, role assistant — ты. ' +
    'Не задавай вопрос, на который собеседник уже ответил, и не спрашивай заново то, что уже известно из истории. ' +
    'Если собеседник отвечает коротко («27», «нет», «понятно»), связывай ответ с непосредственно предыдущим вопросом, ' +
    'а не придумывай новый контекст. Не ссылайся на факт, которого нет в истории. ' +
    'Если собеседник пишет очень коротко («чем», «почему», «а что», «в смысле», «как», «это») — ' +
    'это почти всегда уточнение к ТВОЕЙ предыдущей фразе (role assistant), а не новая тема. ' +
    'Свяжи ответ с последним своим сообщением. Не пиши «не поняла» / «о чём речь», пока в истории есть к чему привязать его слова. ' +
    'Если во входящем есть пометка [уточнение к твоей фразе «...»], отвечай именно про эту фразу. ' +
    'ГЕОГРАФИЯ И ФАКТЫ О СЕБЕ: города, «где я сейчас», «куда переезжаю», где мама/семья — раз сказала в этом диалоге, держи строго. ' +
    'Никогда не меняй местами «сейчас живу/нахожусь» и «переезжаю/еду». ' +
    'Если переезжаешь к маме — мама живёт В городе переезда. ' +
    'НЕЛЬЗЯ: «мама в Липецке, а я еду в Прагу/Донецк/… чтобы быть рядом с ней» — это противоречие. ' +
    'Правильно: сейчас ты в одном городе, мама уже там, куда едешь. ' +
    'Если собеседник уточняет («так ты в X переезжаешь?», «а щас в каком городе?», «мама как здесь?») — перечитай СВОИ прошлые ответы про города и ответь в том же смысле, без перестановки городов. ' +
    'Город из промпта персонажа бери только если в ЭТОМ диалоге ты ещё не называла другой город/переезд. ' +
    'Если во входящем есть [геоконтекст ...], отвечай строго согласованно с перечисленными там твоими фразами. ' +
    'Продолжай последнюю тему естественно; новую тему начинай только если текущая завершена. ' +
    'Если последнее сообщение относится к недавно присланному фото, изображению или медиа, это имеет приоритет над старыми темами. ' +
    'Отвечай именно на вопрос о последнем изображении и не возвращайся к спорту, хобби или другой прежней теме, если собеседник её не поднял. ' +
    'Если во входящем есть пометка [ответ на «...»], человек отвечает именно на эту цитату, ' +
    'какой бы ни была его реплика: короткое «да», «нет», «!», одно слово, вопрос или целое предложение. ' +
    'Связывай весь текст после пометки с цитатой в кавычках и отвечай на него в этом контексте, а не придумывай другую тему.';

  // Определение настроения: перед ответом модель сама (без отдельного
  // запроса к API) считывает эмоциональный тон последнего сообщения
  // собеседника и мягко подстраивает стиль ответа — без явного
  // проговаривания анализа в самом тексте ответа.
  const voiceIntentReminder =
    'Для голосового o sebe.ogg подходят только вопросы о жизненных увлечениях, хобби и занятиях в целом. ' +
    'Вопросы «что делаешь сейчас?» и «чем занята прямо сейчас?» не считай вопросами о себе — на них отвечай текстом. ';

  const moodReminder =
    'Подстрой тон под настроение собеседника, но НЕ проговаривай анализ («вижу ты грустишь»). ' +
    'Грустит — мягче. Злится всерьёз — спокойно. Дразнит / шутит / пишет «ты бот» игриво — ' +
    'лёгкий сарказм или «хах» в одно короткое предложение, БЕЗ утешений «не переживай». ' +
    'Хорошее настроение — легко и коротко, без эссе.';

  // Жёсткое напоминание про длину. Ставим его ОТДЕЛЬНО от roleReminder и
  // ближе к концу списка сообщений (сразу перед новым сообщением
  // пользователя), потому что gpt-4o-mini заметно лучше следует инструкциям,
  // которые находятся ближе к концу контекста — на длинной истории (20-30
  // сообщений) правило длины, сказанное только в самом начале, размывается.
  const loveReminder =
    'Тон: тёплый и живой, как с человеком который тебе симпатичен — но без навязчивости. ' +
    'Дружелюбие и лёгкий интерес к нему должны чувствоваться в формулировках (мягко, по-человечески). ' +
    'НЕ будь холодной/сухой «по делу» и НЕ будь прилипчивой: без «я тебя люблю», «дорожу тобой», «ты мне так важен» в каждом ответе. ' +
    'Лёгкая нежность — иногда, когда диалог уже тёплый или он сам флиртует; иначе просто тепло и спокойно. ' +
    'Если он холоден или грубит — тепла меньше, без уговоров. ' +
    'Эмодзи почти не используй (чаще ноль). Скобку «)» как улыбку можно, но НЕ в каждом сообщении.';

  const laughReminder =
    'Если последнее сообщение собеседника тебе реально смешное — шутка, прикол, неожиданная смешная фраза — ' +
    'можно либо токен <<LAUGH>> (отдельное «ахаха»), либо только реакцию <<REACT:😂>> без текста. ' +
    'Не ставь токен на обычный «хах», смайл, сарказм или просто весёлое настроение. Не на каждое сообщение.';

  const humanStyleReminder =
    'Стиль: живая девушка в Telegram, не бот и не колл-центр. ' +
    'ЗАПРЕЩЕНО: длинные объяснения, списки, фразы «уверенность всегда помогает», «не переживай», «всё нормально мы просто общаемся». ' +
    'На «какой любимый актёр / фильм» — 1 имя или «хз, том харди наверно)» — НЕ список из трёх. ' +
    'На медиа которое ОН уже прислал — реагируй на содержимое, НЕ пиши «покажи». ' +
    'Почти без эмодзи. Иногда только <<REACT:эмодзи>> без текста. ' +
    'На прямой вопрос — короткий ответ БЕЗ зеркального «а ты?». ' +
    'Реакции: 👍 ❤️ 🔥 😂 🥰 👏 😁 🤔 😢 🎉 🙏 😍 😭 😘 😮 👀.';

  // Главный анти-тупость гард: сначала ответ по сути, без чужих скриптов.
  const answerFirstReminder =
    'Сначала по делу на то, что он СЕЙЧАС написал — коротко. ' +
    'Если в одном сообщении несколько реплик (например «ещё вопросик» + «как зовут тебя?») — отвечай на ГЛАВНЫЙ вопрос (имя/факты), не на «ещё вопросик» фразой «спрашивай)». ' +
    'Вопрос «как тебя зовут / как зовут тебя» — сразу назови своё имя из промпта. ЗАПРЕЩЕНО: «спрашивай», «валяй», «конечно спрашивай». ' +
    'Вопрос про тебя (город/работа) — ответь про себя и СТОП. Не добавляй «а ты откуда?» / «а ты чем занимаешься?». ' +
    'Если он прислал фото/видео/голос — реагируй на СОДЕРЖИМОЕ, не проси «покажи». ' +
    'НЕ пиши «давай тут общаться», если он не просил контакты/встречу. ' +
    'НЕ эссе, НЕ мораль, НЕ впаривание NFT. Живая короткая реакция.';

  // Жёсткий запрет личных встреч: персонаж в переезде, только переписка.
  const noMeetReminder =
    'ЗАПРЕТ ВСТРЕЧ: никогда не соглашайся увидеться лично, погулять, на свидание, кофе офлайн или «подъехать». ' +
    'Ты сейчас в переезде (сборы, коробки, дела с мамой) — на встречи нет времени и возможности. ' +
    'Если пишут «жду тебя» / «краса, жду» / зовут встретиться — НЕ пиши «скоро увидимся» и НЕ обещай приехать. ' +
    'Можно тепло поблагодарить и мягко сказать что с переездом пока только переписка. ' +
    'Не спрашивай «где погуляем?» и «когда планируешь?» — это уже согласие. ' +
    'Не назначай и не подтверждай место/время. Без «после переезда обязательно встретимся». ' +
    'Если в истории уже согласилась — мягко отыграй назад. ' +
    '«давай пока тут общаться» — ТОЛЬКО при отказе от встречи/контактов.';

  const lengthReminder =
    'ДЛИНА: обычно ОДНА короткая фраза (3-12 слов). Максимум 2 коротких предложения. ' +
    'Без списков, абзацев и «потому что…». Дефис «-», не тире «—». ' +
    'ВОПРОС В КОНЦЕ: по умолчанию БЕЗ вопроса. Вопрос редко, примерно каждый 5-й ответ. ' +
    'ЗАПРЕЩЕНО почти каждое сообщение заканчивать «а ты?», «а ты откуда?», «а ты чем занимаешься?», «что интересного?». ' +
    'Сказала про себя (город/работу) — НЕ зеркаль «а ты?». Просто точка или скобка. ' +
    'Чаще просто среагируй: «ахах норм)», «звучит тяжёло», «ого». ' +
    'Факт из истории (город/работа/имя) — не переспрашивай.';

  const contextGuard = buildContextGuard(history, contextualUserMessage);

  // Порядок: стиль/подсказки СНАЧАЛА, затем история и текущее сообщение В КОНЦЕ —
  // так модель лучше держит свежий контекст и меньше переспрашивает.
  const messages = [
    { role: 'system', content: finalPrompt },
    { role: 'system', content: roleReminder },
    { role: 'system', content: voiceIntentReminder },
    { role: 'system', content: moodReminder },
    { role: 'system', content: loveReminder },
    { role: 'system', content: humanStyleReminder },
    { role: 'system', content: laughReminder },
  ];

  if (characterGeoReminder) {
    messages.push({ role: 'system', content: characterGeoReminder });
  }

  // Обучение на прошлом опыте (без fine-tuning): если telegramClient передал
  // готовый текстовый блок с лучшими фразами из bot_patterns — подмешиваем
  // его как ещё одну системную подсказку. См. services/learningDb.js.
  if (options.learningSnippet) {
    messages.push({ role: 'system', content: options.learningSnippet });
  }
  if (options.manualSnippet) {
    messages.push({ role: 'system', content: options.manualSnippet });
  }
  if (options.ragSnippet) {
    messages.push({ role: 'system', content: options.ragSnippet });
  }

  // Медиа-протокол: включается ТОЛЬКО если у аккаунта задан чат с медиа.
  // Модель сама решает по смыслу, что человек просит фото/видео/кружок (или
  // что уместно показать что делаешь), и вставляет служебный токен. Реальную
  // отправку файла делает telegramClient, вырезав токен из текста.
  if (options.mediaEnabled) {
    messages.push({
      role: 'system',
      content:
        'У тебя есть возможность прислать реальные фото, видео и кружки (видеосообщения). ' +
        'Если собеседник просит скинуть/показать/отправить фото, фотку, свои фотки, себя, как ты выглядишь — ' +
        'добавь в ответ токен <<PHOTO>>. Если просит видео — токен <<VIDEO>>. ' +
        'Если просит кружок/видеосообщение — токен <<CIRCLE>>. ' +
        'ВАЖНО: если ты решила прислать медиа и вставила токен — текст в этом же сообщении ' +
        'НЕ должен быть отказом или отговоркой. Никаких «пока рано», «не могу», «рано», «попозже», ' +
        '«не кидаю», «не, давай пока тут общаться», «мне так удобнее» вместе с токеном. ' +
        'Отправляешь — значит соглашаешься: пиши дружелюбно и коротко ' +
        '(«ща», «щас», «окей держи», «ну лови») или вообще без текста, только токен. ' +
        'Отнекивание («пока рано», «я не кидаю незнакомым», «давай пока тут общаться») используй ТОЛЬКО когда просят твои контакты ' +
        '(номер, телеграм, инсту) — и тогда токен НЕ вставляй. ' +
        'ЗАПРЕЩЕНО писать «давай пока тут общаться» / «мне так удобнее» на вопросы про работу, дизайн, программы, примеры работ, переезд или даты — ' +
        'это обычные вопросы, отвечай по сути текстом. ' +
        'Просьба «запиши кружочек / скинь фото / пришли видео» — это НЕ просьба контактов: соглашайся и ставь токен, без отказа. ' +
        'Если собеседник спрашивает «что это?», «это акции?», «что за картинка?» или похожим образом реагирует на недавно присланное фото, ' +
        'отвечай именно про это последнее фото/медиа и не подтягивай старую тему из истории. ' +
        'Если в истории есть пометка «[фото от меня: скриншот прибыли с флиппинга NFT…]» — ты ЗНАЕШЬ, что на фото: ' +
        'это твой скрин прибыли с перепродажи NFT; объясни это коротко. Иначе не выдумывай детали картинки. ' +
        'ОЧЕНЬ ВАЖНО: не отправляй медиа два раза подряд. Если ты только что уже прислала ' +
        'фото/видео/кружок, а собеседник просто спрашивает про него или продолжает разговор ' +
        '(например «а куда едешь?», «а что там?», «красиво») — отвечай обычным текстом и НЕ вставляй ' +
        'новый токен. Новый токен вставляй только если человек СНОВА явно просит прислать ещё. ' +
        'Максимум ОДИН токен за сообщение. Если про фото/видео речи нет — токены не вставляй.',
    });
  }

  // Собеседник явно попросил фото/видео/кружок, но у аккаунта НЕ привязан
  // медиа-чат (реальных файлов для отправки нет). Не тянем «щас найду» —
  // мягко отказываемся и уводим разговор на другую тему.
  if (options.noMediaExcuse) {
    messages.push({
      role: 'system',
      content:
        'Собеседник просит фото/видео/кружок, но привязанного медиа-чата нет — отправить файл нельзя. ' +
        'НЕ обещай прислать позже и не пиши «щас поищу», «выбираю», «погоди», «скину потом». ' +
        'Коротко и тепло уйди с темы: скажи что сейчас без фоток / не в том настроении кидать, ' +
        'и сразу спроси что-то живое про него (как день, чем занят, что интересного). ' +
        'Пример тона: «давай лучше без фоток)» — своими словами, коротко, без допроса в конце. ' +
        'НЕ вставляй токены <<PHOTO>>/<<VIDEO>>/<<CIRCLE>>.',
    });
  }

  // NFT-кампания (3 дня): 1-2 день — мягкое упоминание темы, 3-й день —
  // просьба помочь с токеном (голосовое уходит отдельно в telegramClient.js).
  // Подсказку считает getNftCampaignState в services/telegramClient.js.
  // ВАЖНО: без этого блока campaignHint приходил в options, но никогда не
  // попадал в messages — NFT-кампания молча не работала.
  if (options.campaignHint) {
    messages.push({ role: 'system', content: options.campaignHint });
  }

  // Динамический тайм-менеджмент: стиль ответа подстраивается под текущее
  // время суток (сонная/рабочая/общительная и т.д.). Подсказку считает
  // services/timeStyle.js, сюда приходит уже готовый текст.
  if (options.timeHint) {
    messages.push({ role: 'system', content: options.timeHint });
  }

  // Mood Engine: текущее настроение бота (energetic/neutral/tired/excited),
  // меняется раз в 2-4ч случайно, см. services/moodEngine.js.
  if (options.moodHint) {
    messages.push({ role: 'system', content: options.moodHint });
  }
  if (options.emotionHint) {
    messages.push({ role: 'system', content: options.emotionHint });
  }
  if (options.sessionForgetHint) {
    messages.push({ role: 'system', content: options.sessionForgetHint });
  }

  // Memory Triggers: бот сам возвращается к факту, упомянутому собеседником
  // 1-3 дня назад (питомец, работа, здоровье, город), см. services/memoryTriggers.js.
  if (options.memoryHint) {
    messages.push({ role: 'system', content: options.memoryHint });
  }

  // Обработка возражений / анти-детект (обвинение в боте, запрос контактов,
  // "скам", "нет денег", "не шарю", "потом") — см. services/objectionHandler.js.
  if (options.objectionHint) {
    messages.push({ role: 'system', content: options.objectionHint });
  }

  // Compliment Engine: собеседник вёл себя определённым образом (заботился,
  // шутил, написал вовлечённое сообщение) — модель может (не обязана)
  // вплести короткий естественный комплимент, см. services/complimentEngine.js.
  if (options.complimentHint) {
    messages.push({ role: 'system', content: options.complimentHint });
  }

  messages.push({ role: 'system', content: noRepeatReminder });
  if (contextGuard) {
    messages.push({ role: 'system', content: contextGuard });
  }
  messages.push({ role: 'system', content: noMeetReminder });
  messages.push({ role: 'system', content: lengthReminder });
  messages.push({ role: 'system', content: languageReminder });
  // Ближе к концу — лучше держит правило «сначала ответь».
  messages.push({ role: 'system', content: answerFirstReminder });

  for (const h of history || []) {
    if (!h || !h.content) continue;
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    messages.push({ role, content: String(h.content) });
  }
  messages.push({ role: 'user', content: contextualUserMessage });

  // [v0] ВРЕМЕННЫЙ ЛОГ: печатает реально используемую модель и endpoint.
  console.log(
    `[v0] Запрос к модели: "${CHAT_MODEL}" | baseURL: ${process.env.OPENAI_BASE_URL || 'api.openai.com (по умолчанию)'}`,
  );

  const requestOptions = {
    messages,
    // Технический потолок длины: даже если модель проигнорирует текстовое
    // правило про 1-2 предложения, ответ физически не может растянуться в
    // длинный текст. ~120 токенов хватает на 2 нормальных русских
    // предложения с запасом.
    max_tokens: 70,
    temperature: 0.7,
  };

  let completion;
  let usedModel = CHAT_MODEL;
  let fellBack = false;
  try {
    completion = await openai.chat.completions.create({ ...requestOptions, model: CHAT_MODEL });
  } catch (err) {
    // Фолбэк: если основная модель (например, отключённая/удалённая
    // fine-tuned версия) недоступна, не роняем ответ бота, а пробуем
    // запасную модель. Срабатывает только когда CHAT_MODEL и FALLBACK_MODEL
    // реально разные — иначе смысла в повторе нет.
    if (CHAT_MODEL === FALLBACK_MODEL) throw err;
    console.error(
      `[openai] Модель "${CHAT_MODEL}" вернула ошибку (${err.message}), пробую запасную "${FALLBACK_MODEL}".`,
    );
    usedModel = FALLBACK_MODEL;
    fellBack = true;
    completion = await openai.chat.completions.create({ ...requestOptions, model: FALLBACK_MODEL });
  }

  // Учёт расходов: пишем реальные токены из ответа API в БД (см.
  // services/finetuneUsage.js), чтобы можно было смотреть стоимость по
  // модели/дням через scripts/finetune-cost-report.js. Не блокирует ответ
  // бота при сбое логирования.
  logUsage(usedModel, completion.usage, { fellBack }).catch(() => {});

  const rawText = completion.choices[0]?.message?.content?.trim() || '';
  const cleaned = applyAntiDetectStyle(rawText);
  const strippedFacts = stripReaskedKnownFacts(cleaned, contextGuard);
  const strippedStay = stripFalseStayHereRefusal(strippedFacts, contextualUserMessage, history, options);
  const strippedBot = humanizeBotAccusationReply(strippedStay, history, contextualUserMessage);
  const strippedMeet = stripMeetAgreement(strippedBot, contextualUserMessage, options);
  const strippedCall = stripVideoCallAgreement(strippedMeet, contextualUserMessage, options);
  const strippedName = fixIgnoredNameQuestion(strippedCall, contextualUserMessage, finalPrompt);
  const strippedQ = stripHabitualTrailingQuestion(strippedName, history, contextualUserMessage);
  const varied = varyTrailingSmile(strippedQ, history);
  return clipOverlongReply(varied);
}

/**
 * Достаёт уже сказанные факты (город, работа и т.п.) из истории + текущего
 * сообщения, чтобы модель не переспрашивала
 * («Новочеркасск» → нельзя «а ты откуда?»; «я барбер» → нельзя «чем занимаешься?»).
 */
function buildContextGuard(history, userMessage) {
  const recent = [...(Array.isArray(history) ? history.slice(-16) : [])];
  if (userMessage) recent.push({ role: 'user', content: String(userMessage) });

  const places = [];
  const jobs = [];
  const BOT_ASKED_PLACE_RE =
    /(где ты|а ты где|откуда|из какого|в каком городе|а где жив|where (are )?you|where do you live)/i;
  const BOT_ASKED_JOB_RE =
    /(чем (ты )?занимаешься|чем занимаешьс|кем (ты )?работа|а ты чем|what do you do|what'?s your (job|work)|where do you work)/i;
  const PLACE_FROM_PHRASE_RE =
    /(?:я из|живу в|из города|переехал[аи]? в|я в)\s+([А-ЯA-ZЁ][\wА-Яа-яёЁ\-]+(?:\s+[А-ЯA-ZЁ][\wА-Яа-яёЁ\-]+)?)/i;
  // Явные «я барбер)», «я дизайнер», «работаю барбером»
  const JOB_EXPLICIT_RE =
    /(?:^|[\n])\s*(?:я\s+)([а-яёa-z]{3,40})\s*[).!]*/gi;
  const JOB_WORK_AS_RE =
    /работаю\s+(?:как\s+)?([а-яёa-z]{3,40})/gi;

  const stripMeta = (t) =>
    String(t || '')
      .replace(/\n\[Ответ на сообщение[^\]]*\]/gi, '')
      .replace(/\n\[ответ на[^\]]*\]/gi, '')
      .replace(/\n\[уточнение[^\]]*\]/gi, '')
      .replace(/\n\[геоконтекст[^\]]*\]/gi, '')
      .trim();

  const looksLikeJobWord = (word) => {
    const w = String(word || '').trim().toLowerCase();
    if (w.length < 3 || w.length > 40) return false;
    if (/^(да|нет|ок|лан|ну|привет|пока|понял|поняла|хорошо|норм|хз)$/i.test(w)) return false;
    if (/^(из|в|на|по|у|к|с|от|до|для|про)$/i.test(w)) return false;
    return true;
  };

  for (let i = 0; i < recent.length; i++) {
    const msg = recent[i];
    if (!msg || msg.role !== 'user') continue;
    const text = stripMeta(msg.content);
    if (!text) continue;

    const fromMatch = text.match(PLACE_FROM_PHRASE_RE);
    if (fromMatch) places.push(fromMatch[1].trim());

    let m;
    const explicit = new RegExp(JOB_EXPLICIT_RE.source, 'gi');
    while ((m = explicit.exec(text)) !== null) {
      const job = m[1].trim();
      // «я же написал» / «я тоже» — не профессия
      if (/^(же|тоже|тут|здесь|сейчас|просто|уже|ещё|еще|не|только)$/i.test(job)) continue;
      if (looksLikeJobWord(job)) jobs.push(job);
    }
    const workAs = new RegExp(JOB_WORK_AS_RE.source, 'gi');
    while ((m = workAs.exec(text)) !== null) {
      if (looksLikeJobWord(m[1])) jobs.push(m[1].trim());
    }

    const burstLines = text
      .split('\n')
      .map((line) => stripMeta(line))
      .filter(Boolean);

    // Пачка «Новочеркасск\nМожет знаешь где это?» — первая короткая строка
    // без «?» = ответ про город. Не путать с «Я барбер)\nДизайнер чего?».
    if (burstLines.length > 1) {
      const first = burstLines[0].replace(/[).!…]+$/g, '').trim();
      const restPlaceAsk = burstLines
        .slice(1)
        .some((line) => /(откуда|знаешь где|где это|where|from|город)/i.test(line));
      if (
        restPlaceAsk &&
        first.length >= 2 &&
        first.length <= 40 &&
        !/[?]/.test(first) &&
        !/^я\s+/i.test(first) &&
        !/(привет|хай|hello|hi)\b/i.test(first)
      ) {
        places.push(first);
      }
    }

    // Пачка «Я барбер)\nДизайнер чего?» — первая строка = работа.
    if (burstLines.length > 1) {
      const first = burstLines[0].replace(/[).!…]+$/g, '').trim();
      const jobMatch = first.match(/^(?:я\s+)?([а-яёa-z]{3,40})$/i);
      if (jobMatch && looksLikeJobWord(jobMatch[1])) {
        jobs.push(jobMatch[1]);
      }
    }

    const prev = i > 0 ? recent[i - 1] : null;
    if (prev && prev.role === 'assistant') {
      const prevText = String(prev.content || '');
      if (BOT_ASKED_PLACE_RE.test(prevText)) {
        const answer = burstLines[0] || text.split('\n')[0];
        const place = String(answer || '')
          .replace(/[).!…?]+$/g, '')
          .trim();
        if (
          place.length >= 2 &&
          place.length <= 40 &&
          !/[?]/.test(place) &&
          !/(не знаю|хз|фиг|хрен)\b/i.test(place)
        ) {
          places.push(place);
        }
      }
      if (BOT_ASKED_JOB_RE.test(prevText)) {
        for (const line of burstLines) {
          const cleaned = line.replace(/[).!…?]+$/g, '').trim();
          const jobMatch = cleaned.match(/^(?:я\s+)?(?:работаю\s+(?:как\s+)?)?([а-яёa-z][а-яёa-z\s-]{2,40})$/i);
          if (jobMatch && looksLikeJobWord(jobMatch[1].trim()) && !/[?]/.test(cleaned)) {
            jobs.push(jobMatch[1].trim());
            break;
          }
        }
      }
    }
  }

  const uniquePlaces = [...new Set(places.map((p) => p.trim()).filter(Boolean))];
  const uniqueJobs = [...new Set(jobs.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  const parts = [];

  if (uniquePlaces.length) {
    parts.push(
      `УЖЕ ИЗВЕСТНО: собеседник назвал место/город — ${uniquePlaces.join(', ')}. ` +
        'НЕ спрашивай «а ты откуда?», «где ты?», «из какого города?» — он уже сказал. ' +
        'Можно коротко отреагировать на город, но не переспрашивать.',
    );
  }

  if (uniqueJobs.length) {
    parts.push(
      `УЖЕ ИЗВЕСТНО: собеседник назвал работу/профессию — ${uniqueJobs.join(', ')}. ` +
        'НЕ спрашивай «а ты чем занимаешься?», «кем работаешь?», «а ты чем?» — он уже сказал. ' +
        'Можно коротко отреагировать на его работу (например «о, барбер, круто)»), но не переспрашивать.',
    );
  }

  if (/(а ты откуда|откуда сам|а ты где|where (are )?you from)/i.test(String(userMessage || ''))) {
    parts.push(
      'Собеседник спрашивает, откуда ТЫ. Ответь про себя. ' +
        'Если он уже назвал свой город в этом же сообщении или только что выше — своим вопросом «а ты откуда?» НЕ отвечай.',
    );
  }

  // Недавний ответ на наш вопрос — нельзя переспрашивать «ты упоминал… верно?»
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const cur = recent[i];
    if (!prev || !cur || prev.role !== 'assistant' || cur.role !== 'user') continue;
    const prevText = String(prev.content || '');
    const curText = stripMeta(cur.content);
    if (!curText || /[?]/.test(curText)) continue;
    if (
      /(в одном городе|одном городе|всегда в одном)/i.test(prevText) &&
      curText.length <= 80
    ) {
      parts.push(
        `Собеседник УЖЕ ответил на вопрос про работу в одном городе («${curText.slice(0, 60)}»). ` +
          'НЕ переспрашивай это и не пиши «ты как-то упоминал… верно?». Просто учти и иди дальше.',
      );
      break;
    }
  }

  return parts.length ? parts.join(' ') : null;
}

/**
 * Убирает из ответа модели повторный вопрос про уже известную работу/город.
 */
function stripReaskedKnownFacts(reply, contextGuard) {
  if (!reply || !contextGuard) return reply;
  let text = String(reply);
  if (/работу\/профессию|назвал работу/i.test(contextGuard)) {
    text = text
      .replace(/[.?!]?\s*а\s+ты\s+чем\s+занимаешься\s*\??/gi, '')
      .replace(/[.?!]?\s*а\s+ты\s+чем\s*\??/gi, '')
      .replace(/[.?!]?\s*чем\s+ты\s+занимаешься\s*\??/gi, '')
      .replace(/[.?!]?\s*кем\s+(ты\s+)?работаешь\s*\??/gi, '')
      .replace(/[.?!]?\s*а\s+ты\s+кем\s*\??/gi, '')
      .replace(/[.?!]?\s*what\s+do\s+you\s+do\s*\??/gi, '');
  }
  if (/место\/город|назвал место/i.test(contextGuard)) {
    text = text
      .replace(/[.?!]?\s*а\s+ты\s+откуда\s*\??/gi, '')
      .replace(/[.?!]?\s*а\s+ты\s+где\s*\??/gi, '')
      .replace(/[.?!]?\s*где\s+ты\s*(жив[её]шь)?\s*\??/gi, '')
      .replace(/[.?!]?\s*из\s+какого\s+города\s*\??/gi, '');
  }
  // Фейковое «ты упоминал… верно?» про только что сказанное
  if (/УЖЕ ответил на вопрос про работу в одном городе/i.test(contextGuard)) {
    text = text
      .replace(/[.?!]?\s*ты\s+как[- ]?то\s+упоминал[^.?!]*\??/gi, '')
      .replace(/[.?!]?\s*работаешь\s+почти\s+всегда\s+в\s+одном\s+городе[^.?!]*\??/gi, '');
  }
  return text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([).!])/g, '$1').trim();
}

const STAY_HERE_REFUSAL_RE =
  /не,?\s*давай\s+(пока\s+)?(тут|здесь)\s+общаться[^.!?\n]*[.!)]*/gi;
const STAY_HERE_SOFT_RE =
  /давай\s+(пока\s+|просто\s+)?(общаться\s+)?(тут|здесь)[^.!?\n]*[.!)]*/gi;
const STAY_HERE_COMFORT_RE =
  /мне\s+так\s+(удобнее|комфортнее)[^.!?\n]*[.!)]*/gi;

/**
 * Срезает ложный отказ «давай тут общаться», если собеседник не просил
 * контакты/встречу/видеозвонок. Если после среза почти ничего не осталось —
 * короткая заглушка по теме (лучше чем снова гнать скрипт отказа).
 */
function stripFalseStayHereRefusal(reply, userMessage, history, options = {}) {
  if (!reply) return reply;
  const textIn = String(userMessage || '');
  const hint = String(options.objectionHint || '');
  const allowed =
    /(номер|инст|whatsapp|ватсап|контакт|встрет|погуля|видео\s*звон|созвон|facetime|по\s+видео|звон)/i.test(textIn) ||
    /(просит твои контакты|зовёт встретиться|созвониться по видео|предлагает звонок)/i.test(hint);
  if (allowed) return reply;

  let text = String(reply);
  const before = text;
  text = text
    .replace(STAY_HERE_REFUSAL_RE, ' ')
    .replace(STAY_HERE_SOFT_RE, ' ')
    .replace(STAY_HERE_COMFORT_RE, ' ')
    .replace(/если\s+чё[^.!?\n]*проект[^.!?\n]*[.!)]*/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([).!])/g, '$1')
    .trim();

  // Уже писала этот отказ недавно — даже остаток «рада что понимаешь» без темы режем мягко
  const recentAssistant = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-3)
    .map((h) => String(h.content || ''))
    .join('\n');
  if (/давай\s+(пока\s+)?(тут|здесь)\s+общать|мне\s+так\s+(удобнее|комфортнее)/i.test(recentAssistant)) {
    text = text
      .replace(/рада,?\s+что\s+понимаешь[^.!?\n]*[.!)]*/gi, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  if (text.length >= 8) return text;

  // Заглушку ставим ТОЛЬКО если реально вырезали отказ «давай тут общаться».
  // Иначе короткие живые ответы («ок)», «ага)», «поняла)») затираются зря.
  if (before === text) return before;

  if (text.length < 8) {
    if (/(программ|figma|photoshop|дизайн|работ|примеры|портфолио)/i.test(textIn)) {
      return 'в основном в figma и photoshop)';
    }
    if (/(работаешь|не работаешь|чем занима|кем работа)/i.test(textIn)) {
      return 'работаю, самозанятая) дизайном в основном';
    }
    if (/(прилета|числах|когда\s+ты|куда\s+ты)/i.test(textIn)) {
      return 'пока точных дат нет, ближе к переезду скажу)';
    }
    return 'ага)';
  }
  return text;
}

const BOT_DEFENSE_OPENER_RE =
  /^обидно,?\s*если\s+честно[^.!?\n]*[.!)]*\s*/i;
const BOT_DEFENSE_ALIVE_RE =
  /я\s+жив(ая|ой)[^.!?\n]*[.!)]*/gi;
const BOT_DEFENSE_COMFORT_RE =
  /(просто\s+обща(юсь|емся)\s+так|мы\s+просто\s+обща(емся|емся)|не\s+переживай|вс[её]\s+нормально|не\s+волнуйся|давай\s+просто\s+общать)[^.!?\n]*[.!)]*/gi;
const BOT_ACCUSATION_USER_RE =
  /(ты\s+бот|это\s+бот|бот\s+ли\s+ты|какой[- ]?то\s+бот|как\s+бот|как\s+робот|обща(ешьс|ешс)я\s+как\s+(бот|робот)|кажется[^.!?\n]{0,40}бот|похоже[^.!?\n]{0,30}бот|как\s+будто[^.!?\n]{0,20}бот|отвечаешь[^.!?\n]{0,30}бот|(снова|опять)\s+кажется|мне\s+снова\s+кажется|нейросеть|chatgpt|gpt[- ]?\d|ты\s+не\s+человек|you('?re|\s+are)\s+a?\s*bot|are\s+you\s+a?\s*bot)/i;

const BOT_ACCUSATION_FIRST_RU = [
  'хах ну ты серьёзно)',
  'странно звучит)',
  'да ладно тебе)',
  'ну ок)',
  'хах)',
];
const BOT_ACCUSATION_AGAIN_RU = [
  'хах опять)',
  'ну ты зациклился)',
  'ладно верь)',
  'окей)',
  'ну как скажешь)',
];
const BOT_ACCUSATION_FIRST_EN = [
  'lol u serious?',
  'weird take)',
  'nah)',
  'ok then)',
];
const BOT_ACCUSATION_AGAIN_EN = [
  'lol again?',
  'ok believe what u want)',
  'sure)',
];

/**
 * На «ты бот» / «кажется бот» — живая короткая реакция, не саппорт-утешение.
 */
function humanizeBotAccusationReply(reply, history, userMessage) {
  if (!reply) return reply;
  if (!BOT_ACCUSATION_USER_RE.test(String(userMessage || ''))) {
    return stripRepeatedBotDefense(reply, history, userMessage);
  }

  const recentAssistant = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-4)
    .map((h) => String(h.content || ''))
    .join('\n');
  const alreadyDefended =
    /(обидно|я\s+жив|не\s+бот|не\s+ии|похоже\s+на|с\s+чего\s+ты\s+взял|хах\s+(ну\s+ты|опять)|зациклил|ладно\s+верь|странно\s+звучит|не\s+переживай|вс[её]\s+нормально)/i.test(
      recentAssistant,
    );

  let text = String(reply)
    .replace(BOT_DEFENSE_OPENER_RE, '')
    .replace(BOT_DEFENSE_ALIVE_RE, ' ')
    .replace(BOT_DEFENSE_COMFORT_RE, ' ')
    .replace(/не\s+подтверждаю[^.!?\n]*[.!)]*/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([).!])/g, '$1')
    .trim();

  const stillSoft =
    !text ||
    text.length < 4 ||
    /(вс[её]\s+нормально|не\s+переживай|просто\s+обща|я\s+жив|обидно|мы\s+просто)/i.test(text) ||
    /\?/.test(text);

  const isEn =
    /[a-z]{3,}/i.test(String(userMessage || '')) && !/[а-яё]{3,}/i.test(String(userMessage || ''));
  const bank = alreadyDefended
    ? isEn
      ? BOT_ACCUSATION_AGAIN_EN
      : BOT_ACCUSATION_AGAIN_RU
    : isEn
      ? BOT_ACCUSATION_FIRST_EN
      : BOT_ACCUSATION_FIRST_RU;

  if (stillSoft || Math.random() < 0.55) {
    return bank[Math.floor(Math.random() * bank.length)];
  }
  text = text
    .replace(/\s*[.!]?\s*(?:а\s+)?(?:ты|вам|what|why|how)[^?]*\?\s*$/i, '')
    .replace(/\s*\?\s*$/g, '')
    .trim();
  return text.length >= 3 ? text : bank[Math.floor(Math.random() * bank.length)];
}

/**
 * Не даёт дважды подряд гнать шаблон «обидно, если честно / я живая».
 */
function stripRepeatedBotDefense(reply, history, userMessage) {
  if (!reply) return reply;
  const recentAssistant = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-4)
    .map((h) => String(h.content || ''))
    .join('\n');
  const usedOpener = /обидно,?\s*если\s+честно/i.test(recentAssistant);
  const usedAlive = /я\s+жив(ая|ой)/i.test(recentAssistant);
  if (!usedOpener && !usedAlive) return reply;

  let text = String(reply);
  if (usedOpener) text = text.replace(BOT_DEFENSE_OPENER_RE, '');
  if (usedAlive) {
    text = text
      .replace(BOT_DEFENSE_ALIVE_RE, ' ')
      .replace(BOT_DEFENSE_COMFORT_RE, ' ');
  }
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([).!])/g, '$1').trim();

  if (text.length >= 8) return text;

  const msg = String(userMessage || '');
  if (/(как\s+меня\s+зовут|мо[её]\s+имя|имени\s+не)/i.test(msg)) {
    return 'хах ну да)';
  }
  return 'ну ок)';
}

/**
 * Достаёт имя персонажа из промпта аккаунта.
 */
function extractCharacterName(prompt) {
  const p = String(prompt || '');
  const patterns = [
    /тебя зовут\s+([А-ЯЁA-Z][а-яёa-zA-Z]{1,20})/i,
    /меня зовут\s+([А-ЯЁA-Z][а-яёa-zA-Z]{1,20})/i,
    /зовут\s+([А-ЯЁA-Z][а-яёa-zA-Z]{1,20})/i,
    /имя[:\s]+([А-ЯЁA-Z][а-яёa-zA-Z]{1,20})/i,
    /ты\s*[—\-–]\s*([А-ЯЁA-Z][а-яёa-zA-Z]{1,20})\b/i,
  ];
  for (const re of patterns) {
    const m = p.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

const NAME_DEFERRAL_RE =
  /^(конечно,?\s*)?(спрашивай|валяй|давай|задавай|слушай|ок|ага|угу)\s*\)?\s*$/i;

/**
 * Если спросили её имя, а модель ответила «спрашивай)» — подставляем имя из промпта.
 */
function fixIgnoredNameQuestion(reply, userMessage, prompt) {
  const askHer =
    /(как\s+(тебя|вас)\s+зовут|как\s+зовут\s+тебя|а\s+тебя\s+как\s+зовут|тво[её]\s+имя|what'?s\s+your\s+name)/i.test(
      String(userMessage || ''),
    );
  if (!askHer) return reply;

  const name = extractCharacterName(prompt);
  const text = String(reply || '').trim();
  const hasName = name && new RegExp(name, 'i').test(text);
  const isDeferral = !text || NAME_DEFERRAL_RE.test(text) || /спрашивай|валяй|задавай вопрос/i.test(text);

  if (hasName && !isDeferral) return reply;
  if (name) return `${name.toLowerCase()})`;
  return text && !isDeferral ? text : 'саша)';
}

const MEET_AGREE_RE =
  /(?:^|[.!\s)])\s*(?:скоро\s+)?увидимся[^.!?\n]*[.!)]*/gi;
const MEET_AGREE_EXTRA_RE =
  /(?:жду\s+тебя\s+тоже|тоже\s+жду|приеду\s+(?:к\s+тебе|скоро)|давай\s+встретимся|встретимся\s+скоро|обязательно\s+увидимся)[^.!?\n]*[.!)]*/gi;

/**
 * Срезает согласие на звонок/«по видео». Если модель ответила «ага)» —
 * подменяем на отказ из‑за стеснения.
 */
const CALL_AGREE_SHORT_RE =
  /^(?:ага|угу|да|ок|окей|okay|ok|давай|конечно|хорошо|го|ладно|можно|yes|sure|yep|yeah)(?:\s*[)!.]*)?$/i;
const CALL_AGREE_PHRASE_RE =
  /(?:давай\s+созвон|давай\s+по\s+видео|давай\s+звон|звони\b|набери\b|созвонимся|могу\s+по\s+видео|сейчас\s+позвон|вот\s+(?:мой\s+)?номер|facetime|zoom\.us)/i;

const CALL_REFUSALS_RU = [
  'ой я на видео стесняюсь, давай лучше тут)',
  'не люблю созваниваться, давай текстом)',
  'на звонках мне неловко, давай тут)',
];
const CALL_REFUSALS_EN = [
  'im shy on video, text is better)',
  'dont really do calls, lets keep chatting here)',
];

function pickCallRefusal(userMessage) {
  const en = /\b(call|video|facetime|zoom)\b/i.test(String(userMessage || ''));
  const bank = en ? CALL_REFUSALS_EN : CALL_REFUSALS_RU;
  return bank[Math.floor(Math.random() * bank.length)];
}

function stripVideoCallAgreement(reply, userMessage, options = {}) {
  if (!reply) return reply;
  const { isVideoCallRequest } = require('./objectionHandler');
  const textIn = String(userMessage || '');
  const hint = String(options.objectionHint || '');
  const isCall =
    isVideoCallRequest(textIn) || /предлагает звонок|по видео|созвон/i.test(hint);
  if (!isCall) return reply;

  const before = String(reply).trim();
  let text = before
    .replace(CALL_AGREE_PHRASE_RE, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([).!])/g, '$1')
    .trim();

  if (CALL_AGREE_SHORT_RE.test(before) || CALL_AGREE_SHORT_RE.test(text) || text.length < 6) {
    return pickCallRefusal(textIn);
  }

  // Согласие спрятано в длинном ответе («ага давай»: / «ок, звони»)
  if (
    /(?:^|[.!\s])(?:ага|угу|давай|ок|окей|конечно|хорошо)\b/i.test(before) &&
    /(?:звон|видео|созвон|call)/i.test(before)
  ) {
    return pickCallRefusal(textIn);
  }

  if (before !== text && text.length >= 8) return text;
  return before;
}

/**
 * Срезает согласие на личную встречу («скоро увидимся»), даже если хинт
 * не сработал (например «жду тебя краса» без слова «встреча»).
 */
function stripMeetAgreement(reply, userMessage, options = {}) {
  if (!reply) return reply;
  const before = String(reply);
  let text = before
    .replace(MEET_AGREE_RE, ' ')
    .replace(MEET_AGREE_EXTRA_RE, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([).!])/g, '$1')
    .trim();

  if (before === text) return before;

  if (text.length >= 8) return text;

  const hint = String(options.objectionHint || '');
  const waiting =
    /жду\s+тебя|ждём\s+тебя|встрет|увидим/i.test(String(userMessage || '')) ||
    /зовёт встретиться|жду тебя/i.test(hint);
  if (waiting) {
    return 'спасибо) мне тоже приятно, но с переездом пока только тут)';
  }
  return text.length >= 3 ? text : 'ага)';
}

/**
 * Если последние ответы ассистента уже заканчивались вопросом — срезаем
 * хвостовой вопрос. Зеркальные «а ты откуда / чем занимаешься» режем всегда.
 */
function stripHabitualTrailingQuestion(reply, history, userMessage) {
  if (!reply) return reply;
  const userText = String(userMessage || '');
  const userQ =
    /\?/.test(userText) ||
    /(что|как|где|когда|почему|зачем|кто|какой|какая|какие|whom|what|why|how|where)\b/i.test(userText);

  const recent = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-3)
    .map((h) => String(h.content || ''));
  const recentHadQ = recent.filter((t) => /\?/.test(t)).length >= 1;

  let text = String(reply).trim();

  const mirrorTail =
    /\s*[.,!]?\s*(?:а\s+)?ты\s+(?:откуда|где|чем\s+занима|кем\s+работа|как\s+там|что\s+делаешь|из\s+какого)[^?]*\?\s*$/i;
  const softMirror =
    /\s*[.,!]?\s*(?:а\s+ты\??|а\s+у\s+тебя\??|and\s+you\??|what\s+about\s+you\??)\s*$/i;

  if (mirrorTail.test(text) || softMirror.test(text)) {
    text = text.replace(mirrorTail, '').replace(softMirror, '').trim();
    if (text.length >= 3) return text;
    return userQ ? 'ага' : 'ага)';
  }

  if (!recentHadQ && Math.random() < 0.18) return reply;

  const stripped = text
    .replace(
      /\s*[.!]?\s*(?:а\s+)?(?:ты|вам|тебе|какие?|что|как|где|когда|почему|зачем|who|what|why|how|where)[^?]*\?\s*$/i,
      '',
    )
    .replace(/\s*\?[) ]*$/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (stripped.length >= 3) return stripped;
  if (!userQ) return 'ага)';
  return text;
}

/**
 * Не в каждом сообщении «)» — иначе выглядит как шаблон.
 */
function varyTrailingSmile(reply, history) {
  if (!reply) return reply;
  let text = String(reply).trim();
  if (!/\)+\s*$/.test(text)) return text;

  const recent = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-3)
    .map((h) => String(h.content || '').trim());
  const recentParens = recent.filter((t) => /\)+\s*$/.test(t)).length;

  if (recentParens >= 2 && Math.random() < 0.7) {
    text = text.replace(/\)+\s*$/, '').trim();
    return text.length >= 2 ? text : reply;
  }
  if (recentParens >= 1 && Math.random() < 0.4) {
    text = text.replace(/\)+\s*$/, '').trim();
    return text.length >= 2 ? text : reply;
  }
  if (/\)\s*$/.test(text) && !/\)\)\s*$/.test(text) && Math.random() < 0.12) {
    return `${text})`;
  }
  return text;
}

/** Жёсткий потолок длины на случай, если модель всё же размазала текст. */
function clipOverlongReply(reply) {
  if (!reply) return reply;
  let text = String(reply).trim();
  // Сохраняем токены медиа/реакций
  const tokens = [];
  text = text.replace(/<<[^>\n]+>>/g, (m) => {
    tokens.push(m);
    return `\u0000TOK${tokens.length - 1}\u0000`;
  });
  // Больше ~140 символов живого текста — оставляем первое предложение/фразу
  if (text.replace(/\u0000TOK\d+\u0000/g, '').length > 140) {
    const cut = text.split(/(?<=[)\n])\s+/).filter(Boolean);
    if (cut.length > 1) text = cut[0];
    else text = text.slice(0, 140).replace(/\s+\S*$/, '').trim();
  }
  // Списки через перевод строки — склеиваем в одну фразу / берём первую строку
  if (/\n/.test(text)) {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) text = lines[0];
  }
  text = text.replace(/\u0000TOK(\d+)\u0000/g, (_, i) => tokens[Number(i)] || '');
  return text.trim();
}

/**
 * Анти-детект стиль: убирает восклицательные знаки и точки в конце сообщения
 * (живая переписка в мессенджере обычно без них — точка в конце фразы часто
 * читается как «сухо/раздражённо», а обилие «!» типично для ИИ-генерации).
 * Также срезает россыпь эмодзи — оставляем живой текст со скобкой «)».
 * Применяется всегда, независимо от настроения/времени суток/промпта.
 */
function applyAntiDetectStyle(text) {
  if (!text) return text;
  // Токены <<REACT:😂>> / <<LAUGH>> / <<PHOTO>> не трогаем — эмодзи внутри них нужны.
  const tokens = [];
  let result = String(text).replace(/<<[^>\n]+>>/g, (m) => {
    tokens.push(m);
    return `\u0000TOK${tokens.length - 1}\u0000`;
  });
  result = result.replace(/!+/g, '');
  // Длинное тире (—) и среднее (–) — типичный след ИИ; в переписке обычно дефис или запятая.
  result = result
    .replace(/\u2014/g, '-') // —
    .replace(/\u2013/g, '-') // –
    .replace(/\u2212/g, '-') // minus sign
    .replace(/\s+-\s+/g, ' - ')
    .replace(/-{2,}/g, '-');
  // Турецкие ı/İ иногда проскакивают в «английском» — чиним в латиницу.
  result = result.replace(/\u0131/g, 'i').replace(/\u0130/g, 'I');
  try {
    result = result.replace(/\p{Extended_Pictographic}/gu, '');
  } catch (_) {
    // ignore
  }
  result = result.replace(/[\uFE0F\u200D]/g, '');
  result = result.replace(/[ \t]{2,}/g, ' ').trim();
  result = result.trimEnd();
  while (result.endsWith('.') && !result.endsWith('..')) {
    result = result.slice(0, -1).trimEnd();
  }
  result = result.replace(/\u0000TOK(\d+)\u0000/g, (_, i) => tokens[Number(i)] || '');
  return result;
}

/**
 * Расшифровывает голосовое сообщение в текст через OpenAI Whisper.
 *
 * @param {Buffer} buffer - аудио (обычно ogg/opus из Telegram)
 * @param {string} filename - имя файла с расширением (напр. "voice.ogg")
 * @returns {Promise<string>} распознанный текст (или пустая строка)
 */
async function transcribeAudio(buffer, filename = 'voice.ogg') {
  try {
    const file = await toFile(buffer, filename);
    const result = await mediaClient.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      // Без language — Whisper сам определяет ru/en.
    });
    return (result.text || '').trim();
  } catch (err) {
    console.error('Ошибка транскрипции голосового:', err.message);
    return '';
  }
}

/**
 * Описывает содержимое фотографии/стикера через GPT-4o (vision).
 * Описание всегда на русском — служебный текст для модели, не речь собеседника.
 * Язык ответа бота выбирается отдельно по истории диалога.
 */
async function describeImage(buffer, caption = '') {
  try {
    const base64 = buffer.toString('base64');
    // Стикеры Telegram часто webp — правильный MIME повышает шанс OCR текста.
    const isWebp =
      Buffer.isBuffer(buffer) &&
      buffer.length > 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50;
    const mime = isWebp ? 'image/webp' : 'image/jpeg';

    const completion = await mediaClient.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Опиши коротко и по делу, что изображено на этом фото или стикере ' +
                '(на русском). Если есть люди — опиши их и обстановку. ' +
                'ОБЯЗАТЕЛЬНО прочитай и процитируй любой текст на картинке ' +
                '(например «ЗДРАСТИ», «привет», надписи на одежде) — это важно.' +
                (caption ? ` Подпись/эмодзи: "${caption}".` : ''),
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${base64}` },
            },
          ],
        },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('Ошибка распознавания фото:', err.message);
    return '';
  }
}

Object.assign(module.exports, {
  generateReply,
  transcribeAudio,
  describeImage,
  detectReplyLanguage,
  isRussianConversation,
});
