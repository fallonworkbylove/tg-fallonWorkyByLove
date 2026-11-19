/**
 * Пул активных GramJS-клиентов: activate / deactivate / soft-revoke / ping / labels.
 * Inbound, scan, NFT — в telegramClient; сюда только lifecycle через hooks.
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const db = require('../db');
const {
  PROXY_POOL,
  getCurrentProxyIndex,
  setCurrentProxyIndex,
  proxyLabel,
  connectionCandidates,
  markProxyDead,
  reviveProxy,
  isProxyTransportError,
  noteNotConnectedBurst,
} = require('./proxyPools');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const CONNECT_DEADLINE_MS = Number(process.env.PROXY_CONNECT_DEADLINE_MS) || 12_000;

async function connectWithDeadline(client, ms = CONNECT_DEADLINE_MS) {
  let timer;
  try {
    const ok = await Promise.race([
      client.connect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('Proxy connection timed out (deadline)');
          err.errorMessage = 'Proxy connection timed out (deadline)';
          reject(err);
        }, ms);
      }),
    ]);
    // GramJS: connect() может вернуть false без throw (retries исчерпаны / 0).
    if (ok === false) {
      const err = new Error('Proxy connection failed');
      err.errorMessage = 'Proxy connection failed';
      throw err;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Жёстко закрыть сокет — иначе AUTH_KEY_DUPLICATED на своём же TCP. */
async function forceCloseClient(client) {
  if (!client) return;
  try {
    await client.disconnect();
  } catch (_) {}
  try {
    if (typeof client.destroy === 'function') await client.destroy();
  } catch (_) {}
}

/** @type {Map<any, import('telegram').TelegramClient>} */
const activeClients = new Map();
const accountLabels = new Map();
/** accountId → lowercase @username (из getMe) */
const accountUsernames = new Map();
/** Недавно сохранённые сессии — не wipe при ложном AUTH_KEY сразу после логина. */
const freshSessionUntil = new Map();
const FRESH_SESSION_GRACE_MS = 90_000;

function markFreshSession(accountId, sessionString) {
  const id = accountKey(accountId);
  const until = Date.now() + FRESH_SESSION_GRACE_MS;
  freshSessionUntil.set(id, until);
  if (sessionString) {
    freshSessionUntil.set(`s:${String(sessionString).slice(0, 48)}`, until);
  }
}

function isFreshSessionProtected(accountId, sessionString) {
  const now = Date.now();
  const id = accountKey(accountId);
  const byId = freshSessionUntil.get(id) || 0;
  const byS = sessionString
    ? freshSessionUntil.get(`s:${String(sessionString).slice(0, 48)}`) || 0
    : 0;
  return Math.max(byId, byS) > now;
}

let hooks = {
  /** После успешного connect + getMe: NewMessage, scan, boundary. */
  onActivated: null,
  /** Перед disconnect: таймеры, буферы, in-flight. */
  clearAccountRuntime: null,
  /** E.164 для ping. */
  normalizePhone: (p) => String(p || ''),
};

function configureClientPool(next) {
  hooks = { ...hooks, ...next };
}

function accountKey(accountId) {
  const n = Number(accountId);
  return Number.isInteger(n) ? n : accountId;
}

function accountLabel(accountId) {
  return accountLabels.get(String(accountId)) || `ID ${accountId}`;
}

/** Имя персонажа из getMe (first+last / @username), без телефона. */
function accountDisplayName(accountId) {
  const full = accountLabels.get(String(accountId));
  if (!full || /^ID\s/i.test(full)) return null;
  const parts = String(full).split(' — ');
  if (parts.length >= 2) {
    const name = parts.slice(1).join(' — ').trim();
    return name || null;
  }
  if (!/^\+?\d[\d\s-]{6,}$/.test(full.trim())) return full.trim();
  return null;
}

