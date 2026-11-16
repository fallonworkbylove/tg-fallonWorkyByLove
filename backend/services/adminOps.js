/**
 * Админ-действия для OPS desktop (глобально, не user-scoped miniapp).
 */
const db = require('../db');
const { SocksClient } = require('socks');
const {
  PROXY_POOL,
  LOGIN_PROXY_POOL,
  proxyLabel,
  isProxyDead,
} = require('./proxyPools');
const {
  isActive,
  activateAccount,
  deactivateAccount,
  pingActiveSession,
  startLogin,
  resendLoginCode,
  confirmCode,
  confirmPassword,
  releaseLoginHandoff,
  markFreshSession,
  normalizeLoginPhone,
  extractLoginCode,
  scanUnansweredDialogs,
} = require('./telegramClient');
const { purgeAccount, renumberAccountSeq } = require('./accountCleanup');
const { getLogs, clearLogs } = require('./adminLogBuffer');
const { listActivity } = require('./opsActivityLog');

const TG_DEST = { host: '149.154.167.41', port: 443 };
const PROXY_TIMEOUT_MS = 8000;

function phoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function normalizePhone(raw) {
  return normalizeLoginPhone(raw);
}

async function resolveOwnerUser(ownerTelegramId) {
  const tg = String(ownerTelegramId || '').trim();
  if (!tg) {
    const err = new Error('Укажи ownerTelegramId владельца');
    err.statusCode = 400;
    throw err;
  }
  const [[user]] = await db.execute(
    'SELECT id, telegram_user_id, username, first_name FROM users WHERE telegram_user_id = ? LIMIT 1',
    [tg],
  );
  if (!user) {
    const err = new Error(`Владелец telegram_user_id=${tg} не найден в users`);
    err.statusCode = 404;
    throw err;
  }
  return user;
}

async function getAccountById(id) {
  const [[row]] = await db.execute(
    `SELECT a.id, a.user_id, a.phone, a.prompt, a.status, a.session_string,
            a.is_autoreply_enabled, a.reply_delay_min, a.reply_delay_max,
            a.media_chat_link, a.seq,
            u.telegram_user_id AS owner_tg, u.username AS owner_username
     FROM accounts a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.id = ?
     LIMIT 1`,
    [id],
  );
  if (!row) return null;
  // session_string наружу не отдаём — только флаг наличия.
  const { session_string: ss, ...rest } = row;
  return {
    ...rest,
    has_session: Boolean(ss),
    session_string: ss || null, // внутренние startAi/connect ещё читают
  };
}

function publicAccount(row) {
  if (!row) return null;
  const { session_string, ...safe } = row;
  return { ...safe, has_session: Boolean(session_string || row.has_session) };
}

/**
 * ЧС как в Telegram-админке: users.is_blocked (воркеры), НЕ таблица peer-blacklist для ИИ.
 */
