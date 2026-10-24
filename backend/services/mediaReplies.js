const fs = require('fs');
const path = require('path');
const { Api } = require('telegram');

// ---------------------------------------------------------------------------
// МЕДИА-ОТВЕТЫ: фото / видео / кружки из Telegram-чата по ссылке.
//
// Идея: у каждого аккаунта в настройках можно указать ссылку на Telegram-чат
// (приватный канал/группу), куда заранее залиты фото, видео и кружки. Когда
// собеседник просит показать фото/видео (это решает сам ИИ через служебные
// токены), бот берёт СЛУЧАЙНОЕ ещё не отправленное этому человеку медиа
// нужного типа и присылает его со случайной подписью — как своё, без плашки
// «переслано».
//
// Аккаунт-userbot ДОЛЖЕН состоять в этом чате: для приватной ссылки (t.me/+...)
// вступаем через ImportChatInvite, для публичной — через JoinChannel.
// ---------------------------------------------------------------------------

// Сколько последних сообщений медиа-чата просматривать.
const FETCH_LIMIT = 300;

// Сколько держать кэш медиа-чата (чтобы не дёргать историю на каждое сообщение).
const CACHE_TTL_MS = 10 * 60 * 1000;

// Кэш по ключу `${accountId}:${link}` -> { at, entity, items: [{id, type, msg}] }
const mediaCache = new Map();

// ---------------------------------------------------------------------------
// ПОДПИСИ
// ---------------------------------------------------------------------------

const CAPTIONS_PATH = path.join(__dirname, '..', 'media', 'captions.json');

// Запасные подписи на случай, если файл конфига недоступен/повреждён.
const FALLBACK_CAPTIONS = {
  photo: ['это недавно)', 'вот я сегодня'],
  photo_en: ['here', 'this is me', 'for you'],
  video: ['вот записала на днях'],
  video_en: ['here', 'caught this'],
  circle: [''],
  circle_en: [''],
};

function loadCaptions() {
  try {
    const raw = fs.readFileSync(CAPTIONS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      photo: Array.isArray(parsed.photo) ? parsed.photo : FALLBACK_CAPTIONS.photo,
      photo_en: Array.isArray(parsed.photo_en) ? parsed.photo_en : FALLBACK_CAPTIONS.photo_en,
      video: Array.isArray(parsed.video) ? parsed.video : FALLBACK_CAPTIONS.video,
      video_en: Array.isArray(parsed.video_en) ? parsed.video_en : FALLBACK_CAPTIONS.video_en,
      circle: Array.isArray(parsed.circle) ? parsed.circle : FALLBACK_CAPTIONS.circle,
      circle_en: Array.isArray(parsed.circle_en) ? parsed.circle_en : FALLBACK_CAPTIONS.circle_en,
    };
  } catch (_) {
    return FALLBACK_CAPTIONS;
  }
}

/**
 * Случайная подпись под медиа ('photo' | 'video' | 'circle').
 * lang: 'ru' | 'en' — в EN без русских фраз и без скобок-улыбок.
 */
function pickCaption(type, lang = 'ru') {
  const captions = loadCaptions();
  const key = lang === 'en' ? `${type}_en` : type;
  const list = captions[key] || captions[type] || [];
  if (list.length === 0) return '';
  return list[Math.floor(Math.random() * list.length)];
}

// ---------------------------------------------------------------------------
// РАЗБОР ССЫЛКИ И ВСТУПЛЕНИЕ В ЧАТ
// ---------------------------------------------------------------------------

/**
 * Извлекает hash приватной пригласительной ссылки (t.me/+hash или
 * t.me/joinchat/hash). Возвращает hash или null, если это не invite-ссылка.
 */
function parseInviteHash(link) {
  const m = String(link).match(
    /(?:t\.me\/|telegram\.me\/)(?:joinchat\/|\+)([\w-]+)/i,
  );
  if (m) return m[1];
  // Голый вид «+hash».
  const bare = String(link).trim().match(/^\+([\w-]+)$/);
  return bare ? bare[1] : null;
}