async function cacheAccountLabel(client, accountId) {
  try {
    const me = await client.getMe();
    const name =
      [me.firstName, me.lastName].filter(Boolean).join(' ') ||
      (me.username ? `@${me.username}` : '');
    accountLabels.set(
      String(accountId),
      [me.phone, name].filter(Boolean).join(' — ') || `ID ${accountId}`,
    );
    if (me.username) {
      accountUsernames.set(String(accountId), String(me.username).toLowerCase());
    } else {
      accountUsernames.delete(String(accountId));
    }
  } catch {
    accountLabels.set(String(accountId), `ID ${accountId}`);
  }
}

/**
 * Находит активный MTProto-аккаунт по публичному @username (getMe).
 */
async function findActiveAccountIdByUsername(username) {
  const needle = String(username || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!needle) return null;

  for (const [id, uname] of accountUsernames.entries()) {
    if (uname === needle) {
      const n = Number(id);
      return Number.isInteger(n) ? n : id;
    }
  }

  for (const [id, client] of activeClients.entries()) {
    try {
      const me = await client.getMe();
      const uname = me?.username ? String(me.username).toLowerCase() : '';
      if (uname) accountUsernames.set(String(id), uname);
      if (uname === needle) {
        const n = Number(id);
        return Number.isInteger(n) ? n : id;
      }
    } catch (_) {
      /* skip offline */
    }
  }
  return null;
}

function findAccountIdByClient(client) {
  for (const [id, c] of activeClients.entries()) {
    if (c === client) return id;
  }
  return null;
}

function getActiveClient(accountId) {
  return activeClients.get(accountKey(accountId));
}

function getActiveClientCount() {
  return activeClients.size;
}

function isActive(accountId) {
  return activeClients.has(accountKey(accountId));
}

/** @username из кэша (без сети). */
function getAccountUsernameSync(accountId) {
  const key = String(accountKey(accountId));
  return accountUsernames.get(key) || '';
}

/**
 * @username аккаунта (без @) из кэша или у живого клиента. Пусто, если нет.
 */
async function getAccountUsername(accountId) {
  const key = String(accountKey(accountId));
  if (accountUsernames.has(key)) return accountUsernames.get(key);
  const client = getActiveClient(accountId);
  if (!client) return '';
  try {
    const me = await client.getMe();
    const uname = me?.username ? String(me.username).toLowerCase() : '';
    if (uname) accountUsernames.set(key, uname);
    return uname;
  } catch (_) {
    return '';
  }
}

function isRevokedSessionError(err) {
  const text = `${err?.errorMessage || ''} ${err?.message || ''}`;
  return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|PHONE_NUMBER_BANNED/.test(
    text,
  );
}

/**
 * Поднимает клиент из сохранённой session_string и кладёт в пул.
 * Возвращает true при успехе, false при ошибке, 'revoked' если сессия мертва.
 */
