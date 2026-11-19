'use strict';

/**
 * Сверка входящего фото с аватарками аккаунта (Telegram profile photos).
 * Нужно, чтобы на «вот твоя фотка» + своя аватарка отвечать «да, это я», а не отнекиваться.
 */
const crypto = require('crypto');
const { Api } = require('telegram');

const OWN_AVATAR_TAG = '[совпало с моей аватаркой]';

/** accountId -> { at, ids:Set<string>, hashes:Set<string> } */
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function messageHasOwnAvatarTag(text) {
  return /совпало\s+с\s+моей\s+аватарк/i.test(String(text || ''));
}

function extractIncomingPhotoId(message) {
  try {
    const photo = message?.media?.photo || message?.photo;
    if (photo && photo.id != null) return String(photo.id);
  } catch (_) {}
  return null;
}

function captionClaimsHerPhoto(caption) {
  return /(?:реальн\w*\s+)?тво[еёя]\s+фот|это\s+ты\s+(?:на\s+)?фот|вот\s+эт[ао]\s+.{0,24}фот|это\s+ты\s*\??|узна[её]шь\s+себ|тво[яё]\s+аватар/i.test(
    String(caption || ''),
  );
}

async function loadOwnAvatarFingerprints(client, accountId) {
  const key = String(accountId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const ids = new Set();
  const hashes = new Set();
  const buffers = [];
  try {
    const me = await client.getMe();
    const res = await client.invoke(
      new Api.photos.GetUserPhotos({
        userId: me,
        offset: 0,
        maxId: 0,
        limit: 8,
      }),
    );
    const photos = res?.photos || [];
    for (const photo of photos) {
      if (photo?.id != null) ids.add(String(photo.id));
      try {
        const buf = await client.downloadMedia(photo, {});
        if (buf && buf.length) {
          hashes.add(sha256(buf));
          if (buffers.length < 3) buffers.push(buf);
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn(
      `[avatarMatch] GetUserPhotos fail account=${accountId}:`,
      err?.message || err,
    );
  }

  const entry = { at: Date.now(), ids, hashes, buffers };
  cache.set(key, entry);
  return entry;
}

/**
 * @param {{ caption?: string }} [opts]
 * @returns {Promise<boolean>}
 */
async function matchesOwnAccountAvatar(client, accountId, incomingBuffer, message, opts = {}) {
  if (!client || !accountId) return false;
  const fp = await loadOwnAvatarFingerprints(client, accountId);
  const photoId = extractIncomingPhotoId(message);
  if (photoId && fp.ids.has(photoId)) return true;
  if (incomingBuffer && incomingBuffer.length) {
    const h = sha256(incomingBuffer);
    if (fp.hashes.has(h)) return true;
  }
  // Пережатая/пересланная аватарка: id/hash часто не совпадают — vision только
  // когда он прямо пишет «твоя фотка / это ты».
  const caption = opts.caption || message?.message || '';
  if (captionClaimsHerPhoto(caption) && incomingBuffer?.length && fp.buffers?.length) {
    try {
      const { samePersonAsProfilePhotos } = require('./aiResponder');
      if (typeof samePersonAsProfilePhotos === 'function') {
        return Boolean(await samePersonAsProfilePhotos(incomingBuffer, fp.buffers));
      }
    } catch (err) {
      console.warn('[avatarMatch] vision compare:', err?.message || err);
    }
  }
  return false;
}

function clearAvatarMatchCache(accountId) {
  if (accountId == null) cache.clear();
  else cache.delete(String(accountId));
}

module.exports = {
  OWN_AVATAR_TAG,
  messageHasOwnAvatarTag,
  captionClaimsHerPhoto,
  matchesOwnAccountAvatar,
  clearAvatarMatchCache,
  // test helpers
  _cache: cache,
  sha256,
};
