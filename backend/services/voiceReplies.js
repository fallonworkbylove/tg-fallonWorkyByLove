const fs = require('fs');
const path = require('path');
const { Api } = require('telegram');

// Папка с голосовыми заготовками (.ogg) и файлом конфигурации триггеров.
const VOICES_DIR = path.join(__dirname, '..', 'voices');
const CONFIG_PATH = path.join(VOICES_DIR, 'triggers.json');

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
function loadTriggers() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return [];

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    // Оставляем только валидные правила. Правило должно иметь либо голосовой
    // файл (file), либо текстовый ответ (text).
    return parsed.filter(
      (rule) =>
        rule &&
        Array.isArray(rule.keywords) &&
        rule.keywords.length > 0 &&
        ((typeof rule.file === 'string' && rule.file.trim()) ||
          (typeof rule.text === 'string' && rule.text.trim())),
    );
  } catch (err) {
    console.error('Ошибка чтения voices/triggers.json:', err.message);
    return [];
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

/**
 * Подбирает голосовую заготовку под входящий текст.
 * Возвращает объект { filePath, fileName, voiceOnly } или null, если совпадений нет.
 *
 * Правила проверяются по порядку — срабатывает первое подходящее.
 */
function findVoiceForText(text) {
  if (!text || !text.trim()) return null;

  const normalized = text.toLowerCase();
  const rules = loadTriggers();

  for (const rule of rules) {
    // Голосовые правила — только те, у которых есть файл.
    if (typeof rule.file !== 'string' || !rule.file.trim()) continue;

    const matched = rule.keywords.some(
      (kw) => typeof kw === 'string' && matchesWholeWord(normalized, kw),
    );

    if (!matched) continue;

    const filePath = path.join(VOICES_DIR, rule.file);

    // Файл должен реально существовать, иначе пропускаем правило.
    if (fs.existsSync(filePath)) {
      return { filePath, fileName: rule.file, voiceOnly: rule.voiceOnly === true };
    }

    console.error(
      `Голосовая заготовка "${rule.file}" указана в triggers.json, но файл не найден в папке voices/.`,
    );
  }

  return null;
}

/**
 * Подбирает ФИКСИРОВАННЫЙ текстовый ответ под входящий текст.
 * Возвращает строку-ответ или null, если совпадений нет.
 *
 * Учитываются только правила с полем "text" (без "file").
 * Правила проверяются по порядку — срабатывает первое подходящее.
 */
function findTextReplyForText(text) {
  if (!text || !text.trim()) return null;

  const normalized = text.toLowerCase();
  const rules = loadTriggers();

  for (const rule of rules) {
    // Текстовые правила — только те, у которых есть text (и нет file).
    if (typeof rule.text !== 'string' || !rule.text.trim()) continue;
    if (typeof rule.file === 'string' && rule.file.trim()) continue;

    const matched = rule.keywords.some(
      (kw) => typeof kw === 'string' && matchesWholeWord(normalized, kw),
    );

    if (matched) return rule.text.trim();
  }

  return null;
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

module.exports = {
  findVoiceForText,
  findTextReplyForText,
  sendVoiceReply,
  VOICES_DIR,
};