async function ensureWorkerBlacklistSchema() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS blacklist_worker_backup (
       telegram_user_id BIGINT NOT NULL PRIMARY KEY,
       row_json TEXT NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     )`,
  );
}

async function findUserByInput(input) {
  const raw = String(input || '')
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '');
  if (!raw) return null;
  if (/^\d{5,15}$/.test(raw)) {
    const [[u]] = await db.execute(
      'SELECT id, telegram_user_id, username, first_name, is_blocked FROM users WHERE telegram_user_id = ? LIMIT 1',
      [raw],
    );
    return u || { id: null, telegram_user_id: raw, username: null, first_name: null, is_blocked: 0 };
  }
  if (!/^[A-Za-z0-9_]{3,32}$/.test(raw)) return null;
  const [[u]] = await db.execute(
    'SELECT id, telegram_user_id, username, first_name, is_blocked FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1',
    [raw],
  );
  if (u) return u;
  try {
    const [[w]] = await db.execute('SELECT id FROM workers WHERE LOWER(login) = LOWER(?) LIMIT 1', [raw]);
    if (w) return { id: null, telegram_user_id: String(w.id), username: raw, first_name: null, is_blocked: 0 };
  } catch (_) {}
  return null;
}

async function listBlacklist() {
  const [rows] = await db.execute(
    `SELECT u.id, u.telegram_user_id, u.username, u.first_name,
            (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS accounts
     FROM users u
     WHERE u.is_blocked = 1
     ORDER BY u.username, u.telegram_user_id`,
  );
  return rows.map((u) => ({
    id: u.id,
    telegramId: String(u.telegram_user_id),
    username: u.username || null,
    firstName: u.first_name || null,
    title: u.username ? `@${u.username}` : u.first_name || `id ${u.telegram_user_id}`,
    accounts: Number(u.accounts) || 0,
  }));
}

async function addBlacklist({ peerId, username, input } = {}) {
  const raw = input || username || peerId;
  const user = await findUserByInput(raw);
  if (!user || user.telegram_user_id == null) {
    const err = new Error('Не найден: укажи @username или Telegram ID');
    err.statusCode = 404;
    throw err;
  }
  const tgId = String(user.telegram_user_id);
  if (Number(user.is_blocked) === 1) {
    return { already: true, telegramId: tgId, title: user.username ? `@${user.username}` : `id ${tgId}` };
  }

  await ensureWorkerBlacklistSchema();
  let userId = user.id;
  if (userId) {
    await db.execute('UPDATE users SET is_blocked = 1 WHERE id = ?', [userId]);
  } else {
    const [res] = await db.execute(
      'INSERT INTO users (telegram_user_id, username, is_blocked) VALUES (?, ?, 1)',
      [tgId, user.username || null],
    );
    userId = res?.insertId || null;
  }
  await db.execute('DELETE FROM notification_subscribers WHERE chat_id = ?', [tgId]).catch(() => {});

  let workerRemoved = false;
  try {
    const [workerRows] = await db.execute('SELECT * FROM workers WHERE id = ?', [tgId]);
    if (workerRows.length) {
      await db.execute(
        `INSERT INTO blacklist_worker_backup (telegram_user_id, row_json) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE row_json = VALUES(row_json), created_at = CURRENT_TIMESTAMP`,
        [tgId, JSON.stringify(workerRows[0])],
      );
      await db.execute('DELETE FROM workers WHERE id = ?', [tgId]);
      workerRemoved = true;
    }
  } catch (err) {
    console.error('[adminOps] workers block:', err.message);
  }

  let stopped = 0;
  if (userId) {
    const [accs] = await db.execute(
      'SELECT id, session_string FROM accounts WHERE user_id = ?',
      [userId],
    );
    for (const acc of accs) {
      if (isActive(acc.id)) stopped += 1;
      await deactivateAccount(acc.id).catch(() => {});
    }
  }

  return {
    already: false,
    telegramId: tgId,
    title: user.username ? `@${user.username}` : `id ${tgId}`,
    workerRemoved,
    stopped,
  };
}

async function removeBlacklist(telegramId) {
  const tgId = String(telegramId || '').trim();
  if (!tgId) {
    const err = new Error('telegramId обязателен');
    err.statusCode = 400;
    throw err;
  }
  await ensureWorkerBlacklistSchema();
  const [[user]] = await db.execute(
    'SELECT id, username, is_blocked FROM users WHERE telegram_user_id = ? LIMIT 1',
    [tgId],
  );
  if (!user || Number(user.is_blocked) !== 1) {
    return { removed: false, telegramId: tgId };
  }
  await db.execute('UPDATE users SET is_blocked = 0 WHERE id = ?', [user.id]);

  let workerRestored = false;
  try {
    const [[backup]] = await db.execute(
      'SELECT row_json FROM blacklist_worker_backup WHERE telegram_user_id = ?',
      [tgId],
    );
    const [[exists]] = await db.execute('SELECT id FROM workers WHERE id = ?', [tgId]);
    if (backup && !exists) {
      const row = JSON.parse(backup.row_json);
      const cols = Object.keys(row).filter((c) => /^\w+$/.test(c));
      await db.execute(
        `INSERT INTO workers (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => row[c]),
      );
      workerRestored = true;
    }
    if (backup) {
      await db.execute('DELETE FROM blacklist_worker_backup WHERE telegram_user_id = ?', [tgId]);
    }
  } catch (err) {
    console.error('[adminOps] workers unblock:', err.message);
  }

  let started = 0;
  const [accs] = await db.execute(
    'SELECT id, session_string FROM accounts WHERE user_id = ?',
    [user.id],
  );
  for (const acc of accs) {
    if (!acc.session_string) continue;
    if ((await activateAccount(acc.id, acc.session_string).catch(() => false)) === true) started += 1;
  }

  return {
    removed: true,
    telegramId: tgId,
    title: user.username ? `@${user.username}` : `id ${tgId}`,
    workerRestored,
    started,
  };
}