async function activateAccount(accountId, sessionString) {
  accountId = accountKey(accountId);
  if (activeClients.has(accountId)) return true;

  // Строго work/DC: медиа (ГС/фото/видео) пойдёт через этот клиент весь день.
  // Residential/login-пул здесь запрещён.
  const candidates = connectionCandidates();

  for (const candidate of candidates) {
    const opts = candidate.opts || candidate;
    const index = candidate.index;
    if (candidate.pool && candidate.pool !== PROXY_POOL) {
      console.error(
        `[proxy] BUG: activateAccount получил не work-пул — пропуск (защита residential)`,
      );
      continue;
    }

    let client;
    try {
      client = new TelegramClient(
        new StringSession(sessionString),
        apiId,
        apiHash,
        opts,
      );

      await connectWithDeadline(client);

      try {
        await client.getMe();
      } catch (authErr) {
        await forceCloseClient(client);
        client = null;
        if (isRevokedSessionError(authErr)) {
          if (isFreshSessionProtected(accountId, sessionString)) {
            console.warn(
              `Аккаунт ${accountId}: AUTH_KEY сразу после логина — не стираю сессию (grace).`,
            );
            return false;
          }
          await forgetRevokedAccount(accountId);
          return 'revoked';
        }
        console.error(
          `Не удалось проверить сессию аккаунта ${accountId}:`,
          authErr.errorMessage || authErr.message,
        );
        continue;
      }
      await cacheAccountLabel(client, accountId);

      if (index !== undefined) {
        reviveProxy(index);
        if (index !== getCurrentProxyIndex()) {
          setCurrentProxyIndex(index);
          console.log(`[proxy] Work: переключился на ${proxyLabel(PROXY_POOL[index])}`);
        }
      }

      activeClients.set(accountId, client);

      if (typeof hooks.onActivated === 'function') {
        await hooks.onActivated(accountId, client);
      }

      return true;
    } catch (err) {
      const errMsg = String(err.errorMessage || err.message || '');
      const via = index !== undefined ? ` через ${proxyLabel(PROXY_POOL[index])}` : '';
      console.error(
        `Не удалось подключить аккаунт ${accountId}${via}:`,
        err.errorMessage || err.message,
      );
      await forceCloseClient(client);
      client = null;
      // AUTH_KEY: не ждём 120с в волне (блокирует bootstrap + overlap).
      // Retry снаружи через sessionBootstrap (5м).
      if (/AUTH_KEY_DUPLICATED/i.test(errMsg)) {
        console.warn(
          `Аккаунт ${accountId}: AUTH_KEY_DUPLICATED — пропускаю (retry позже).`,
        );
        try {
          require('./opsEvents').noteAuthKeyDuplicated(accountId);
        } catch (_) {
          /* optional */
        }
        return false;
      }
      // Короткий flap-TTL: 12м DEAD выжигает весь warm-OK пул на 1-м аккаунте.
      if (index !== undefined && isProxyTransportError(err)) {
        markProxyDead(index, err.errorMessage || err.message, 45_000);
      }
      if (/Not connected|Connection closed while receiving/i.test(errMsg)) {
        noteNotConnectedBurst(err.message || err.errorMessage);
      }
      if (isRevokedSessionError(err)) {
        if (isFreshSessionProtected(accountId, sessionString)) {
          console.warn(
            `Аккаунт ${accountId}: AUTH_KEY сразу после логина — не стираю сессию (grace).`,
          );
          return false;
        }
        await forgetRevokedAccount(accountId);
        return 'revoked';
      }
    }
  }

  // Один повтор только для transport flap (не AUTH_KEY — его ретраит bootstrap).
  console.warn(`Аккаунт ${accountId}: повтор подключения (transport)…`);
  await new Promise((r) => setTimeout(r, 1500));
  const retryCandidates = connectionCandidates();
  for (const candidate of retryCandidates) {
    const opts = candidate.opts || candidate;
    const index = candidate.index;
    if (candidate.pool && candidate.pool !== PROXY_POOL) continue;
    let client;
    try {
      client = new TelegramClient(
        new StringSession(sessionString),
        apiId,
        apiHash,
        opts,
      );
      await connectWithDeadline(client);
      try {
        await client.getMe();
      } catch (authErr) {
        await forceCloseClient(client);
        if (isRevokedSessionError(authErr)) {
          if (isFreshSessionProtected(accountId, sessionString)) {
            console.warn(
              `Аккаунт ${accountId}: AUTH_KEY (retry) сразу после логина — не стираю сессию.`,
            );
            return false;
          }
          await forgetRevokedAccount(accountId);
          return 'revoked';
        }
        continue;
      }
      await cacheAccountLabel(client, accountId);
      if (index !== undefined) {
        reviveProxy(index);
        if (index !== getCurrentProxyIndex()) setCurrentProxyIndex(index);
      }
      activeClients.set(accountId, client);
      if (typeof hooks.onActivated === 'function') {
        await hooks.onActivated(accountId, client);
      }
      console.log(`Аккаунт ${accountId}: подключён со 2-й попытки.`);
      return true;
    } catch (err) {
      const errMsg = String(err.errorMessage || err.message || '');
      await forceCloseClient(client);
      if (/AUTH_KEY_DUPLICATED/i.test(errMsg)) {
        console.warn(
          `Аккаунт ${accountId}: AUTH_KEY на transport-retry — пропускаю.`,
        );
        try {
          require('./opsEvents').noteAuthKeyDuplicated(accountId);
        } catch (_) {
          /* optional */
        }
        return false;
      }
      if (index !== undefined && isProxyTransportError(err)) {
        markProxyDead(index, err.errorMessage || err.message, 45_000);
      }
      if (isRevokedSessionError(err)) {
        if (isFreshSessionProtected(accountId, sessionString)) {
          console.warn(
            `Аккаунт ${accountId}: AUTH_KEY (retry) сразу после логина — не стираю сессию.`,
          );
          return false;
        }
        await forgetRevokedAccount(accountId);
        return 'revoked';
      }
    }
  }

  console.error(`Аккаунт ${accountId}: подключение не удалось (прокси/ключ).`);
  return false;
}

