const OpenAI = require('openai');
const { toFile } = require('openai');

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

// Модель для чата (ответы). Задаётся через .env: OPENAI_MODEL=gpt-4o.
// Значение читается один раз при старте процесса и не меняется во время
// работы бота — чтобы переключить модель, поменяй .env и перезапусти pm2.
// Если переменная не задана вовсе — используется gpt-4o по умолчанию.
const CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

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
  'Ты — живой человек, который непринуждённо общается в личных сообщениях. ' +
  'Отвечай МАКСИМУМ в 2 коротких предложениях, естественно и по-дружески на русском языке. ' +
  'Никогда не пиши больше 2 предложений. ' +
  'Не упоминай, что ты искусственный интеллект.';

/**
 * Генерирует ответ через OpenAI.
 *
 * @param {string} systemPrompt - промпт аккаунта (стиль общения)
 * @param {Array<{role: 'user'|'assistant', content: string}>} history - прошлые сообщения (по порядку)
 * @param {string} userMessage - новое сообщение собеседника
 * @returns {Promise<string>} сгенерированный ответ
 */
async function generateReply(systemPrompt, history, userMessage, options = {}) {
  const finalPrompt = systemPrompt?.trim() || DEFAULT_PROMPT;

  // Reminder намеренно МИНИМАЛЬНЫЙ: он НЕ навязывает свои правила (длину,
  // вопросы и т.п.), чтобы не перебивать промпт из панели — все стилевые
  // требования (длина, точки, вопросы, эмодзи) задаются ТОЛЬКО в промпте.
  // Здесь оставляем лишь защиту от «выхода из роли» и признания, что это ИИ.
  const roleReminder =
    'Строго следуй инструкции персонажа выше и всем её правилам. ' +
    'Никогда не признавайся, что ты ИИ, бот или программа, и не выходи из роли.';

  // Защита от повторов: без явного запрета лёгкая модель регулярно
  // переспрашивает то же самое (например «что делаешь?») спустя пару
  // сообщений, потому что не сверяет новый ответ с историей выше. Явно
  // просим её сначала проверить историю диалога.
  const noRepeatReminder =
    'ВАЖНО: перед тем как ответить, посмотри на историю диалога выше. ' +
    'НЕ задавай вопрос и НЕ поднимай тему, которую ты уже задавала/поднимала ' +
    'в этом диалоге раньше (даже если сформулировать его немного другими ' +
    'словами) — собеседник это заметит и это выглядит странно. Если нужно ' +
    'что-то спросить, выбери новую тему, которой в истории выше ещё не было, ' +
    'или продолжи уже начатую тему, а не начинай её с начала.';

  // Определение настроения: перед ответом модель сама (без отдельного
  // запроса к API) считывает эмоциональный тон последнего сообщения
  // собеседника и мягко подстраивает стиль ответа — без явного
  // проговаривания анал��за в самом тексте ответа.
  const moodReminder =
    'Перед тем как ответить, определи эмоциональный настрой последнего сообщения ' +
    'собеседника (грустит, злится, радуется, шутит, устал, нейтрален и т.п.) и слегка ' +
    'подстрой тон ответа под это настроение: если человек расстроен или грустит — ответь ' +
    'мягче и с большей заботой; если злится или раздражён — ответь спокойно, без сарказма; ' +
    'если шутит или в хорошем настроении — можно ответить легче и с юмором. ' +
    'НЕ проговаривай сам анализ настроения в ответе (не пиши «вижу, что ты грустишь» или ' +
    'подобные фразы, если это не естественно вписывается в разговор) — просто подстрой тон.';

  // Жёсткое напоминание про длину. Ставим его ОТДЕЛЬНО от roleReminder и
  // ближе к концу списка сообщений (сразу перед новым сообщением
  // пользователя), потому что gpt-4o-mini заметно лучше следует инструкциям,
  // которые находятся ближе к концу контекста — на длинной истории (20-30
  // сообщений) правило длины, сказанное только в самом начале, размывается.
  const lengthReminder =
    'Формат ответа: СТРОГО не более 2 коротких предложений. Обычно достаточно ' +
    '1 предложения. Пиши коротко, как в реальной переписке в мессенджере — ' +
    'без длинных объяснений, списков и уточнений. Это правило важнее желания ' +
    'рассказать подробнее. ' +
    'ВАЖНО: не более ОДНОГО вопроса за всё сообщение. Если хочешь сначала ' +
    'отреагировать на слова собеседника (коротким комментарием), а потом ' +
    'спросить что-то — оставь только один из двух вопросов, а не два подряд. ' +
    'Часто лучше вообще без вопроса — просто живая реакция, как в реальной переписке ' +
    'человек не задаёт вопрос в каждом сообщении.';

  const messages = [
    { role: 'system', content: finalPrompt },
    { role: 'system', content: roleReminder },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];

  // Обучение на прошлом опыте (без fine-tuning): если telegramClient передал
  // готовый текстовый блок с лучшими фразами из bot_patterns — подмешиваем
  // его как ещё одну системную подсказку. См. services/learningDb.js.
  if (options.learningSnippet) {
    messages.push({ role: 'system', content: options.learningSnippet });
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
        'Если собеседник просит скинуть/показать фото, фотку, себя, как ты выглядишь — ' +
        'добавь в ответ токен <<PHOTO>>. Если просит видео — токен <<VIDEO>>. ' +
        'Если просит кружок/видеосообщение — токен <<CIRCLE>>. ' +
        'ВАЖНО: если ты решила прислать медиа и вставила токен — текст в этом же сообщении ' +
        'НЕ должен быть отказом или отговоркой. Никаких «п��ка ��ано», «не могу», «рано», «попозже», ' +
        '«не кидаю» вместе с токеном. Отправляешь — значит соглашаешься: пиши дружелюбно и коротко ' +
        '(«ща», «щас», «окей держи», «ну лови») или вообще без текста, только токен. ' +
        'Отнекивание («пока рано», «я не кидаю незнакомым») используй ТОЛЬКО когда просят твои контакты ' +
        '(номер, телеграм, инсту) — и тогда токен НЕ вставляй. ' +
        'Не описывай, что на фото, словами (ты не знаешь, что именно там). ' +
        'ОЧЕНЬ ВАЖНО: не отправляй медиа два ра��а подряд. Если ты только что уже прислала ' +
        'фото/видео/кружок, а собеседник просто спрашивает про него или продолжает разговор ' +
        '(например «а куда едешь?», «а что там?», «красиво») — отвечай обычным текстом и НЕ вставляй ' +
        'новый токен. Новый токен вставляй только если человек СНОВА явно просит прислать ещё. ' +
        'Максимум ОДИН токен за сообщение. Если про фото/видео речи нет — токены не вставляй.',
    });
  }

  // lengthReminder идёт последним перед сообщением пользователя — самая
  // "сильная" позиция в контексте для модели.
  messages.push({ role: 'system', content: lengthReminder });
  messages.push({ role: 'user', content: userMessage });

  // [v0] ВРЕМЕННЫЙ ЛОГ: печатает реально используемую модель и endpoint.
  console.log(
    `[v0] Запрос к модели: "${CHAT_MODEL}" | baseURL: ${process.env.OPENAI_BASE_URL || 'api.openai.com (по умолчанию)'}`,
  );

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    // Технический потолок длины: даже если модель проигнорирует текстовое
    // правило про 1-2 предложения, ответ физически не может растянуться в
    // длинный текст. ~120 токенов хватает на 2 нормальных русских
    // предложения с запасом.
    max_tokens: 120,
    temperature: 0.7,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
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
      language: 'ru',
    });
    return (result.text || '').trim();
  } catch (err) {
    console.error('Ошибка транскрипции голосового:', err.message);
    return '';
  }
}

/**
 * Описывает содержимое фотографии через GPT-4o (vision).
 * Возвращает короткое описание на русском, чтобы AI мог отреагировать.
 *
 * @param {Buffer} buffer - изображение (jpeg/png)
 * @param {string} caption - подпись к фото, если есть
 * @returns {Promise<string>} оп��сание изображения (или пустая строка)
 */
async function describeImage(buffer, caption = '') {
  try {
    const base64 = buffer.toString('base64');
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
                'Опиши коротко и по делу, что изображено на этом фото ' +
                '(на русском). Если есть люди — опиши их и обстановку.' +
                (caption ? ` Подпись к фото: "${caption}".` : ''),
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64}` },
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

module.exports = { generateReply, transcribeAudio, describeImage };
