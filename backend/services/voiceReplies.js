const fs = require('fs');
const path = require('path');
const { Api } = require('telegram');

// Папка с голосовыми заготовками (.ogg) и файлом конфигурации триггеров.
const VOICES_DIR = path.join(__dirname, '..', 'voices');
const CONFIG_PATH = path.join(VOICES_DIR, 'triggers.json');
const warnedMissingVoices = new Set();

/**
 * Читает конфигурацию триггеров из voices/triggers.json.
 *
 * Формат файла (массив правил):
 * [
 *   { "keywords": ["привет", "хай"], "file": "voprosy.ogg", "voiceOnly": false },
 *   { "keywords": ["пока"], "file": "poka.ogg", "voiceOnly": true }
 * ]
 *
 * Каждое правило: если в тексте собеседника встретится ЛЮБОЕ из keywords,
 * будет отправлена голосовая заготовка `file` из папки voices/.
 *
 * voiceOnly:
 *   false (по умолчанию) — AI отвечает текстом И следом уходит голосовое.
 *   true  — отправляется ТОЛЬКО голосовое, без текстового ответа AI.
 *
 * Конфиг читается заново при каждом сообщении — можно менять triggers.json
 * без перезапуска сервера.
 */
/** Кеш triggers.json по mtime — без перезапуска при правке файла. */
let triggersCache = { mtimeMs: 0, rules: [] };

function loadTriggers() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      triggersCache = { mtimeMs: 0, rules: [] };
      return [];
    }
    const st = fs.statSync(CONFIG_PATH);
    if (triggersCache.rules.length && st.mtimeMs === triggersCache.mtimeMs) {
      return triggersCache.rules;
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      triggersCache = { mtimeMs: st.mtimeMs, rules: [] };
      return [];
    }

    // Оставляем только валидные правила. Правило должно иметь либо голосовой
    // файл (file), либо текстовый ответ (text).
    const rules = parsed.filter(
      (rule) =>
        rule &&
        Array.isArray(rule.keywords) &&
        rule.keywords.length > 0 &&
        ((typeof rule.file === 'string' && rule.file.trim()) ||
          (typeof rule.text === 'string' && rule.text.trim())),
    );
    triggersCache = { mtimeMs: st.mtimeMs, rules };
    return rules;
  } catch (err) {
    console.error('Ошибка чтения voices/triggers.json:', err.message);
    return triggersCache.rules || [];
  }
}

/**
 * Экранирует спецсимволы регулярного выражения в строке.
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Проверяет, встречается ли ключевое слово/фраза в тексте как ЦЕЛОЕ СЛОВО
 * (а не как часть другого слова). Нужно, чтобы триггер "сво" срабатывал
 * только на само «сво», но НЕ на «свой», «свобода», «пароль» и т.п.
 *
 * Границей слова считается начало/конец строки или любой символ, не
 * являющийся буквой (кириллица/латиница) или цифрой. Работает и для
 * многословных фраз («я на сво»), т.к. пробелы внутри keyword сохраняются.
 */
function matchesWholeWord(normalizedText, keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const boundary = '[^a-zа-яё0-9]';
  const pattern = new RegExp(
    `(^|${boundary})${escapeRegExp(kw)}(${boundary}|$)`,
    'iu',
  );
  return pattern.test(normalizedText);
}

/** Самое длинное keyword из правила, совпавшее с текстом (null если нет). */
function longestMatchedKeyword(normalizedText, keywords) {
  let best = null;
  for (const kw of keywords || []) {
    if (typeof kw !== 'string' || !kw.trim()) continue;
    if (!matchesWholeWord(normalizedText, kw)) continue;
    if (!best || kw.length > best.length) best = kw;
  }
  return best;
}

/**
 * Цитаты reply (`[ответ на «…»]: …`) не должны триггерить голосовые:
 * иначе на «Ты второй девушка уже» + цитата её флип-пича уходит flipping.ogg.
 */
