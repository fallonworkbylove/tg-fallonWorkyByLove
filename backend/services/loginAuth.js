/**
 * Вход аккаунта с нуля:
 *  1) QR (auth.exportLoginToken) — основной путь без SMS
 *  2) телефон + код в приложение Telegram — запасной
 *
 * Telegram с 2023 не отдаёт SMS сторонним клиентам; SentCodeTypeApp
 * уходит только в уже открытые сессии. QR — официальная альтернатива.
 */

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');

const PENDING_LOGIN_TTL_MS = 25 * 60 * 1000;
/** QR крутим без жёсткого дедлайна — TTL продлеваем на каждом refresh/poll. */
const PENDING_QR_TTL_MS = 24 * 60 * 60 * 1000;
const QR_REFRESH_MS = 25_000;
const QR_MARKER = 'qr';

/** @type {Map<string, object>} */
const pendingLogins = new Map();
/** Mutex на QR poll per user — без параллельных completeQrAuthorization. */
const qrPollLocks = new Map();

let deps = {
  apiId: 0,
  apiHash: '',
  loginConnectionCandidates: () => [{}],
  workConnectionCandidates: null,
  loginPool: [],
  workPool: [],
  loginPoolKind: 'none',
  proxyLabel: (p) => String(p?.ip || 'direct'),
  ConnectionTCPFull443: undefined,
};

function configureLoginAuth(next) {
  deps = { ...deps, ...next };
}

function loginKey(userId, phoneOrMarker) {
  return `${userId}:${phoneOrMarker}`;
}

function qrKey(userId) {
  return loginKey(userId, QR_MARKER);
}

function normalizeLoginPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return `+${digits}`;
}

/** Достаёт код 4–8 цифр из любого текста («код: 12345», «1 2 3 4 5»). */
function extractLoginCode(raw) {
  const s = String(raw || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!s) return '';
  const compact = s.replace(/[\s\-_.]/g, '');
  if (/^\d{4,8}$/.test(compact)) return compact;
  const ascii = compact.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
  if (/^\d{4,8}$/.test(ascii)) return ascii;
  const m = s.match(/(?:^|[^\d])(\d{4,8})(?:[^\d]|$)/);
  return m ? m[1] : '';
}

function loginClientBaseOpts(extra = {}) {
  return {
    deviceModel: process.env.LOGIN_DEVICE_MODEL || 'Desktop',
    systemVersion: process.env.LOGIN_SYSTEM_VERSION || 'Windows 10',
    appVersion: process.env.LOGIN_APP_VERSION || '5.14.3 x64',
    langCode: 'ru',
    systemLangCode: 'ru-RU',
    connectionRetries: 1,
    timeout: 10,
    ...extra,
  };
}

function pruneExpiredPendingLogins() {
  const now = Date.now();
  for (const [key, entry] of pendingLogins.entries()) {
    if (!entry?.expiresAt || entry.expiresAt > now) continue;
    // TTL-prune: fire-and-forget (нет session handoff).
    void disposePendingEntry(key, entry);
    console.log(`[login] pending TTL истёк: ${key}`);
  }
}

/**
 * Снимает pending и гасит GramJS-клиент.
 * Перед activateAccount ОБЯЗАТЕЛЬНО await — иначе второй GramJS убьёт ключ.
 */