async function createAccount({ phone, prompt = '', ownerTelegramId } = {}) {
  const owner = await resolveOwnerUser(ownerTelegramId);
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 11) {
    const err = new Error('Неверный номер телефона');
    err.statusCode = 400;
    throw err;
  }
  const want = phoneDigits(normalized);
  const [owned] = await db.execute('SELECT id, phone FROM accounts WHERE user_id = ?', [owner.id]);
  if (owned.some((r) => phoneDigits(r.phone) === want)) {
    const err = new Error('Аккаунт с таким телефоном уже есть у владельца');
    err.statusCode = 409;
    throw err;
  }
  const [result] = await db.execute(
    `INSERT INTO accounts (user_id, phone, prompt, status, is_autoreply_enabled)
     VALUES (?, ?, ?, ?, ?)`,
    [owner.id, normalized, String(prompt || '').trim(), 'Остановлен', false],
  );
  try {
    await renumberAccountSeq(owner.id);
  } catch (err) {
    console.error('[adminOps] seq after create:', err.message);
  }
  const account = publicAccount(await getAccountById(result.insertId));
  return account;
}

async function deleteAccount(id) {
  const account = await getAccountById(id);
  if (!account) {
    const err = new Error('Аккаунт не найден');
    err.statusCode = 404;
    throw err;
  }
  await deactivateAccount(account.id).catch(() => {});
  const removed = await purgeAccount(account.id, account.user_id);
  if (!removed) {
    const err = new Error('Не удалось удалить аккаунт');
    err.statusCode = 500;
    throw err;
  }
  return { removed: true, id: account.id, phone: account.phone };
}

async function startAi(id) {
  const account = await getAccountById(id);
  if (!account) {
    const err = new Error('Аккаунт не найден');
    err.statusCode = 404;
    throw err;
  }
  if (!account.prompt || !String(account.prompt).trim()) {
    const err = new Error('Сначала задай промпт');
    err.statusCode = 400;
    throw err;
  }
  if (!account.session_string) {
    const err = new Error('Нет сессии — подключи аккаунт (код/QR)');
    err.statusCode = 410;
    throw err;
  }
  let online = isActive(account.id);
  if (!online) {
    const ok = await activateAccount(account.id, account.session_string);
    online = ok === true;
  }
  if (!online) {
    const err = new Error('Сессия не подключилась — AI не включён');
    err.statusCode = 503;
    throw err;
  }
  await db.execute(
    `UPDATE accounts SET status = ?, is_autoreply_enabled = TRUE WHERE id = ?`,
    ['AI включен', account.id],
  );
  scanUnansweredDialogs(account.id, 0, { catchUp: true }).catch((e) =>
    console.error(`[admin-start-ai ${account.id}]`, e.message),
  );
  return {
    id: account.id,
    ai: true,
    online: true,
    status: 'AI включен',
    warn: null,
  };
}

async function stopAi(id) {
  const account = await getAccountById(id);
  if (!account) {
    const err = new Error('Аккаунт не найден');
    err.statusCode = 404;
    throw err;
  }
  await db.execute(
    `UPDATE accounts SET status = ?, is_autoreply_enabled = FALSE WHERE id = ?`,
    ['Остановлен', account.id],
  );
  await deactivateAccount(account.id).catch(() => {});
  return { id: account.id, ai: false, online: false, status: 'Остановлен' };
}

