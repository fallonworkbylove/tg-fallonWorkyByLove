/**
 * Пиры: архив, blacklist, unreachable, dead dialogs, read receipts.
 * NFT side-effects при retire — через configurePeers({ onPeerRetired }).
 */
const { Api } = require('telegram');
const db = require('../db');
const helpRequestNotifier = require('./helpRequestNotifier');
const { accountLabel, findAccountIdByClient, accountKey, getActiveClient } = require('./clientPool');
const { sleep } = require('./timing');

const PERMANENT_SEND_ERROR_CODES = [
  'CHAT_WRITE_FORBIDDEN',
  'USER_IS_BLOCKED',
  'USER_BANNED_IN_CHANNEL',
  'PEER_ID_INVALID',
  'USER_PRIVACY_RESTRICTED',
  'INPUT_USER_DEACTIVATED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
];

const ARCHIVE_FLAGS_TTL_MS = 3 * 60 * 1000;
const archiveFlagsCache = new WeakMap();

const OUR_ONLY_WORK_RE = /проблем[а-яё]*\s+с\s+работ|ау,\s*ты\s*жив|ч[её]\s*молчиш|ты\s*пропал/i;
const strayArchiveFixInFlight = new Set();
const REARCHIVE_EVERY_MS = 30 * 60 * 1000;
const rearchiveLastRun = new Map();
const aliveDialogPeers = new Map();
/** accountId → untilTs: сессия с FROZEN_METHOD_INVALID — не дёргаем folders.* */
const folderFrozenUntil = new Map();
const FOLDER_FROZEN_TTL_MS = 6 * 60 * 60 * 1000;

function isFrozenMethodError(err) {
  const text = `${err?.errorMessage || ''} ${err?.message || ''} ${err?.code || ''}`;
  return /FROZEN_METHOD_INVALID|FROZEN_METHOD|ACCOUNT_FROZEN/i.test(text);
}

function markFolderFrozen(accountId, err) {
  if (accountId == null) return;
  const until = Date.now() + FOLDER_FROZEN_TTL_MS;
  folderFrozenUntil.set(String(accountId), until);
  console.warn(
    `[${accountLabel(accountId)}] folders.* заморожены на ${Math.round(FOLDER_FROZEN_TTL_MS / 3600000)}ч` +
      (err ? `: ${err.errorMessage || err.message || ''}` : ''),
  );
}

function isFolderFrozen(accountId) {
  if (accountId == null) return false;
  const until = folderFrozenUntil.get(String(accountId));
  if (!until) return false;
  if (Date.now() >= until) {
    folderFrozenUntil.delete(String(accountId));
    return false;
  }
  return true;
}

let hooks = {
  onPeerRetired: null,
};

function configurePeers(next) {
  hooks = { ...hooks, ...next };
}

async function isPeerBlacklisted(accountId, peerId) {
  try {
    const [rows] = await db.execute(
      `SELECT b.id
       FROM blacklist b
       INNER JOIN accounts a ON a.user_id = b.user_id
       WHERE a.id = ? AND CAST(b.user_telegram_id AS CHAR) = ?
       LIMIT 1`,
      [accountId, String(peerId)],
    );
    return rows.length > 0;
  } catch (err) {
    console.error(`[${accountLabel(accountId)}] Не удалось проверить blacklist:`, err.message);
    // Fail-closed: при ошибке БД считаем в ЧС — не отвечаем.
    return true;
  }
}

async function isPeerArchived(client, inputPeer) {
  try {
    const peer = await client.getInputEntity(inputPeer);
    const result = await client.invoke(
      new Api.messages.GetPeerDialogs({
        peers: [new Api.InputDialogPeer({ peer })],
      }),
    );

    const dialog = result && result.dialogs && result.dialogs[0];
    if (!dialog) return false;
    if (dialog.className === 'DialogFolder') return false;
    if (dialog.archived === true) return true;
    return Number(dialog.folderId) === 1;
  } catch (err) {
    const code = String(err.errorMessage || err.message || '');
    console.warn(
      'Не удалось определить папку диалога — не отвечаю (fail-closed):',
      code,
    );
    return true;
  }
}

function isPermanentSendError(err) {
  const message = `${err && err.errorMessage ? err.errorMessage : ''} ${err && err.message ? err.message : ''}`;
  return PERMANENT_SEND_ERROR_CODES.some((code) => message.includes(code));
}