async function disposePendingEntry(key, entry) {
  pendingLogins.delete(key);
  if (entry?.refreshTimer) {
    clearInterval(entry.refreshTimer);
    entry.refreshTimer = null;
  }
  if (entry?.client && entry._updateHandler) {
    try {
      entry.client.removeEventHandler(entry._updateHandler);
    } catch (_) {}
  }
  if (entry?.client) {
    try {
      await Promise.race([
        entry.client.disconnect(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (_) {
      /* ignore */
    }
    // Пауза после disconnect: Telegram успевает отпустить auth_key
    // до activateAccount с тем же sessionString (иначе AUTH_KEY_UNREGISTERED).
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

function stashPending(key, data) {
  const prev = pendingLogins.get(key);
  if (prev?.refreshTimer && prev.refreshTimer !== data.refreshTimer) {
    clearInterval(prev.refreshTimer);
  }
  const now = Date.now();
  const ttl = data.mode === 'qr' ? PENDING_QR_TTL_MS : PENDING_LOGIN_TTL_MS;
  pendingLogins.set(key, {
    ...data,
    createdAt: data.createdAt || now,
    expiresAt: now + ttl,
  });
}

function findPendingLogin(userId, phone) {
  pruneExpiredPendingLogins();
  const uid = String(userId);
  const want = phone ? normalizeLoginPhone(phone) : '';
  if (phone === QR_MARKER || phone === '+qr' || want === '+qr') {
    const entry = pendingLogins.get(qrKey(uid));
    if (entry?.client) return { key: qrKey(uid), entry };
  }
  if (want) {
    const exact = pendingLogins.get(loginKey(uid, want));
    if (exact?.client && (exact.phoneCodeHash || exact.mode === 'qr')) {
      return { key: loginKey(uid, want), entry: exact };
    }
    for (const [key, entry] of pendingLogins.entries()) {
      if (!key.startsWith(`${uid}:`)) continue;
      if (normalizeLoginPhone(entry.phone) === want && entry.client) {
        return { key, entry };
      }
    }
    return null;
  }
  let best = null;
  for (const [key, entry] of pendingLogins.entries()) {
    if (!key.startsWith(`${uid}:`)) continue;
    if (!entry?.client) continue;
    if (!best || (entry.createdAt || 0) > (best.entry.createdAt || 0)) {
      best = { key, entry };
    }
  }
  return best;
}

async function ensurePendingConnected(entry) {
  if (!entry?.client) return false;
  try {
    if (!entry.client.connected) {
      console.log(`[login] reconnect pending ${entry.phone || entry.mode}`);
      await entry.client.connect();
    }
    return true;
  } catch (err) {
    console.error(
      `[login] reconnect fail:`,
      err.errorMessage || err.message,
    );
    return false;
  }
}

async function cancelPendingLogin(userId, phone) {
  const found = findPendingLogin(userId, phone);
  if (!found) {
    const key = loginKey(userId, phone === QR_MARKER ? QR_MARKER : normalizeLoginPhone(phone) || phone);
    const entry = pendingLogins.get(key);
    if (!entry) return false;
    await disposePendingEntry(key, entry);
    return true;
  }
  await disposePendingEntry(found.key, found.entry);
  return true;
}

async function cancelAllPendingLoginsForUser(userId) {
  const prefix = `${userId}:`;
  const keys = [...pendingLogins.keys()].filter((k) => String(k).startsWith(prefix));
  for (const key of keys) {
    await disposePendingEntry(key, pendingLogins.get(key));
  }
  return keys.length;
}

function peekPendingLogin(userId) {
  const found = findPendingLogin(userId, null);
  if (!found) return null;
  return {
    phone: found.entry.phone,
    expiresAt: found.entry.expiresAt,
    isCodeViaApp: !!found.entry.isCodeViaApp,
    mode: found.entry.mode || 'phone',
    loginUrl: found.entry.loginUrl || null,
    needPassword: !!found.entry.needPassword,
    handOff: !!found.entry.handOff,
  };
}

/** Индекс последнего удачного login-прокси — пробуем первым. */
let lastGoodLoginIndex = null;
/** host:port → не раньше какого Date.now() пробовать снова. */
const proxyCooldownUntil = new Map();
const PROXY_COOLDOWN_MS = Math.max(
  60_000,
  Number(process.env.LOGIN_PROXY_COOLDOWN_MS) || 10 * 60_000,
);

function proxyCooldownKey(candidate) {
  const pool = candidate?.pool || deps.loginPool || [];
  const p = pool[candidate?.index];
  if (!p?.ip) return `idx:${candidate?.index}`;
  return `${p.ip}:${p.port}`;
}

function isProxyOnCooldown(candidate) {
  const until = proxyCooldownUntil.get(proxyCooldownKey(candidate)) || 0;
  return Date.now() < until;
}

function markProxyBad(candidate, reason) {
  const key = proxyCooldownKey(candidate);
  proxyCooldownUntil.set(key, Date.now() + PROXY_COOLDOWN_MS);
  console.warn(`[login] proxy cooldown ${key}: ${reason || 'fail'} (~${Math.round(PROXY_COOLDOWN_MS / 60000)}м)`);
}

function candidateViaLabel(candidate) {
  const pool = candidate?.pool || deps.loginPool || [];
  const index = candidate?.index;
  return index !== undefined && pool[index] ? deps.proxyLabel(pool[index]) : `try#${index}`;
}

function withHardTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${ms}ms ${label || ''}`)), ms);
    }),
  ]);
}

async function tryConnectOne(candidate, perTryMs) {
  const viaLabel = candidateViaLabel(candidate);
  // GramJS: for (attempt = 0; attempt < retries; attempt++) — retries=0 ⇒ connect
  // сразу возвращает false и connected=false, а ExportLoginToken потом висит вечно.
  const opts = loginClientBaseOpts({
    ...(candidate.opts || candidate),
    connectionRetries: 1,
    timeout: Math.max(4, Math.ceil(perTryMs / 1000)),
  });
  if (opts.proxy && deps.ConnectionTCPFull443 && !opts.connection) {
    opts.connection = deps.ConnectionTCPFull443;
  }
  if (isProxyOnCooldown(candidate)) {
    throw new Error(`cooldown ${viaLabel}`);
  }
  const client = new TelegramClient(new StringSession(''), deps.apiId, deps.apiHash, opts);
  try {
    const ok = await withHardTimeout(client.connect(), perTryMs, viaLabel);
    if (ok === false || !client.connected) {
      markProxyBad(candidate, 'disconnected');
      throw new Error(`connect returned disconnected (${viaLabel})`);
    }
    return { client, viaLabel, index: candidate.index, candidate };
  } catch (err) {
    try {
      await client.disconnect();
    } catch (_) {}
    const msg = `${err.errorMessage || ''} ${err.message || ''}`;
    if (/Authentication failed|NotAllowed|ECONNRESET|ETIMEDOUT|timeout|ENETUNREACH/i.test(msg)) {
      markProxyBad(candidate, err.errorMessage || err.message);
    }
    throw err;
  }
}

/**
 * Поднимает пустой GramJS-клиент через login/residential пул.
 * Параллельный race по 3 прокси + жёсткий wall-clock таймаут — QR не висит 45с.
 */
async function connectFreshLoginClient(label = 'login') {
  const isQr = label === 'qr';
  try {
    const { warmProbeLoginProxies } = require('./proxyPools');
    await warmProbeLoginProxies({
      timeoutMs: isQr ? 2500 : 2800,
      concurrency: 4,
      limit: isQr ? 8 : 10,
    });
  } catch (e) {
    console.warn(`[login] ${label} probe skip:`, e.message);
  }
  const LOGIN_PROXY_MAX_TRIES = Math.min(
    isQr ? 9 : 12,
    Math.max(3, Number(process.env.LOGIN_PROXY_MAX_TRIES) || (isQr ? 6 : 10)),
  );
  const LOGIN_OVERALL_MS = Math.max(
    12000,
    Number(process.env.LOGIN_OVERALL_MS) || (isQr ? 30000 : 45000),
  );
  const PER_TRY_MS = Math.max(2500, Number(process.env.LOGIN_PROXY_TRY_MS) || (isQr ? 9000 : 7000));
  const PARALLEL = Math.max(1, Math.min(4, Number(process.env.LOGIN_PROXY_PARALLEL) || (isQr ? 2 : 3)));

  const candOpts = {
    connectionRetries: 1,
    timeout: Math.max(4, Math.ceil(PER_TRY_MS / 1000)),
  };
  // QR: work/DC первым (ExportLoginToken стабилен), потом residential.
  // Телефон/код — только login/residential.
  let allCandidates;
  if (isQr && typeof deps.workConnectionCandidates === 'function' && (deps.workPool || []).length) {
    allCandidates = [
      ...deps.workConnectionCandidates(candOpts).slice(0, 5),
      ...deps.loginConnectionCandidates(candOpts).slice(0, 4),
    ];
  } else {
    allCandidates = deps.loginConnectionCandidates(candOpts);
  }

  // Рабочий прокси — первым, остальные как пришли (уже shuffled).
  let ordered = allCandidates.slice();
  if (lastGoodLoginIndex != null) {
    const hit = ordered.findIndex((c) => c.index === lastGoodLoginIndex);
    if (hit > 0) {
      const [good] = ordered.splice(hit, 1);
      ordered.unshift(good);
    }
  }
  const candidates = ordered.slice(0, LOGIN_PROXY_MAX_TRIES);
  const deadline = Date.now() + LOGIN_OVERALL_MS;
  let lastErr = null;

  console.log(
    `[login] ${label}: race×${PARALLEL} до ${candidates.length} прокси (из ${allCandidates.length}), try=${PER_TRY_MS}мс, лимит ${LOGIN_OVERALL_MS}мс, api_id=${deps.apiId}${
      lastGoodLoginIndex != null ? `, lastGood=#${lastGoodLoginIndex}` : ''
    }${isQr ? ', qr→work+login' : ''}`,
  );

  for (let i = 0; i < candidates.length; i += PARALLEL) {
    if (Date.now() > deadline) {
      lastErr = lastErr || new Error('Таймаут логина: прокси не ответили вовремя');
      break;
    }
    const batch = candidates.slice(i, i + PARALLEL);
    const leftMs = Math.max(1000, deadline - Date.now());
    const tryMs = Math.min(PER_TRY_MS, leftMs);
    console.log(
      `[login] партия: ${batch.map(candidateViaLabel).join(' | ')} (≤${tryMs}мс)`,
    );

    const results = await Promise.all(
      batch.map(async (candidate) => {
        try {
          const ok = await tryConnectOne(candidate, tryMs);
          return { ok };
        } catch (err) {
          const viaLabel = candidateViaLabel(candidate);
          console.error(`[login] connect fail ${viaLabel}:`, err.errorMessage || err.message);
          const msg = `${err.errorMessage || ''} ${err.message || ''}`;
          if (/FLOOD_WAIT|FLOOD|API_ID_INVALID|API_ID_PUBLISHED/i.test(msg)) {
            return { fatal: err };
          }
          return { err };
        }
      }),
    );

    for (const r of results) {
      if (r.fatal) throw r.fatal;
    }
    const winner = results.find((r) => r.ok)?.ok;
    if (winner) {
      // Остальные успешные из партии (если гонка дала >1) — гасим.
      for (const r of results) {
        if (r.ok && r.ok.client !== winner.client) {
          try {
            await r.ok.client.disconnect();
          } catch (_) {}
        }
      }
      if (winner.index !== undefined && winner.index !== null) {
        lastGoodLoginIndex = winner.index;
      }
      console.log(`[login] ${label}: ок через ${winner.viaLabel} за ${Date.now() - (deadline - LOGIN_OVERALL_MS)}мс`);
      return winner;
    }
    lastErr = results.map((r) => r.err).find(Boolean) || lastErr;
  }
  throw lastErr || new Error('Не удалось подключиться к Telegram');
}

function tokenToLoginUrl(tokenBuf) {
  const b64 = Buffer.from(tokenBuf).toString('base64url');
  return `tg://login?token=${b64}`;
}

async function exportQrToken(client) {
  if (!client?.connected) {
    throw new Error('ExportLoginToken: клиент не подключён');
  }
  const result = await withHardTimeout(
    client.invoke(
      new Api.auth.ExportLoginToken({
        apiId: Number(deps.apiId),
        apiHash: deps.apiHash,
        exceptIds: [],
      }),
    ),
    Math.max(8000, Number(process.env.LOGIN_EXPORT_MS) || 12000),
    'ExportLoginToken',
  );
  if (result instanceof Api.auth.LoginTokenSuccess) {
    return { kind: 'success', result };
  }
  if (result instanceof Api.auth.LoginTokenMigrateTo) {
    return { kind: 'migrate', result };
  }
  if (result instanceof Api.auth.LoginToken) {
    const loginUrl = tokenToLoginUrl(result.token);
    return {
      kind: 'token',
      token: result.token,
      expires: Number(result.expires) || Math.floor(Date.now() / 1000) + 30,
      loginUrl,
    };
  }
  throw new Error(`Неожиданный ответ ExportLoginToken: ${result?.className || typeof result}`);
}

async function completeQrAuthorization(client) {
  let result = await client.invoke(
    new Api.auth.ExportLoginToken({
      apiId: Number(deps.apiId),
      apiHash: deps.apiHash,
      exceptIds: [],
    }),
  );

  if (result instanceof Api.auth.LoginTokenMigrateTo) {
    await client._switchDC(result.dcId);
    result = await client.invoke(new Api.auth.ImportLoginToken({ token: result.token }));
  }

  if (
    result instanceof Api.auth.LoginTokenSuccess &&
    result.authorization instanceof Api.auth.Authorization
  ) {
    let me = result.authorization.user;
    try {
      me = me || (await client.getMe());
    } catch (_) {}
    const digits = String(me?.phone || '').replace(/\D/g, '');
    const phone = digits ? normalizeLoginPhone(digits) : '+unknown';
    const sessionString = client.session.save();
    return { status: 'ok', sessionString, phone, user: me };
  }

  return { status: 'pending' };
}

/**
 * Старт QR-входа. Воркер шлёт loginUrl / картинку QR, потом pollQrLogin.
 */
async function startQrLogin(userId) {
  await cancelAllPendingLoginsForUser(userId);
  const key = qrKey(userId);
  const exportAttempts = Math.max(2, Number(process.env.LOGIN_QR_EXPORT_TRIES) || 3);
  let lastErr = null;

  for (let attempt = 1; attempt <= exportAttempts; attempt += 1) {
    let client;
    let viaLabel;
    try {
      ({ client, viaLabel } = await connectFreshLoginClient('qr'));
    } catch (err) {
      lastErr = err;
      console.error(`[login] QR connect attempt ${attempt}/${exportAttempts}:`, err.message);
      continue;
    }

    const entry = {
      client,
      mode: 'qr',
      phone: QR_MARKER,
      userId: String(userId),
      qrScanned: false,
      loginUrl: null,
      expires: 0,
      viaLabel,
    };

    const onUpdate = (update) => {
      const name = update?.className || update?.constructor?.name || '';
      if (update instanceof Api.UpdateLoginToken || name === 'UpdateLoginToken') {
        console.log(`[login] QR: UpdateLoginToken для user=${userId}`);
        entry.qrScanned = true;
      }
    };
    entry._updateHandler = onUpdate;
    client.addEventHandler(onUpdate);

    try {
      const exported = await exportQrToken(client);
      if (exported.kind === 'success') {
        try {
          const done = await completeQrAuthorization(client);
          if (done.status === 'ok') {
            entry.handOff = true;
            entry.sessionString = done.sessionString;
            stashPending(key, entry);
            return { ...done, alreadyAuthorized: true, handOff: true };
          }
        } catch (err) {
          if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
            entry.mode = 'qr';
            return resolvePasswordNeeded(key, entry, QR_MARKER);
          }
          throw err;
        }
      }
      if (exported.kind !== 'token') {
        throw new Error(`Telegram не выдал QR-токен (${exported.kind})`);
      }

      entry.loginUrl = exported.loginUrl;
      entry.expires = exported.expires;
      entry.token = exported.token;

      entry.refreshTimer = setInterval(() => {
        refreshQrTokenSilent(userId).catch((err) => {
          console.error('[login] QR refresh:', err.errorMessage || err.message);
        });
      }, QR_REFRESH_MS);

      stashPending(key, entry);
      console.log(
        `[login] QR старт user=${userId} через ${viaLabel} — ${exported.loginUrl.slice(0, 48)}…`,
      );

      return {
        status: 'pending',
        loginUrl: exported.loginUrl,
        expires: exported.expires,
        via: viaLabel,
      };
    } catch (err) {
      lastErr = err;
      console.error(
        `[login] QR export attempt ${attempt}/${exportAttempts} via ${viaLabel}:`,
        err.errorMessage || err.message,
      );
      try {
        client.removeEventHandler(onUpdate);
      } catch (_) {}
      try {
        await client.disconnect();
      } catch (_) {}
      // Сбрасываем «хороший» прокси — он не смог отдать токен.
      lastGoodLoginIndex = null;
    }
  }

  throw lastErr || new Error('Не удалось получить QR');
}

/**
 * Telegram кинул SESSION_PASSWORD_NEEDED — но иногда has_password=false (глюк/прокси).
 * Тогда не мучаем воркера полем пароля: просим начать вход заново.
 */
async function resolvePasswordNeeded(key, entry, phoneHint) {
  let hasPassword = true;
  try {
    if (entry?.client) {
      const info = await entry.client.invoke(new Api.account.GetPassword());
      hasPassword = !!(info.has_password ?? info.hasPassword);
    }
  } catch (e) {
    console.warn(
      `[login] GetPassword probe fail:`,
      e.errorMessage || e.message,
    );
  }
  if (!hasPassword) {
    console.warn(
      `[login] SESSION_PASSWORD_NEEDED, но has_password=false (${phoneHint || entry.phone || 'qr'}) — false positive`,
    );
    await disposePendingEntry(key, entry);
    const err = new Error(
      'Telegram ошибочно запросил пароль, а двухэтапной проверки на аккаунте нет. Начни вход заново (новый код или новый QR).',
    );
    err.statusCode = 400;
    err.code = 'PASSWORD_FALSE_POSITIVE';
    throw err;
  }
  if (entry.refreshTimer) {
    clearInterval(entry.refreshTimer);
    entry.refreshTimer = null;
  }
  entry.needPassword = true;
  entry.qrScanned = entry.mode === 'qr' ? true : entry.qrScanned;
  if (entry.mode === 'qr') entry.phone = QR_MARKER;
  stashPending(key, { ...entry, refreshTimer: null });
  console.log(
    `[login] ${entry.mode === 'qr' ? 'QR' : entry.phone}: нужен 2FA пароль user=${entry.userId}`,
  );
  return {
    status: 'needPassword',
    phone: entry.mode === 'qr' ? QR_MARKER : entry.phone || phoneHint,
    hasPassword: true,
  };
}

function markQrNeedPassword(key, entry) {
  // sync fallback — callers that can't await still stash; prefer resolvePasswordNeeded
  if (entry.refreshTimer) {
    clearInterval(entry.refreshTimer);
    entry.refreshTimer = null;
  }
  entry.needPassword = true;
  entry.qrScanned = true;
  entry.phone = QR_MARKER;
  stashPending(key, { ...entry, refreshTimer: null });
  console.log(`[login] QR: нужен 2FA пароль user=${entry.userId}`);
  return { status: 'needPassword', phone: QR_MARKER };
}

async function refreshQrTokenSilent(userId) {
  const key = qrKey(userId);
  const entry = pendingLogins.get(key);
  if (!entry?.client || entry.mode !== 'qr') return null;
  if (entry.qrScanned || entry.needPassword) return null;
  if (!(await ensurePendingConnected(entry))) return null;

  try {
    const exported = await exportQrToken(entry.client);
    if (exported.kind === 'token') {
      entry.loginUrl = exported.loginUrl;
      entry.expires = exported.expires;
      entry.token = exported.token;
      stashPending(key, entry);
      return { loginUrl: exported.loginUrl, expires: exported.expires };
    }
    if (exported.kind === 'success' || exported.kind === 'migrate') {
      entry.qrScanned = true;
      stashPending(key, entry);
    }
    return null;
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      await resolvePasswordNeeded(key, entry, QR_MARKER);
      return { needPassword: true };
    }
    throw err;
  }
}

/**
 * Опрос QR: pending | ok | needPassword.
 * Каждый poll пробует ExportLoginToken — так ловим скан и 2FA даже без UpdateLoginToken.
 */
async function pollQrLogin(userId) {
  const lockKey = String(userId);
  if (qrPollLocks.get(lockKey)) {
    return { status: 'pending', loginUrl: null, expires: null, busy: true };
  }
  qrPollLocks.set(lockKey, true);
  try {
    return await pollQrLoginUnlocked(userId);
  } finally {
    qrPollLocks.delete(lockKey);
  }
}

async function pollQrLoginUnlocked(userId) {
  pruneExpiredPendingLogins();
  const key = qrKey(userId);
  const entry = pendingLogins.get(key);
  if (!entry?.client) {
    const err = new Error('QR-сессия не найдена. Нажми «QR» снова.');
    err.statusCode = 400;
    throw err;
  }

  if (entry.handOff && entry.sessionString) {
    return {
      status: 'ok',
      sessionString: entry.sessionString,
      phone: entry.phone,
      handOff: true,
    };
  }

  if (!(await ensurePendingConnected(entry))) {
    await disposePendingEntry(key, entry);
    const err = new Error('Связь с Telegram потеряна. Запусти QR заново.');
    err.statusCode = 400;
    throw err;
  }

  if (entry.needPassword) {
    return { status: 'needPassword', phone: QR_MARKER };
  }

  // После скана / UpdateLoginToken — добиваем авторизацию.
  if (entry.qrScanned) {
    try {
      const done = await completeQrAuthorization(entry.client);
      if (done.status === 'ok') {
        entry.handOff = true;
        entry.sessionString = done.sessionString;
        entry.phone = done.phone;
        stashPending(key, entry);
        console.log(`[login] QR ок phone=${done.phone} sessionLen=${done.sessionString.length} (handoff)`);
        return { status: 'ok', sessionString: done.sessionString, phone: done.phone, handOff: true };
      }
    } catch (err) {
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        return resolvePasswordNeeded(key, entry, QR_MARKER);
      }
      // Токен протух между сканом и Import — крутим новый QR, не валим poll.
      if (/AUTH_TOKEN_EXPIRED|AUTH_TOKEN_INVALID/i.test(err.errorMessage || err.message || '')) {
        console.warn('[login] QR: токен протух после скана — обновляю');
        entry.qrScanned = false;
        stashPending(key, entry);
      } else {
        throw err;
      }
    }
  }

  // Пока ждём скан: обновляем токен и ловим SESSION_PASSWORD_NEEDED / Success.
  try {
    const exported = await exportQrToken(entry.client);
    if (exported.kind === 'token') {
      entry.loginUrl = exported.loginUrl;
      entry.expires = exported.expires;
      entry.token = exported.token;
      entry.expiresAt = Date.now() + PENDING_QR_TTL_MS;
      stashPending(key, entry);
      return {
        status: 'pending',
        loginUrl: entry.loginUrl,
        expires: entry.expires,
      };
    }
    if (exported.kind === 'success' || exported.kind === 'migrate') {
      entry.qrScanned = true;
      stashPending(key, entry);
      const done = await completeQrAuthorization(entry.client);
      if (done.status === 'ok') {
        entry.handOff = true;
        entry.sessionString = done.sessionString;
        entry.phone = done.phone;
        stashPending(key, entry);
        console.log(`[login] QR ок phone=${done.phone} sessionLen=${done.sessionString.length} (handoff)`);
        return {
          status: 'ok',
          sessionString: done.sessionString,
          phone: done.phone,
          handOff: true,
        };
      }
    }
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return resolvePasswordNeeded(key, entry, QR_MARKER);
    }
    // AUTH_TOKEN_EXPIRED / прочее — пробуем тихо обновить
    console.error('[login] QR poll export:', err.errorMessage || err.message);
  }

  const fresh = pendingLogins.get(key);
  if (fresh) {
    fresh.expiresAt = Date.now() + PENDING_QR_TTL_MS;
    pendingLogins.set(key, fresh);
  }
  return {
    status: 'pending',
    loginUrl: fresh?.loginUrl || entry.loginUrl,
    expires: fresh?.expires || entry.expires,
  };
}

/**
 * Телефон → код в приложение (не SMS). Перебор residential при сбоях сети.
 */
async function startLogin(userId, phone) {
  const normalized = normalizeLoginPhone(phone);
  if (normalized.length < 11) {
    const err = new Error('Неверный номер телефона');
    err.statusCode = 400;
    throw err;
  }
  await cancelAllPendingLoginsForUser(userId);

  try {
    const { warmProbeLoginProxies } = require('./proxyPools');
    await warmProbeLoginProxies({ timeoutMs: 2800, concurrency: 4, limit: 10 });
  } catch (e) {
    console.warn('[login] login probe skip:', e.message);
  }

  const loginPoolKind = deps.loginPoolKind || 'residential';
  const pool = deps.loginPool || [];
  console.log(
    `[login] запрос кода для ${normalized}, api_id=${deps.apiId}, пул=${loginPoolKind} (${pool.length})`,
  );

  const LOGIN_PROXY_MAX_TRIES = Math.min(
    12,
    Math.max(4, Number(process.env.LOGIN_PROXY_MAX_TRIES) || 10),
  );
  const LOGIN_OVERALL_MS = Math.max(20000, Number(process.env.LOGIN_OVERALL_MS) || 45000);
  const allCandidates = deps.loginConnectionCandidates({ connectionRetries: 1, timeout: 8 });
  const candidates = allCandidates.slice(0, LOGIN_PROXY_MAX_TRIES);
  const deadline = Date.now() + LOGIN_OVERALL_MS;
  let lastErr = null;
  const key = loginKey(userId, normalized);

  for (const candidate of candidates) {
    if (Date.now() > deadline) {
      lastErr = lastErr || new Error('Таймаут логина: прокси не ответили вовремя');
      break;
    }
    const index = candidate.index;
    const viaLabel =
      index !== undefined && pool[index] ? deps.proxyLabel(pool[index]) : `try#${index}`;
    let client;
    try {
      console.log(`[login] пробую ${viaLabel}…`);
      const opts = loginClientBaseOpts(candidate.opts || candidate);
      client = new TelegramClient(new StringSession(''), deps.apiId, deps.apiHash, opts);
      await client.connect();

      const sent = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: normalized,
          apiId: Number(deps.apiId),
          apiHash: deps.apiHash,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber: false,
            allowAppHash: true,
            allowMissedCall: false,
            allowFirebase: false,
            unknownNumber: false,
          }),
        }),
      );

      if (sent instanceof Api.auth.SentCodeSuccess) {
        const sessionString = client.session.save();
        try {
          await client.disconnect();
        } catch (_) {}
        return {
          sent: true,
          phone: normalized,
          alreadyAuthorized: true,
          sessionString,
          isCodeViaApp: true,
        };
      }

      if (sent?.className === 'auth.SentCodePaymentRequired' || sent?.storeProduct) {
        try {
          await client.disconnect();
        } catch (_) {}
        const err = new Error(
          'Telegram требует оплату/Premium для кода на этот номер. Используй вход по QR.',
        );
        err.statusCode = 400;
        throw err;
      }

      const phoneCodeHash = sent.phoneCodeHash;
      if (!phoneCodeHash || typeof phoneCodeHash !== 'string') {
        throw new Error('Telegram не вернул phoneCodeHash');
      }
      const typeName = sent.type?.className || sent.type?.constructor?.name || '';
      const isCodeViaApp =
        sent.type instanceof Api.auth.SentCodeTypeApp || /SentCodeTypeApp/i.test(typeName);
      const nextName = sent.nextType?.className || sent.nextType?.constructor?.name || '';
      const codeLength = Number(sent.type?.length) || 5;
      const timeout = Number(sent.timeout) || 0;

      stashPending(key, {
        client,
        mode: 'phone',
        phoneCodeHash,
        phone: normalized,
        userId: String(userId),
        isCodeViaApp,
        codeLength,
        nextType: nextName,
        timeout,
      });

      console.log(
        `[login] код запрошен для ${normalized} через ${viaLabel} [${loginPoolKind}]` +
          ` — доставка: ${isCodeViaApp ? 'приложение Telegram' : 'SMS/звонок/другое'}` +
          (typeName ? ` type=${typeName}` : '') +
          (nextName ? ` next=${nextName}` : '') +
          (timeout ? ` timeout=${timeout}s` : '') +
          ` len=${codeLength}`,
      );

      return {
        sent: true,
        phone: normalized,
        isCodeViaApp,
        type: typeName,
        nextType: nextName,
        timeout,
        codeLength,
      };
    } catch (err) {
      lastErr = err;
      console.error(`[login] sendCode не удался через ${viaLabel}:`, err.errorMessage || err.message);
      try {
        if (client) await client.disconnect();
      } catch (_) {}
      const msg = `${err.errorMessage || ''} ${err.message || ''}`;
      if (
        /FLOOD_WAIT|FLOOD|SEND_CODE_UNAVAILABLE|PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED|API_ID_INVALID|API_ID_PUBLISHED|Premium|оплату/i.test(
          msg,
        )
      ) {
        throw err;
      }
    }
  }

  throw lastErr || new Error('Не удалось подключиться к Telegram для отправки кода');
}

