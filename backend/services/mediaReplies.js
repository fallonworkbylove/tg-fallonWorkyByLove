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
const FETCH_LIMIT = 200;

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
  circle: ['вот занимаюсь делами)'],
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
  // Убираем возможный хвост вида «/123» (ссылка на сообщение).
  s = s.split(/[/?#]/)[0];
  return s;
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

/**
 * Отправляет медиа собеседнику как своё (через sendFile по ссылке на файл —
 * без плашки «переслано»). Для кружка выставляет videoNote.
 */
async function sendMediaItem(client, peer, item, caption) {
  const opts = { file: item.msg.media };
  if (caption) opts.caption = caption;
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
  sendMediaItem,
  pickCaption,
  mediaTag,
  clearMediaCache,
  classifyMedia,
  resolveMediaChat,
};