async function retireUnreachablePeer(client, accountId, peerId, entity, reason = 'unreachable') {
  const name =
    (entity && (entity.username || entity.firstName)) ||
    String(peerId);
  const why = String(reason || 'unreachable');

  if (client && entity) {
    try {
      await archivePeer(client, entity);
    } catch (err) {
      console.error(
        `[${accountLabel(accountId)}] Не удалось архивировать ${name} (${why}):`,
        err.errorMessage || err.message,
      );
    }
  }

  try {
    await helpRequestNotifier.disableAutoreplyForPeer(accountId, peerId, why);
  } catch (_) {}

  if (typeof hooks.onPeerRetired === 'function') {
    try {
      await hooks.onPeerRetired(accountId, peerId, why);
    } catch (_) {}
  }

  try {
    let signal = 'unreachable';
    if (/USER_IS_BLOCKED|blocked/i.test(why)) signal = 'blocked';
    else if (/DEACTIVATED|deleted/i.test(why)) signal = 'deactivated';
    else if (/PEER_ID_INVALID|CHAT_WRITE/i.test(why)) signal = 'dialog_gone';
    require('./churnLearn').noteDialogGone(accountId, peerId, signal);
  } catch (_) {
    /* best-effort */
  }

  console.log(
    `[${accountLabel(accountId)}] Диалог ${name} снят с рассылок (${why}).`,
  );
}

async function shouldSkipProactivePeer(client, entity) {
  if (!entity || entity.bot || entity.self || isDeletedUser(entity) || isNeverContact(entity)) {
    return true;
  }
  return isPeerArchived(client, entity);
}

function isNeverContact(entityOrUsername) {
  const raw = typeof entityOrUsername === 'string'
    ? entityOrUsername
    : entityOrUsername && entityOrUsername.username;
  const name = String(raw || '').replace(/^@/, '').trim().toLowerCase();
  return name === 'telegram';
}

function isDeletedUser(entity) {
  if (!entity) return false;
  if (entity.deleted || entity.className === 'UserEmpty') return true;
  const name = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim().toLowerCase();
  return name === 'deleted account' || name === 'удалённый аккаунт' || name === 'удаленный аккаунт';
}

function isServiceMessage(message) {
  return !!(message && (message.action || message.className === 'MessageService'));
}

async function isTriggerMessageAlive(client, peer, messageId) {
  if (!client || !peer || messageId == null) return true;
  const id = Number(messageId);
  if (!Number.isFinite(id) || id <= 0) return true;
  try {
    const rows = await client.getMessages(peer, { ids: [id] });
    const m = Array.isArray(rows) ? rows[0] : rows;
    if (!m) return false;
    const cls = String(m.className || '');
    if (cls === 'MessageEmpty' || cls === 'MessageService') return false;
    if (m.deleted) return false;
    if (!m.message && !m.media && !m.action) return false;
    return true;
  } catch (err) {
    const msg = `${err && err.errorMessage ? err.errorMessage : ''} ${err && err.message ? err.message : ''}`;
    if (/MESSAGE_ID_INVALID|PEER_ID_INVALID|CHAT_ID_INVALID|CHANNEL_PRIVATE|USER_IS_BLOCKED|INPUT_USER_DEACTIVATED/i.test(msg)) {
      return false;
    }
    return true;
  }
}

async function cancelReplyIfDialogGone(client, accountId, peer, senderName, message, where = '') {
  const msgId = message?.id != null ? Number(message.id) : null;
  const alive = await isTriggerMessageAlive(client, peer, msgId);
  if (alive) return false;
  console.log(
    `[${accountLabel(accountId)}] ${senderName}: диалог/сообщение удалены` +
      (where ? ` (${where})` : '') +
      ' — ответ не отправляю.',
  );
  try {
    const peerId =
      (peer && (peer.userId || peer.channelId || peer.chatId || peer.id)) ||
      (message && message.peerId && (message.peerId.userId || message.peerId));
    if (peerId != null) {
      require('./churnLearn').noteDialogGone(accountId, peerId, 'peer_deleted_msg');
    }
  } catch (_) {
    /* best-effort learn */
  }
  return true;
}

async function listUserDialogs(client, maxCount = 5000) {
  const dialogs = [];
  const pageSize = 100;
  let offsetId = 0;
  let offsetDate;
  let offsetPeer;

  for (let page = 0; page < Math.ceil(maxCount / pageSize); page += 1) {
    let batch;
    try {
      batch = await client.getDialogs({
        limit: pageSize,
        offsetId: offsetId || undefined,
        offsetDate,
        offsetPeer,
        ignorePinned: page > 0,
      });
    } catch (err) {
      if (!dialogs.length) throw err;
      return { dialogs, complete: false };
    }
    if (!batch?.length) return { dialogs, complete: true };

    dialogs.push(...batch);
    if (batch.length < pageSize) return { dialogs, complete: true };

    const last = batch[batch.length - 1];
    const nextId = last.message?.id || last.dialog?.topMessage || 0;
    const nextDate = last.message?.date || last.date;
    const nextPeer = last.inputEntity || last.entity;
    if (!nextId || nextId === offsetId) return { dialogs, complete: false };
    offsetId = nextId;
    offsetDate = nextDate;
    offsetPeer = nextPeer;
  }

  return { dialogs, complete: false };
}