async function resendLoginCode(userId, phone) {
  const found = findPendingLogin(userId, phone);
  if (!found || found.entry.mode === 'qr') {
    const err = new Error('Сессия входа не найдена. Запроси код заново.');
    err.statusCode = 400;
    throw err;
  }
  const { key, entry } = found;
  if (!(await ensurePendingConnected(entry))) {
    const err = new Error('Связь с Telegram потеряна. Запроси код заново.');
    err.statusCode = 400;
    throw err;
  }

  console.log(`[login] ResendCode для ${entry.phone}`);
  try {
    const sent = await entry.client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: entry.phone,
        phoneCodeHash: entry.phoneCodeHash,
      }),
    );
    const phoneCodeHash = sent.phoneCodeHash || entry.phoneCodeHash;
    const typeName = sent.type?.className || sent.type?.constructor?.name || '';
    const isCodeViaApp = /App|SentCodeTypeApp/i.test(typeName) || !!sent.isCodeViaApp;
    stashPending(key, {
      ...entry,
      phoneCodeHash,
      phone: entry.phone,
      isCodeViaApp,
    });
    console.log(
      `[login] ResendCode ок для ${entry.phone} — тип: ${typeName || 'unknown'}` +
        ` (${isCodeViaApp ? 'приложение' : 'SMS/звонок/другое'})`,
    );
    return {
      sent: true,
      phone: entry.phone,
      isCodeViaApp,
      type: typeName,
    };
  } catch (err) {
    console.error(
      `[login] ResendCode не удался для ${entry.phone}:`,
      err.errorMessage || err.message,
    );
    throw err;
  }
}