function textForVoiceMatch(text) {
  return String(text || '')
    .replace(
      /\[(?:уточнение к твоей фразе|ответ на(?:\s+его\s+сообщение)?|ответ на твою фразу|Ответ на сообщение(?:\s+собеседника)?)[^\]]*\]:?\s*/gi,
      ' ',
    )
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();
}

/** Скепсис / «вы все одинаковые» — не слать предложку-флип. */
const FLIP_VOICE_HOSTILE_RE =
  /втор(ая|ой)\s+девушк|уже\s+втор|такая\s+же|такие\s+же|одинаков|копипаст|все\s+вы|вы\s+все|скрипт|нейросет|ты\s+бот|наёб|развод|скам|обман/i;

/**
 * «Про флипинг ты же в первый день говорила)» — упрёк в повторе, НЕ вопрос «что такое флип».
 * Иначе уходит flipping.ogg как будто он спросил про NFT.
 */
const FLIP_VOICE_REPEAT_CALLOUT_RE =
  /(?:ты\s+же|уже)\s+(?:ещ[её]\s+)?(?:в\s+первый\s+день\s+)?(?:ещ[её]\s+)?говор|(?:в\s+)?первый\s+день\s+(?:ещ[её]\s+)?говор|опять\s+(?:про\s+)?флип|снова\s+(?:про\s+)?флип|уже\s+(?:это\s+)?(?:говор|писал|сказ)|повтор(?:яешь|яла|ила)?\s+(?:про\s+)?флип/i;

/** Голое слово «флипинг» без вопроса — не повод слать explain-voice. */
const FLIP_WORD_ONLY_KW_RE =
  /^(?:флип+инг\w*|flipping|fliping|флиппер|флипер)$/i;

const FLIP_ASK_INTENT_RE =
  /что\s+(?:такое|за|значит)|как\s+(?:ты\s+)?(?:этим\s+)?зарабатыв|расскажи|в\s+смысле|как\s+это\s+работа|перепрода|шеф\s+по\s+флип|покупаешь\s+и\s+продаешь/i;

/**
 * Подбирает голосовую заготовку под входящий текст.
 * Возвращает объект { filePath, fileName, voiceOnly } или null, если совпадений нет.
 *
 * Берём правило с самым длинным совпавшим keyword — иначе «привет» перебивает «я на сво».
 */
function findVoiceForText(text) {
  if (!text || !text.trim()) return null;

  const normalized = textForVoiceMatch(text);
  if (!normalized) return null;
  // Must #41/#65: скепсис «вторая такая / бот» — никаких голосовых заготовок.
  if (FLIP_VOICE_HOSTILE_RE.test(normalized)) return null;
  const rules = loadTriggers();
  let best = null;
  let bestLen = -1;

  for (const rule of rules) {
    if (typeof rule.file !== 'string' || !rule.file.trim()) continue;

    const matchedKw = longestMatchedKeyword(normalized, rule.keywords);
    if (!matchedKw) continue;
    // «что за флип судьбы» — идиома, не про NFT-флип.
    if (
      rule.file === 'flipping.ogg' &&
      /флип\s+судьб|судьб\w*\s+флип|flip\s+of\s+(?:fate|destiny)/i.test(normalized)
    ) {
      continue;
    }
    // Упрёк «ты же уже говорила про флип» — не explain-voice.
    if (rule.file === 'flipping.ogg' && FLIP_VOICE_REPEAT_CALLOUT_RE.test(normalized)) {
      continue;
    }
    // Голое «флипинг» в болтовне без вопроса — не explain.
    if (
      rule.file === 'flipping.ogg' &&
      FLIP_WORD_ONLY_KW_RE.test(matchedKw) &&
      !FLIP_ASK_INTENT_RE.test(normalized)
    ) {
      continue;
    }
    // «как ты этим зарабатываешь» без флип/NFT-контекста — обычная работа.
    if (
      rule.file === 'flipping.ogg' &&
      /зарабатыва/i.test(matchedKw) &&
      !/(флип|nft|нфт|токен|перепродаж|цифр)/i.test(normalized)
    ) {
      continue;
    }
    // «добрый день рождения» ≠ приветствие.
    if (
      rule.file === 'voprosy.ogg' &&
      /день\s+рожден/i.test(normalized)
    ) {
      continue;
    }

    const filePath = path.join(VOICES_DIR, rule.file);
    if (!fs.existsSync(filePath)) {
      if (!warnedMissingVoices.has(rule.file)) {
        warnedMissingVoices.add(rule.file);
        console.error(
          `Голосовая заготовка "${rule.file}" указана в triggers.json, но файл не найден в папке voices/.`,
        );
      }
      continue;
    }

    if (matchedKw.length > bestLen) {
      bestLen = matchedKw.length;
      best = { filePath, fileName: rule.file, voiceOnly: rule.voiceOnly === true };
    }
  }

  return best;
}