function rememberArchiveFlags(dialogs, flags) {
  for (const dialog of dialogs) {
    if (!dialog.isUser || !dialog.entity || dialog.entity.bot || dialog.entity.self) continue;
    flags.set(String(dialog.entity.id), !!dialog.archived);
    flags.entities.set(String(dialog.entity.id), dialog.entity);
  }
}

async function loadArchiveFlags(client) {
  const cached = archiveFlagsCache.get(client);
  if (cached?.promise) return cached.promise;
  if (cached?.flags && Date.now() - cached.at < ARCHIVE_FLAGS_TTL_MS) return cached.flags;

  const promise = (async () => {
    const flags = new Map();
    flags.entities = new Map();
    const { dialogs, complete } = await listUserDialogs(client);
    rememberArchiveFlags(dialogs, flags);
    flags.complete = complete;
    flags.dialogs = dialogs;
    return flags;
  })();
  archiveFlagsCache.set(client, { ...cached, promise });
  try {
    const flags = await promise;
    archiveFlagsCache.set(client, { at: Date.now(), flags });
    return flags;
  } catch (err) {
    if (cached?.flags) archiveFlagsCache.set(client, { at: cached.at, flags: cached.flags });
    else archiveFlagsCache.delete(client);
    throw err;
  }
}

function markArchivedInCache(client, peer) {
  const flags = archiveFlagsCache.get(client)?.flags;
  const id = peer?.userId ?? peer?.id;
  if (flags && id != null) flags.set(String(id), true);
}

function isFloodError(err) {
  const text = String(err?.errorMessage || err?.message || '');
  return /FLOOD/i.test(text) || /A wait of \d+ seconds/i.test(text) || Number(err?.seconds) > 0;
}

function isHiddenFromReplies(flags, peerId) {
  const state = flags.get(String(peerId));
  if (state === true) return true;
  if (state === false) return false;
  if (flags && flags.complete === false) return false;
  return true;
}

async function markPeerAsRead(client, peer, message = null) {
  if (!client || !peer) return;
  try {
    if (await isPeerArchived(client, peer)) return;
  } catch (_) {
    return;
  }
  try {
    if (typeof client.markAsRead === 'function') {
      if (message) {
        await client.markAsRead(peer, message);
      } else {
        await client.markAsRead(peer);
      }
      return;
    }
    const inputPeer = await client.getInputEntity(peer);
    const maxId = message?.id ? Number(message.id) : 0;
    await client.invoke(
      new Api.messages.ReadHistory({
        peer: inputPeer,
        maxId,
      }),
    );
  } catch (err) {
    console.warn('[telegram] markAsRead failed:', err.errorMessage || err.message);
  }
}

async function peerHasIncoming(client, entity) {
  let offsetId = 0;
  for (let page = 0; page < 8; page += 1) {
    const messages = await client.getMessages(entity, {
      limit: 100,
      ...(offsetId ? { offsetId } : {}),
    });
    if (!messages?.length) return false;
    for (const message of messages) {
      if (!message || isServiceMessage(message)) continue;
      if (!message.out) return true;
    }
    const oldestId = messages[messages.length - 1]?.id;
    if (!oldestId || oldestId === offsetId || messages.length < 100) return false;
    offsetId = oldestId;
  }
  return false;
}

function persistArchiveState(client, peer, archived) {
  try {
    const accountId = findAccountIdByClient(client);
    const peerId = peer?.userId ?? peer?.id ?? peer;
    if (!accountId || peerId == null) return;
    const leadScoring = require('./leadScoring');
    if (archived) leadScoring.markPeerArchived(accountId, peerId).catch(() => {});
    else leadScoring.markPeerUnarchived(accountId, peerId).catch(() => {});
  } catch (_) {
    /* ignore */
  }
}

async function archivePeer(client, inputPeer) {
  const accountId = findAccountIdByClient(client);
  if (isFolderFrozen(accountId)) return false;
  const peer = await client.getInputEntity(inputPeer);
  try {
    await client.invoke(
      new Api.folders.EditPeerFolders({
        folderPeers: [
          new Api.InputFolderPeer({ peer, folderId: 1 }),
        ],
      }),
    );
  } catch (err) {
    if (isFrozenMethodError(err)) {
      markFolderFrozen(accountId, err);
      return false;
    }
    throw err;
  }
  markArchivedInCache(client, peer);
  persistArchiveState(client, peer, true);
  return true;
}