async function confirmCode(userId, phone, code) {
  const phoneCode = extractLoginCode(code) || String(code || '').replace(/\D/g, '');
  const found = findPendingLogin(userId, phone);
  if (!found || found.entry.mode === 'qr') {
    console.error(`[login] confirmCode: нет pending для ${phone} (user=${userId})`);
    const err = new Error('Сессия входа не найдена. Начните заново.');
    err.statusCode = 400;
    throw err;
  }
  const { key, entry } = found;
  if (!phoneCode || phoneCode.length < 4) {
    const err = new Error('Код пустой или слишком короткий');
    err.statusCode = 400;
    throw err;
  }
  if (!(await ensurePendingConnected(entry))) {
    await disposePendingEntry(key, entry);
    const err = new Error('Связь с Telegram потеряна. Запроси код заново.');
    err.statusCode = 400;
    throw err;
  }

  console.log(
    `[login] confirmCode для ${entry.phone} codeLen=${phoneCode.length} hash=${String(entry.phoneCodeHash).slice(0, 8)}…`,
  );

  try {
    await entry.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: entry.phone,
        phoneCodeHash: entry.phoneCodeHash,
        phoneCode,
      }),
    );
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return resolvePasswordNeeded(key, entry, entry.phone);
    }
    console.error(
      `[login] confirmCode fail ${entry.phone}:`,
      err.errorMessage || err.message,
    );
    throw err;
  }

  const sessionString = entry.client.session.save();
  // Не disconnect до saveSession у caller — иначе краш/лимит = сессия потеряна.
  entry.handOff = true;
  entry.sessionString = sessionString;
  stashPending(key, entry);
  console.log(`[login] ${entry.phone}: SignIn ок, сессия ${sessionString.length} символов (handoff)`);
  return { status: 'ok', sessionString, phone: entry.phone, handOff: true };
}