/**
 * Приводит публичную ссылку/@username к чистому username.
 */
function parseUsername(link) {
  let s = String(link).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^(?:t\.me\/|telegram\.me\/)/i, '');
  s = s.replace(/^@/, '');
  // Ссылки вида t.me/channel/123 и t.me/c/123/456 указывают на канал,
  // а не на username. Для /c/ Telegram API ожидает внутренний peer id.
  const parts = s.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === 'c' && /^\d+$/.test(parts[1] || '')) {
    return `-100${parts[1]}`;
  }

  // Убираем возможный хвост вида «/123» (ссылка на сообщение).
  return parts[0] || '' ;
}

/**
 * Возвращает entity медиа-чата, при необходимости вступая в него.
 * Бросает ошибку, если чат недоступен.
 */
async function resolveMediaChat(client, link) {
  const raw = String(link).trim();

  // Приватная пригласительная ссылка.
  const inviteHash = parseInviteHash(raw);
  if (inviteHash) {
    // Сначала проверяем — вдруг уже участник (тогда сразу получим сам чат).
    try {
      const checked = await client.invoke(
        new Api.messages.CheckChatInvite({ hash: inviteHash }),
      );
      if (checked.chat) return checked.chat;
    } catch (_) {
      // не критично, пробуем вступить ниже
    }
    // Вступаем.
    try {
      const res = await client.invoke(
        new Api.messages.ImportChatInvite({ hash: inviteHash }),
      );
      if (res.chats && res.chats[0]) return res.chats[0];
    } catch (e) {
      if (!String(e.message || '').includes('USER_ALREADY_PARTICIPANT')) {
        throw e;
      }
      // Уже участник — ещё раз запрашиваем сам чат.
      const checked = await client.invoke(
        new Api.messages.CheckChatInvite({ hash: inviteHash }),
      );
      if (checked.chat) return checked.chat;
    }
    throw new Error('Не удалось получить чат по приватной ссылке');
  }

  // Публичная ссылка / @username.
  const username = parseUsername(raw);
  if (!username) throw new Error('Пустая или некорректная ссылка на медиа-чат');
  const entity = await client.getEntity(username);
  // Пытаемся вступить (для приватного чтения истории). Ошибки игнорируем —
  // в публичный канал читать историю можно и без вступления.
  try {
    await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
  } catch (_) {
    // уже участник или обычная группа — не критично
  }
  return entity;
}

// ---------------------------------------------------------------------------
// ЗАГРУЗКА И КЛАССИФИКАЦИЯ МЕДИА
// ---------------------------------------------------------------------------

/**
 * Определяет тип медиа сообщения: 'circle' | 'photo' | 'video' | null.
 * ВАЖНО: кружок (video note) проверяем ПЕРВЫМ, т.к. он тоже является видео.
 */
function classifyMedia(msg) {
  try {
    if (msg.videoNote) return 'circle';
    if (msg.photo) return 'photo';
    if (msg.video) return 'video';
  } catch (_) {
    // некоторые сообщения могут кидать при доступе к геттеру — пропускаем
  }
  return null;
}

/**
 * Возвращает (с кэшем) запись о медиа-чате аккаунта:
 * { at, entity, items: [{ id, type, msg }] }.
 */
async function getMediaItems(client, accountId, link) {
  const key = `${accountId}:${link}`;
  const cached = mediaCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const entity = await resolveMediaChat(client, link);
  const messages = await client.getMessages(entity, { limit: FETCH_LIMIT });

  const items = [];
  for (const msg of messages) {
    const type = classifyMedia(msg);
    if (type) items.push({ id: msg.id, type, msg });
  }

  const record = { at: Date.now(), entity, items };
  mediaCache.set(key, record);
  return record;
}

/** Сбрасывает кэш медиа-чата (например, при устаревшей ссылке на файл). */
function clearMediaCache(accountId, link) {
  mediaCache.delete(`${accountId}:${link}`);
}