/**
 * Подбирает ФИКСИРОВАННЫЙ текстовый ответ под входящий текст.
 * Возвращает строку-ответ или null, если совпадений нет.
 *
 * Учитываются только правила с полем "text" (без "file").
 * Самое длинное совпадение keyword побеждает.
 */
function findTextReplyForText(text) {
  if (!text || !text.trim()) return null;

  const normalized = textForVoiceMatch(text);
  if (!normalized) return null;
  // Скепсис — не подменять AI фиксированным текстом из triggers.
  if (FLIP_VOICE_HOSTILE_RE.test(normalized)) return null;
  const rules = loadTriggers();
  let best = null;
  let bestLen = -1;

  for (const rule of rules) {
    if (typeof rule.text !== 'string' || !rule.text.trim()) continue;
    if (typeof rule.file === 'string' && rule.file.trim()) continue;

    const matchedKw = longestMatchedKeyword(normalized, rule.keywords);
    if (!matchedKw) continue;
    if (matchedKw.length > bestLen) {
      bestLen = matchedKw.length;
      best = rule.text.trim();
    }
  }

  return best;
}

/**
 * Отправляет голосовое сообщение (voice note) собеседнику.
 *
 * Telegram показывает файл как «кружок-голосовое» только если это OGG/Opus
 * и передан атрибут voice=true. GramJS выставляет его через voiceNote: true.
 */
async function sendVoiceReply(client, peer, filePath) {
  await client.sendFile(peer, {
    file: filePath,
    voiceNote: true,
  });
}

/** voprosy.ogg = «как день проходит» — не дублировать тем же текстом рядом/после ГС. */
const VOPROSY_DAY_ASK_RE =
  /(?:^|[.!?…)]\s*|,\s*)(?:давай\s*[),]?\s*)?(?:ну\s+)?(?:а\s+ты\s+)?(?:как(?:ой)?\s+(?:у\s+тебя\s+)?день(?:чик)?(?:\s+проходит)?|как\s+проходит\s+(?:твой\s+)?день|чем\s+(?:день\s+)?скрашиваешь|как\s+дела(?:\s+у\s+тебя)?)\s*[?)!]?\s*$/i;

const VOPROSY_FILE = 'voprosy.ogg';

function historyHasRecentVoprosy(history, maxLookback = 12) {
  const hist = Array.isArray(history) ? history : [];
  let n = 0;
  for (let i = hist.length - 1; i >= 0 && n < maxLookback; i -= 1) {
    const m = hist[i];
    if (!m || m.role !== 'assistant') continue;
    n += 1;
    if (/\[голосовое:\s*voprosy\.ogg\]/i.test(String(m.content || ''))) return true;
  }
  return false;
}

/**
 * Убрать вопрос «как день проходит» из текста, если сейчас/недавно уходит voprosy.ogg.
 * @returns {string} текст или '' если остался голый вопрос.
 */