async function bulkAi(enable, ids) {
  let list;
  if (Array.isArray(ids) && ids.length) {
    list = ids.map(Number).filter((n) => Number.isFinite(n));
  } else {
    const [rows] = await db.execute('SELECT id FROM accounts');
    list = rows.map((r) => r.id);
  }
  const results = [];
  for (const id of list) {
    try {
      results.push(enable ? await startAi(id) : await stopAi(id));
    } catch (err) {
      results.push({ id, error: err.message || String(err) });
    }
  }
  return {
    ok: results.filter((r) => !r.error).length,
    fail: results.filter((r) => r.error).length,
    results,
  };
}

async function saveSession(userId, phone, sessionString, prompt = '') {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 11) {
    const err = new Error('Неверный номер телефона');
    err.statusCode = 400;
    throw err;
  }
  const want = phoneDigits(normalized);
  const [owned] = await db.execute('SELECT id, phone FROM accounts WHERE user_id = ?', [userId]);
  const existing = owned.find((row) => phoneDigits(row.phone) === want);
  if (existing) {
    if (prompt) {
      await db.execute(
        `UPDATE accounts SET phone = ?, session_string = ?, status = ?, prompt = ?
         WHERE id = ? AND user_id = ?`,
        [normalized, sessionString, 'Подключен', prompt, existing.id, userId],
      );
    } else {
      await db.execute(
        `UPDATE accounts SET phone = ?, session_string = ?, status = ?
         WHERE id = ? AND user_id = ?`,
        [normalized, sessionString, 'Подключен', existing.id, userId],
      );
    }
    return existing.id;
  }
  const [result] = await db.execute(
    `INSERT INTO accounts (user_id, phone, session_string, status, is_autoreply_enabled, prompt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, normalized, sessionString, 'Подключен', false, prompt || ''],
  );
  try {
    await renumberAccountSeq(userId);
  } catch (err) {
    console.error('[adminOps] seq after session:', err.message);
  }
  return result.insertId;
}

async function connectStart({ phone, ownerTelegramId, prompt = '' }) {
  const owner = await resolveOwnerUser(ownerTelegramId);
  const normalized = normalizePhone(phone);
  if (!normalized) {
    const err = new Error('Поле phone обязательно');
    err.statusCode = 400;
    throw err;
  }
  const rate = require('./loginRate').allowLoginAttempt({
    userId: owner.id,
    phone: normalized,
  });
  if (!rate.ok) {
    const err = new Error(rate.error || 'Слишком много попыток входа');
    err.statusCode = rate.status || 429;
    throw err;
  }
  const result = await startLogin(owner.id, normalized);
  if (result?.alreadyAuthorized && result.sessionString) {
    const accountId = await saveSession(
      owner.id,
      result.phone || normalized,
      result.sessionString,
      prompt,
    );
    markFreshSession(accountId, result.sessionString);
    await deactivateAccount(accountId).catch(() => {});
    const online = (await activateAccount(accountId, result.sessionString)) === true;
    return {
      status: 'connected',
      accountId,
      phone: result.phone || normalized,
      online,
      ownerTelegramId: String(owner.telegram_user_id),
    };
  }
  return {
    status: 'codeSent',
    viaApp: !!result?.isCodeViaApp,
    ownerTelegramId: String(owner.telegram_user_id),
    phone: normalized,
  };
}

async function connectResend({ phone, ownerTelegramId }) {
  const owner = await resolveOwnerUser(ownerTelegramId);
  const normalized = normalizePhone(phone);
  const result = await resendLoginCode(owner.id, normalized);
  return { status: 'codeSent', viaApp: !!result?.isCodeViaApp, phone: normalized };
}

async function connectCode({ phone, code, ownerTelegramId, prompt = '' }) {
  const owner = await resolveOwnerUser(ownerTelegramId);
  const normalized = normalizePhone(phone);
  const cleaned = extractLoginCode(code);
  const result = await confirmCode(owner.id, normalized, cleaned);
  if (result?.status === 'needPassword') {
    return { status: 'needPassword', phone: result.phone || normalized };
  }
  if (!result?.sessionString) {
    const err = new Error('Код принят, но сессия пуста');
    err.statusCode = 500;
    throw err;
  }
  const accountId = await saveSession(owner.id, result.phone || normalized, result.sessionString, prompt);
  await releaseLoginHandoff(owner.id, normalized).catch(() => {});
  markFreshSession(accountId, result.sessionString);
  await deactivateAccount(accountId).catch(() => {});
  const online = (await activateAccount(accountId, result.sessionString)) === true;
  return { status: 'connected', accountId, phone: result.phone || normalized, online };
}

async function connectPassword({ phone, password, ownerTelegramId, prompt = '' }) {
  const owner = await resolveOwnerUser(ownerTelegramId);
  const normalized = normalizePhone(phone);
  const result = await confirmPassword(owner.id, normalized, password);
  if (!result?.sessionString) {
    const err = new Error('Пароль принят, но сессия пуста');
    err.statusCode = 500;
    throw err;
  }
  const accountId = await saveSession(owner.id, result.phone || normalized, result.sessionString, prompt);
  await releaseLoginHandoff(owner.id, normalized).catch(() => {});
  markFreshSession(accountId, result.sessionString);
  await deactivateAccount(accountId).catch(() => {});
  const online = (await activateAccount(accountId, result.sessionString)) === true;
  return { status: 'connected', accountId, phone: result.phone || normalized, online };
}

async function sessionPing(id) {
  const account = await getAccountById(id);
  if (!account) {
    const err = new Error('Аккаунт не найден');
    err.statusCode = 404;
    throw err;
  }
  const ping = await pingActiveSession(account.id);
  return { ...ping, id: account.id, online: isActive(account.id) };
}

function listProxies() {
  const mapPool = (pool, kind) =>
    pool.map((p, index) => ({
      index,
      kind,
      label: proxyLabel(p),
      ip: p.ip,
      port: p.port,
      type: p.MTProxy ? 'mtproxy' : 'socks5',
      hasAuth: Boolean(p.username || p.userId),
      dead: Boolean(typeof isProxyDead === 'function' && isProxyDead(p)),
    }));
  const work = mapPool(PROXY_POOL, 'work');
  const login = mapPool(LOGIN_PROXY_POOL, 'login');
  let openaiReady = false;
  let openaiProxyLen = 0;
  try {
    // Не поднимаем aiResponder ради списка прокси (локально без ключа падает).
    // На проде модуль уже в cache после boot — читаем оттуда.
    const resolved = require.resolve('./aiResponder');
    const cached = require.cache[resolved];
    const ai = cached && cached.exports;
    if (ai) {
      if (typeof ai.isOpenAiClientReady === 'function') {
        openaiReady = Boolean(ai.isOpenAiClientReady());
      }
      if (typeof ai.openAiProxyPoolLen === 'function') {
        openaiProxyLen = Number(ai.openAiProxyPoolLen()) || 0;
      }
    } else {
      openaiReady = Boolean(process.env.OPENAI_API_KEY) && process.env.AUDIT_SMOKE !== '1';
      const pl = String(process.env.OPENAI_PROXY_LIST || process.env.PROXY_LIST || '');
      openaiProxyLen = pl.split(';').filter((x) => x.trim()).length;
    }
  } catch (_) {
    openaiReady = false;
  }
  const workAlive = work.filter((p) => !p.dead).length;
  const loginAlive = login.filter((p) => !p.dead).length;
  return {
    work,
    login,
    summary: {
      work: work.length,
      work_alive: workAlive,
      login: login.length,
      login_alive: loginAlive,
      openai_ready: openaiReady,
      openai_proxy_len: openaiProxyLen,
      proxy_len: work.length,
      audit_smoke: process.env.AUDIT_SMOKE === '1',
      ok: workAlive >= 5 && openaiReady && process.env.AUDIT_SMOKE !== '1',
    },
  };
}

async function probeSocks(proxy) {
  const started = Date.now();
  try {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.ip,
        port: Number(proxy.port),
        type: 5,
        userId: proxy.username || proxy.userId || undefined,
        password: proxy.password || undefined,
      },
      command: 'connect',
      timeout: PROXY_TIMEOUT_MS,
      destination: TG_DEST,
    });
    socket.destroy();
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e.message || String(e) };
  }
}

async function checkProxies({ pool = 'all', concurrency = 8 } = {}) {
  const want = String(pool || 'all').toLowerCase();
  const targets = [];
  if (want === 'work' || want === 'all') {
    PROXY_POOL.forEach((p, index) => targets.push({ kind: 'work', index, proxy: p }));
  }
  if (want === 'login' || want === 'all') {
    LOGIN_PROXY_POOL.forEach((p, index) => targets.push({ kind: 'login', index, proxy: p }));
  }
  const limit = Math.max(1, Math.min(20, Number(concurrency) || 8));
  const results = new Array(targets.length);
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const i = cursor;
      cursor += 1;
      const t = targets[i];
      if (t.proxy.MTProxy) {
        results[i] = {
          kind: t.kind,
          index: t.index,
          label: proxyLabel(t.proxy),
          ok: null,
          skipped: true,
          error: 'MTProxy probe не поддерживается — только SOCKS5',
        };
        continue;
      }
      const r = await probeSocks(t.proxy);
      results[i] = {
        kind: t.kind,
        index: t.index,
        label: proxyLabel(t.proxy),
        ok: r.ok,
        ms: r.ms,
        error: r.error || null,
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, () => worker()));

  return {
    dest: `${TG_DEST.host}:${TG_DEST.port}`,
    ok: results.filter((r) => r && r.ok === true).length,
    fail: results.filter((r) => r && r.ok === false).length,
    skipped: results.filter((r) => r && r.skipped).length,
    results,
  };
}

/**
 * Превью «как звучит анкета» без OpenAI — разбор промпта + образец реплик.
 */
async function personaPreview(accountId) {
  const row = await getAccountById(accountId);
  if (!row) {
    const err = new Error('Аккаунт не найден');
    err.statusCode = 404;
    throw err;
  }
  const prompt = String(row.prompt || '');
  let name = null;
  try {
    name = require('./adminConsoleStats').nameFromPrompt(prompt);
  } catch (_) {
    name = null;
  }
  let card = {};
  try {
    card = require('./personaFacts').parsePersonaCard(prompt) || {};
  } catch (_) {
    card = {};
  }
  const city = card.fromCity || null;
  const toCity = card.toCity || null;
  const packing = Boolean(card.packing);
  const samples = [];
  if (name) samples.push(`привет) я ${name}`);
  else samples.push('привет) как дела');
  if (city) samples.push(`сейчас в ${city} живу)`);
  if (packing && toCity) samples.push(`собираюсь в ${toCity}, ещё в пути)`);
  samples.push('ну да онлайн, сама на себя)');
  samples.push('хаха ну ок)');
  return {
    accountId: Number(accountId),
    name: name || null,
    city,
    toCity,
    packing,
    promptLen: prompt.length,
    hasPrompt: Boolean(prompt.trim()),
    samples: samples.slice(0, 5),
  };
}

/**
 * 1-клик «плохой ответ» → pinned_bad в bot_patterns.
 */
async function flagBadReply({ trigger = '', reply = '', stage = 'general' } = {}) {
  const botReply = String(reply || '').trim();
  if (!botReply || botReply.length < 2) {
    const err = new Error('Нужен текст ответа');
    err.statusCode = 400;
    throw err;
  }
  const learning = require('./learningDb');
  const result = await learning.recordChurnNegative({
    userMsg: String(trigger || '').slice(0, 400) || 'admin:bad-reply',
    botReply: botReply.slice(0, 500),
    reason: 'admin_flag',
    stage: stage || 'general',
  });
  return { ok: true, ...result };
}

module.exports = {
  listBlacklist,
  addBlacklist,
  removeBlacklist,
  createAccount,
  deleteAccount,
  startAi,
  stopAi,
  bulkAi,
  connectStart,
  connectResend,
  connectCode,
  connectPassword,
  sessionPing,
  listProxies,
  checkProxies,
  getLogs,
  listActivity,
  clearLogs,
  getAccountById,
  personaPreview,
  flagBadReply,
};