// ---------------------------------------------------------------------------
// ВЫБОР И ОТПРАВКА
// ---------------------------------------------------------------------------

/**
 * Выбирает случайное медиа нужного типа, которого ещё НЕ отправляли этому
 * собеседнику (по множеству sentIds).
 * allowRepeat=true (фото/видео): если всё уже уходило — берём снова из полного набора.
 * allowRepeat=false (кружки): повтор одному человеку запрещён → null.
 */
function pickUnsentMedia(items, type, sentIds, descriptions, { allowRepeat = true } = {}) {
  const ofType = filterPersonMediaItems(
    items.filter((i) => i.type === type),
    descriptions,
  );
  if (ofType.length === 0) return null;
  let pool = ofType.filter((i) => !sentIds.has(i.id));
  if (pool.length === 0) {
    if (!allowRepeat) return null;
    pool = ofType;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

const MEDIA_STOP_WORDS = new Set([
  'и', 'в', 'во', 'на', 'с', 'со', 'к', 'ко', 'у', 'о', 'об', 'от', 'по', 'за', 'из', 'для',
  'это', 'эта', 'этот', 'эти', 'как', 'что', 'чем', 'кто', 'где', 'когда', 'то', 'так', 'же',
  'бы', 'ли', 'не', 'ни', 'да', 'нет', 'ну', 'ой', 'ага', 'вот', 'там', 'тут', 'уже', 'ещё',
  'еще', 'мне', 'меня', 'тебе', 'тебя', 'мой', 'моя', 'твой', 'твоя', 'она', 'он', 'они',
  'мы', 'вы', 'я', 'ты', 'просто', 'очень', 'сейчас', 'щас', 'пока', 'будет', 'было',
  'есть', 'была', 'были', 'сам', 'сама', 'своё', 'свое', 'свой', 'свои',
]);

/**
 * Тематические корзины: слова из просьбы/темы → маркеры, которые обычно
 * встречаются в описаниях кадров (own_media_desc). Без этого «ты высокая?»
 * почти никогда не матчится на фото в полный рост / в зале.
 */
const MEDIA_TOPIC_BAGS = [
  {
    keys: ['высока', 'высокий', 'высоки', 'низка', 'низкий', 'рост', 'tall', 'height', 'short'],
    expand: ['рост', 'высокая', 'полный', 'ноги', 'зеркало', 'фигура', 'стоя', 'длинн', 'полн'],
  },
  {
    keys: ['зал', 'спорт', 'тренир', 'качал', 'фитнес', 'gym', 'workout', 'fitness', 'box'],
    expand: ['спортзал', 'зал', 'тренировка', 'спорт', 'гантел', 'бокс', 'фитнес', 'груш', 'качал'],
  },
  {
    keys: ['волос', 'блондин', 'брюнет', 'шатен', 'рыж', 'причес', 'причёс', 'hair', 'blonde', 'brunette'],
    expand: ['волос', 'прическ', 'причёск', 'селфи', 'голова', 'локон'],
  },
  {
    keys: ['глаз', 'взгляд', 'eyes', 'eye'],
    expand: ['глаз', 'взгляд', 'селфи', 'лицо', 'макияж'],
  },
  {
    keys: ['лиц', 'селфи', 'face', 'selfie', 'смайл', 'улыб'],
    expand: ['лицо', 'селфи', 'близк', 'улыб', 'зеркало'],
  },
  {
    keys: ['фигур', 'форм', 'тело', 'ноги', 'попа', 'грудь', 'бедра', 'body', 'shape', 'legs', 'ass', 'physique'],
    expand: ['фигура', 'тело', 'ноги', 'зеркало', 'полный', 'рост', 'форма'],
  },
  {
    keys: ['машин', 'авто', 'машинк', 'car', 'drive', 'wheel'],
    expand: ['машин', 'авто', 'салон', 'руль', 'еду'],
  },
  {
    keys: ['еда', 'кофе', 'кафе', 'кухн', 'завтрак', 'ужин', 'food', 'coffee', 'cafe', 'cook'],
    expand: ['еда', 'кофе', 'кафе', 'кухн', 'завтрак', 'десерт'],
  },
  {
    keys: ['дом', 'кроват', 'диван', 'комнат', 'home', 'bed', 'sofa'],
    expand: ['дом', 'кроват', 'диван', 'комнат', 'уют'],
  },
  {
    keys: ['улиц', 'город', 'прогул', 'парк', 'street', 'city', 'walk', 'outdoor'],
    expand: ['улиц', 'город', 'прогул', 'парк', 'на улице'],
  },
  {
    keys: ['вечер', 'ноч', 'клуб', 'тусов', 'night', 'club', 'party'],
    expand: ['вечер', 'ноч', 'клуб', 'тусов', 'огни'],
  },
  {
    keys: ['работ', 'офис', 'ноут', 'work', 'office', 'laptop'],
    expand: ['работ', 'офис', 'ноут', 'стол', 'дела'],
  },
];

function tokenizeMediaContext(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]+/gi, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !MEDIA_STOP_WORDS.has(w));
}