function stripDayAskDupWithVoprosy(reply, { voiceFileName = null, history = null } = {}) {
  const file = String(voiceFileName || '');
  const pending = file === VOPROSY_FILE || file.endsWith(`/${VOPROSY_FILE}`);
  const recent = historyHasRecentVoprosy(history);
  if (!pending && !recent) return reply;
  if (!reply) return reply;

  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  let body = String(reply).slice(tag.length).trim();
  if (!body) return reply;

  // Целиком один вопрос про день → пусто (ГС уже спросит).
  if (
    /^(?:давай\s*[),]?\s*)?(?:ну\s+)?(?:а\s+ты\s+)?(?:как(?:ой)?\s+(?:у\s+тебя\s+)?день(?:чик)?(?:\s+проходит)?|как\s+проходит\s+(?:твой\s+)?день|чем\s+(?:день\s+)?скрашиваешь|как\s+дела(?:\s+у\s+тебя)?)\s*[?)!]?\s*$/i.test(
      body,
    )
  ) {
    return tag ? tag.trim() : '';
  }

  // Хвост «… как день проходит?»
  const next = body.replace(VOPROSY_DAY_ASK_RE, '').replace(/\s{2,}/g, ' ').trim();
  if (!next) return tag ? tag.trim() : '';
  // «давай)» один — ок; «давай) как день» уже срезали
  let cleaned = next.replace(/[,;\s]+$/g, '').trim();
  if (cleaned && !/[)….!?]$/.test(cleaned)) cleaned += ')';
  return tag + cleaned;
}

/** Просьба ГС (не входящая метка «[Голосовое]: …»). */
const VOICE_ASK_RE =
  /(?:расскаж\w*|скаж\w*|скинь|пришли|запиш\w*|давай|можно|хочу).{0,24}(?:голосов|голосом|(?<![а-яёa-z0-9])гс(?![а-яёa-z0-9]))|(?:голосов(?:ое|ым|ой)|голосом|(?<![а-яёa-z0-9])гс(?![а-яёa-z0-9])).{0,24}(?:расскаж|за\s+жизнь|про\s+себя|о\s+себе)|(?:^|\s)за\s+жизнь\s*$/i;
const VOICE_PROMISE_RE =
  /(?:сейчас|щас|ща|ок(?:ей)?|окей)[,\s]*(?:я\s+)?запиш\w*|запишу\s+(?:что|тебе|голос|сейчас|что[- ]то)|сейчас\s+(?:надиктую|наговорю|начитаю|что[- ]то\s+интересн)/i;
const VOICE_SOFT_REFUSE = [
  'хах я стесняюсь голосом) давай лучше так',
  'оой не, я лучше текстом) так спокойнее',
  'не буду голос, я вечно не то скажу) давай тут',
  'хах ну не) голосом не могу, а писать люблю',
];

function stripLeakedVoiceTag(text) {
  return String(text || '')
    .replace(/\[\s*голосовое\s*:[^\]]*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isIncomingVoiceLabel(userMessage) {
  return /^\s*\[(?:одноразовое\s+)?голосов/i.test(String(userMessage || ''));
}

/**
 * Просил ГС, файла нет — нельзя обещать «сейчас запишу» / слать метку [голосовое:].
 */
function softVoiceAskWithoutFile(reply, userMessage, { voiceWillSend = false } = {}) {
  let out = stripLeakedVoiceTag(reply);
  if (voiceWillSend) return out;
  if (isIncomingVoiceLabel(userMessage)) return out;
  const u = String(userMessage || '');
  if (!VOICE_ASK_RE.test(u) && !VOICE_PROMISE_RE.test(String(reply || ''))) return out;
  if (!VOICE_ASK_RE.test(u)) return out;
  if (!VOICE_PROMISE_RE.test(out) && out) return out;
  return VOICE_SOFT_REFUSE[Math.floor(Math.random() * VOICE_SOFT_REFUSE.length)];
}

module.exports = {
  findVoiceForText,
  findTextReplyForText,
  textForVoiceMatch,
  FLIP_VOICE_HOSTILE_RE,
  sendVoiceReply,
  stripDayAskDupWithVoprosy,
  historyHasRecentVoprosy,
  stripLeakedVoiceTag,
  softVoiceAskWithoutFile,
  isIncomingVoiceLabel,
  VOICE_ASK_RE,
  VOPROSY_FILE,
  VOICES_DIR,
};