async function confirmPassword(userId, phone, password) {
  const found =
    findPendingLogin(userId, phone) ||
    findPendingLogin(userId, QR_MARKER) ||
    findPendingLogin(userId, null);
  if (!found) {
    console.error(`[login] confirmPassword: нет pending для ${phone} (user=${userId})`);
    const err = new Error('Сессия входа не найдена. Начните заново.');
    err.statusCode = 400;
    throw err;
  }
  const { key, entry } = found;
  if (!(await ensurePendingConnected(entry))) {
    await disposePendingEntry(key, entry);
    const err = new Error('Связь с Telegram потеряна. Запроси код заново.');
    err.statusCode = 400;
    throw err;
  }

  console.log(`[login] confirmPassword для ${entry.phone || entry.mode}…`);

  try {
    const passwordInfo = await entry.client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(passwordInfo, password);
    await entry.client.invoke(new Api.auth.CheckPassword({ password: check }));
  } catch (err) {
    console.error(
      `[login] confirmPassword fail:`,
      err.errorMessage || err.message,
    );
    throw err;
  }

  let phoneOut = entry.phone;
  if (!phoneOut || phoneOut === QR_MARKER) {
    try {
      const me = await entry.client.getMe();
      const digits = String(me?.phone || '').replace(/\D/g, '');
      phoneOut = digits ? normalizeLoginPhone(digits) : '+unknown';
    } catch (_) {
      phoneOut = '+unknown';
    }
  }

  const sessionString = entry.client.session.save();
  entry.handOff = true;
  entry.sessionString = sessionString;
  entry.phone = phoneOut;
  stashPending(key, entry);
  console.log(`[login] ${phoneOut}: 2FA ок, сессия ${sessionString.length} символов (handoff)`);
  return { status: 'ok', sessionString, phone: phoneOut, handOff: true };
}