/** Добавляет синонимы/маркеры темы к токенам контекста. */
function expandMediaContextTokens(tokens) {
  const out = new Set(tokens);
  const joined = tokens.join(' ');
  for (const bag of MEDIA_TOPIC_BAGS) {
    const hit = bag.keys.some(
      (k) => tokens.some((t) => t.startsWith(k) || k.startsWith(t)) || joined.includes(k),
    );
    if (!hit) continue;
    for (const e of bag.expand) out.add(e.toLowerCase().replace(/ё/g, 'е'));
  }
  return [...out];
}

/**
 * Кадр «как я» — на фото должна быть девушка, а не кинозал/перчатки/интерьер.
 * Пустое описание не режем (ещё не разметили); явный объект без человека — режем.
 */
function looksLikePersonMedia(desc) {
  const d = String(desc || '').trim();
  if (!d) return true;
  if (/^без\s+меня\s*:/i.test(d)) return false;
  const person =
    /(^|[.:\s])(я|мне)\b|селфи|сижу|стою|лежу|иду|гуляю|улыба|волос|лиц[оаеу]|девушк|платье|худи|куртк|майк[аеу]?\b|топ[еу]?\b|футболк|купальн|ног[аиуе]|руками|облокотив|обняв|позир|в\s+зеркал|на\s+кроват|на\s+диван|selfie|\bface\b|my\s+hair/i;
  const objectHeavy =
    /кинотеатр|кожаных\s+кресл|боксерск[а-яё]*\s+перчат|перчатк[а-яё]*|гантел|снаряд|груш[аеи]|пустой\s+зал|только\s+(зал|кресл|интерьер)|без\s+(меня|лиц)|игрушк|плюшев|мишка\b|медвед[яеу]?\b|открытк|упаковк[а-яё]*\s+и\s+открыт/i;
  if (objectHeavy.test(d) && !person.test(d)) return false;
  if (/^постановочное\s*:/i.test(d) && !person.test(d) && /(зал|кресл|комнат|интерьер|фон)/i.test(d)) {
    return false;
  }
  // «рядом с перчатками» без селфи/лица — часто просто куча снарядов без неё.
  if (/перчатк/i.test(d) && !/(селфи|зеркал|лиц|волос|платье|худи|футболк|майк)/i.test(d)) {
    return false;
  }
  return true;
}

/** Оставляет только кадры «с ней»; если описаний ещё нет — пул как есть. */
function filterPersonMediaItems(items, descriptions) {
  if (!Array.isArray(items) || !items.length) return items || [];
  const descMap = descriptions || {};
  const kept = items.filter((i) => {
    const desc = descMap[i.id] || descMap[String(i.id)] || '';
    return looksLikePersonMedia(desc);
  });
  return kept.length ? kept : items.filter((i) => {
    const desc = descMap[i.id] || descMap[String(i.id)] || '';
    return !desc; // только ещё не размеченные — лучше пустой слот, чем кинозал
  });
}

