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
  video: ['вот записала на днях'],
  circle: [''],
};

function loadCaptions() {
  try {
    const raw = fs.readFileSync(CAPTIONS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      photo: Array.isArray(parsed.photo) ? parsed.photo : FALLBACK_CAPTIONS.photo,
      video: Array.isArray(parsed.video) ? parsed.video : FALLBACK_CAPTIONS.video,
      circle: Array.isArray(parsed.circle) ? parsed.circle : FALLBACK_CAPTIONS.circle,
    };
  } catch (_) {
    return FALLBACK_CAPTIONS;
  }
}

/**
 * Случайная подпись под медиа заданного типа ('photo' | 'video' | 'circle').
 * Возвращает строку или '' если подписей нет.
 */
function pickCaption(type) {
  const captions = loadCaptions();
  const list = captions[type] || [];
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
 * собеседнику (по множеству sentIds). Если всё уже отправлено — разрешаем
 * повтор (берём из полного набора). Возвращает item или null.
 */
function pickUnsentMedia(items, type, sentIds) {
  const ofType = items.filter((i) => i.type === type);
  if (ofType.length === 0) return null;
  let pool = ofType.filter((i) => !sentIds.has(i.id));
  if (pool.length === 0) pool = ofType;
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

function tokenizeMediaContext(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]+/gi, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !MEDIA_STOP_WORDS.has(w));
}

/**
 * Оценка совпадения описания медиа с текстом диалога (чем выше — тем ближе по смыслу).
 */
function scoreMediaAgainstContext(desc, contextTokens) {
  if (!desc || !contextTokens.length) return 0;
  const descTokens = new Set(tokenizeMediaContext(desc));
  if (!descTokens.size) return 0;
  let score = 0;
  for (const t of contextTokens) {
    if (descTokens.has(t)) score += 2;
    else {
      for (const d of descTokens) {
        if (d.length >= 4 && t.length >= 4 && (d.startsWith(t.slice(0, 4)) || t.startsWith(d.slice(0, 4)))) {
          score += 1;
          break;
        }
      }
    }
  }
  return score;
}

/**
 * Выбирает медиа нужного типа с учётом смысла переписки.
 * descriptions: Map/object ключ id → описание кадра.
 * contextText: последнее сообщение + кусок истории.
 */
function pickMediaByContext(items, type, sentIds, descriptions, contextText) {
  const ofType = items.filter((i) => i.type === type);
  if (!ofType.length) return null;
  let pool = ofType.filter((i) => !sentIds.has(i.id));
  if (!pool.length) pool = ofType;

  const tokens = tokenizeMediaContext(contextText);
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
  if (best.score > 0) {
    const top = scored.filter((s) => s.score >= best.score - 1).slice(0, 3);
    return top[Math.floor(Math.random() * top.length)].item;
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
};