/**
 * Сессия мертва на стороне Telegram — НЕ удаляем аккаунт (промпт/медиа/задержки).
 * Чистим session_string, гасим AI, статус «Нужна авторизация».
 */
async function forgetRevokedAccount(accountId) {
  const id = accountKey(accountId);
  try {
    await deactivateAccount(id);
  } catch (_) {}
  try {
    const [result] = await db.execute(
      `UPDATE accounts
       SET session_string = '',
           status = 'Нужна авторизация',
           is_autoreply_enabled = 0
       WHERE id = ?`,
      [id],
    );
    console.log(
      result.affectedRows > 0
        ? `Аккаунт ${id}: сессия отозвана — запись сохранена, нужна повторная авторизация.`
        : `Аккаунт ${id}: сессия отозвана, строки в базе нет.`,
    );
  } catch (err) {
    console.error(
      `Аккаунт ${id}: не удалось пометить отозванную сессию:`,
      err.message,
    );
  }
}

/**
 * Проверка сессии ТОЛЬКО через живой клиент в процессе.
 * Нельзя поднимать второй GramJS с тем же session_string — убьёт ключ.
 */
async function pingActiveSession(accountId) {
  const id = accountKey(accountId);
  const client = activeClients.get(id);
  if (!client) return { ok: false, reason: 'offline' };
  try {
    if (!client.connected) await client.connect();
    const me = await client.getMe();
    const normalize = hooks.normalizePhone || ((p) => String(p || ''));
    return {
      ok: true,
      phone: me?.phone ? normalize(String(me.phone)) : null,
      username: me?.username || null,
      firstName: me?.firstName || null,
    };
  } catch (err) {
    if (isRevokedSessionError(err)) {
      await forgetRevokedAccount(id);
      return { ok: false, reason: 'revoked' };
    }
    return { ok: false, reason: err.errorMessage || err.message || 'error' };
  }
}

/**
 * Останавливает клиент и убирает из пула.
 */
async function deactivateAccount(accountId) {
  accountId = accountKey(accountId);

  if (typeof hooks.clearAccountRuntime === 'function') {
    try {
      hooks.clearAccountRuntime(accountId);
    } catch (err) {
      console.error(
        `Аккаунт ${accountId}: clearAccountRuntime:`,
        err.message,
      );
    }
  }

  accountLabels.delete(String(accountId));
  accountUsernames.delete(String(accountId));

  const client = activeClients.get(accountId);
  activeClients.delete(accountId);
  if (!client) return;

  try {
    await forceCloseClient(client);
  } catch (err) {
    console.error(`Ошибка отключения аккаунта ${accountId}:`, err.message);
  }
}

/** Корректный logout всех MTProto перед pm2 restart — иначе AUTH_KEY_DUPLICATED. */
async function deactivateAllAccounts() {
  const ids = [...activeClients.keys()];
  for (const id of ids) {
    try {
      await deactivateAccount(id);
    } catch (_) {
      /* ignore */
    }
  }
  return ids.length;
}

module.exports = {
  configureClientPool,
  activeClients,
  accountKey,
  accountLabel,
  accountDisplayName,
  cacheAccountLabel,
  findActiveAccountIdByUsername,
  findAccountIdByClient,
  getAccountUsername,
  getAccountUsernameSync,
  getActiveClient,
  getActiveClientCount,
  isActive,
  isRevokedSessionError,
  activateAccount,
  deactivateAccount,
  deactivateAllAccounts,
  forgetRevokedAccount,
  markFreshSession,
  isFreshSessionProtected,
  pingActiveSession,
};