/**
 * Оценка совпадения описания медиа с текстом диалога (чем выше — тем ближе по смыслу).
 */
function scoreMediaAgainstContext(desc, contextTokens) {
  if (!desc || !contextTokens.length) return 0;
  if (!looksLikePersonMedia(desc)) return -100;
  const descTokens = new Set(tokenizeMediaContext(desc));
  if (!descTokens.size) return 0;
  // Описание тоже расширяем по корзинам — «спортзал» ↔ «зал».
  const descExpanded = new Set(expandMediaContextTokens([...descTokens]));
  let score = 0;
  for (const t of contextTokens) {
    if (descTokens.has(t) || descExpanded.has(t)) {
      score += descTokens.has(t) ? 3 : 2;
      continue;
    }
    for (const d of descExpanded) {
      if (d.length >= 4 && t.length >= 4 && (d.startsWith(t.slice(0, 4)) || t.startsWith(d.slice(0, 4)))) {
        score += 1;
        break;
      }
    }
  }
  return score;
}

/**
 * Выбирает медиа нужного типа с учётом смысла переписки.
 * descriptions: Map/object ключ id → описание кадра.
 * contextText: последнее сообщение + кусок истории.
 * allowRepeat=false — не брать уже отправленные этому peer id (для кружков).
 */
function pickMediaByContext(
  items,
  type,
  sentIds,
  descriptions,
  contextText,
  { allowRepeat = true } = {},
) {
  const ofType = filterPersonMediaItems(
    items.filter((i) => i.type === type),
    descriptions,
  );
  if (!ofType.length) return null;
  let pool = ofType.filter((i) => !sentIds.has(i.id));
  if (!pool.length) {
    if (!allowRepeat) return null;
    pool = ofType;
  }

  const tokens = expandMediaContextTokens(tokenizeMediaContext(contextText));
  if (!tokens.length || !descriptions) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const scored = pool.map((item) => {
    const desc = descriptions[item.id] || descriptions[String(item.id)] || '';
    return { item, score: scoreMediaAgainstContext(desc, tokens), desc };
  });
  scored.sort((a, b) => b.score - a.score || Math.random() - 0.5);

  const best = scored[0];
  // Есть хоть какое-то совпадение — берём из топ-3 по смыслу.
  if (best && best.score > 0) {
    const top = scored.filter((s) => s.score >= best.score - 1 && s.score > 0).slice(0, 3);
    const chosen = top[Math.floor(Math.random() * top.length)];
    return chosen.item;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Отправляет медиа собеседнику как своё (через sendFile по ссылке на файл —
 * без плашки «переслано»). Для кружка выставляет videoNote.
 */
async function sendMediaItem(client, peer, item, caption) {
  if (!item?.msg?.media) {
    throw new Error(`Медиа-сообщение #${item?.id || 'unknown'} больше недоступно`);
  }

  const opts = { file: item.msg.media };
  // У кружков (video note) подпись выглядит странно (текст рядом с кружком) —
  // шлём только сам кружок, без caption.
  if (caption && item.type !== 'circle') opts.caption = caption;
  if (item.type === 'circle') opts.videoNote = true;
  await client.sendFile(peer, opts);
}

/**
 * Метка для истории (дедуп): по ней понимаем, какое медиа уже отправляли
 * собеседнику. Одна ссылка на чат у аккаунта => id уникально идентифицирует.
 */
function mediaTag(id) {
  return `[медиа:#${id}]`;
}

module.exports = {
  getMediaItems,
  pickUnsentMedia,
  pickMediaByContext,
  sendMediaItem,
  pickCaption,
  mediaTag,
  clearMediaCache,
  classifyMedia,
  resolveMediaChat,
  tokenizeMediaContext,
  expandMediaContextTokens,
  looksLikePersonMedia,
  filterPersonMediaItems,
};