/** После успешного saveSession — гасим pending GramJS перед activateAccount. */
async function releaseLoginHandoff(userId, phone) {
  const found =
    findPendingLogin(userId, phone) ||
    (phone === QR_MARKER ? findPendingLogin(userId, QR_MARKER) : null);
  if (!found?.entry?.handOff) return false;
  await disposePendingEntry(found.key, found.entry);
  return true;
}

/**
 * QR как data:image/png для миниаппа — без стороннего CDN (токен не утекает).
 */
async function qrImageDataUrl(loginUrl) {
  const url = String(loginUrl || '').trim();
  if (!url) return null;
  try {
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      margin: 2,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    console.error('[login] qr dataURL:', err.message);
    return null;
  }
}

/** PNG buffer для Bot API multipart (без qrserver.com). */
async function qrImagePngBuffer(loginUrl) {
  const url = String(loginUrl || '').trim();
  if (!url) return null;
  try {
    const QRCode = require('qrcode');
    return await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'M',
      type: 'png',
      margin: 2,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    console.error('[login] qr png:', err.message);
    return null;
  }
}

/** @deprecated не использовать — токен на чужой CDN. Оставлен stub. */
function qrImageUrl(_loginUrl) {
  return null;
}

module.exports = {
  configureLoginAuth,
  normalizeLoginPhone,
  extractLoginCode,
  startLogin,
  startQrLogin,
  pollQrLogin,
  refreshQrTokenSilent,
  resendLoginCode,
  confirmCode,
  confirmPassword,
  releaseLoginHandoff,
  cancelPendingLogin,
  cancelAllPendingLoginsForUser,
  peekPendingLogin,
  findPendingLogin,
  qrImageUrl,
  qrImageDataUrl,
  qrImagePngBuffer,
  QR_MARKER,
};