async function unarchivePeer(client, inputPeer) {
  const accountId = findAccountIdByClient(client);
  if (isFolderFrozen(accountId)) return false;
  const peer = await client.getInputEntity(inputPeer);
  try {
    await client.invoke(
      new Api.folders.EditPeerFolders({
        folderPeers: [
          new Api.InputFolderPeer({ peer, folderId: 0 }),
        ],
      }),
    );
  } catch (err) {
    if (isFrozenMethodError(err)) {
      markFolderFrozen(accountId, err);
      return false;
    }
    throw err;
  }
  const flags = archiveFlagsCache.get(client)?.flags;
  const id = peer?.userId ?? peer?.id;
  if (flags && id != null) flags.set(String(id), false);
  persistArchiveState(client, peer, false);
  return true;
}

async function mutePeerForever(client, inputPeer) {
  const peer = await client.getInputEntity(inputPeer);
  await client.invoke(
    new Api.account.UpdateNotifySettings({
      peer: new Api.InputNotifyPeer({ peer }),
      settings: new Api.InputPeerNotifySettings({ muteUntil: 2147483647 }),
    }),
  );
}

async function rearchiveOurOnlyWorkChats(accountId) {
  const key = accountKey(accountId);
  if (strayArchiveFixInFlight.has(key)) return;
  if (Date.now() - (rearchiveLastRun.get(key) || 0) < REARCHIVE_EVERY_MS) return;
  strayArchiveFixInFlight.add(key);
  rearchiveLastRun.set(key, Date.now());
  try {
    if (isFolderFrozen(accountId)) return;
    const client = getActiveClient(accountId);
    if (!client) return;
    let listed;
    try {
      listed = await loadArchiveFlags(client);
    } catch (err) {
      if (isFrozenMethodError(err)) {
        markFolderFrozen(accountId, err);
        return;
      }
      console.error(
        `[${accountLabel(accountId)}] Не смог найти мёртвые чаты:`,
        err.errorMessage || err.message,
      );
      return;
    }
    if (!aliveDialogPeers.has(key)) aliveDialogPeers.set(key, new Set());
    const alive = aliveDialogPeers.get(key);

    for (const dialog of listed.dialogs) {
      if (!dialog.isUser || dialog.archived) continue;
      const entity = dialog.entity;
      if (!entity || entity.bot || entity.self) continue;
      if (alive.has(String(entity.id))) continue;

      let incoming = false;
      let sample = '';
      try {
        const recent = await client.getMessages(entity, { limit: 20 });
        const texts = (recent || [])
          .filter((message) => message?.out && !isServiceMessage(message))
          .map((message) => String(message.message || ''))
          .filter(Boolean);
        if (!texts.length && !isDeletedUser(entity)) continue;
        sample = texts.find((text) => OUR_ONLY_WORK_RE.test(text)) || texts[0] || '';
        incoming = await peerHasIncoming(client, entity);
      } catch (err) {
        if (isFloodError(err)) break;
        continue;
      }
      const deleted = isDeletedUser(entity);
      const dead = deleted || !incoming;
      if (!dead) {
        alive.add(String(entity.id));
        continue;
      }

      const name = entity.username || entity.firstName || String(entity.id);
      const why = deleted ? 'удалённый аккаунт' : 'только наши сообщения';
      try {
        await archivePeer(client, entity);
        console.log(
          `[${accountLabel(accountId)}] Мёртвый диалог в архив (${name}, ${why}). Текст: "${sample}"`,
        );
      } catch (err) {
        if (isFrozenMethodError(err)) {
          markFolderFrozen(accountId, err);
          break;
        }
        console.error(
          `[${accountLabel(accountId)}] Не удалось добавить мёртвый диалог ${name} в архив:`,
          err.errorMessage || err.message,
        );
        if (isFloodError(err)) break;
      }
      await sleep(800);
    }
  } finally {
    strayArchiveFixInFlight.delete(key);
  }
}

module.exports = {
  configurePeers,
  isPeerBlacklisted,
  isPeerArchived,
  PERMANENT_SEND_ERROR_CODES,
  isPermanentSendError,
  retireUnreachablePeer,
  shouldSkipProactivePeer,
  isNeverContact,
  isDeletedUser,
  isServiceMessage,
  isTriggerMessageAlive,
  cancelReplyIfDialogGone,
  listUserDialogs,
  rememberArchiveFlags,
  ARCHIVE_FLAGS_TTL_MS,
  loadArchiveFlags,
  markArchivedInCache,
  isFloodError,
  isHiddenFromReplies,
  markPeerAsRead,
  peerHasIncoming,
  persistArchiveState,
  archivePeer,
  unarchivePeer,
  mutePeerForever,
  rearchiveOurOnlyWorkChats,
  isFrozenMethodError,
  markFolderFrozen,
  isFolderFrozen,
};
